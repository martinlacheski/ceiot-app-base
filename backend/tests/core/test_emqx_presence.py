import asyncio

import httpx
import pytest

from app.core.emqx_presence import EmqxPresenceClient


def client_for(handler, **kwargs):
    return EmqxPresenceClient(
        base_url="http://emqx:18083",
        api_key="key",
        api_secret="secret",
        mqtt_client_id="Backend-Prod",
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


@pytest.mark.asyncio
async def test_fetches_complete_filtered_immutable_snapshot_with_basic_auth():
    requests = []

    def handler(request: httpx.Request):
        requests.append(request)
        page = int(request.url.params["page"])
        data = (
            [{"clientid": "IOT-0000-0001"}, {"clientid": "Backend-Prod"}]
            if page == 1
            else [
                {"clientid": "iot-0000-0002", "connected": True},
                {"clientid": "IOT-0000-0003", "connected": False},
                {"clientid": "runtime-client", "connected": True},
            ]
        )
        if page == 1:
            data = [dict(row, connected=True) for row in data]
        return httpx.Response(
            200,
            json={
                "data": data,
                "meta": {"count": 5, "page": page, "limit": 100, "hasnext": page == 1},
            },
        )

    snapshot = await client_for(handler).get_snapshot()

    assert snapshot.available is True
    assert snapshot.client_ids == frozenset({"IOT-0000-0001", "IOT-0000-0002"})
    assert len(requests) == 2
    assert requests[0].headers["Authorization"].startswith("Basic ")


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 500])
async def test_non_success_is_unavailable_not_an_empty_snapshot(status):
    client = client_for(lambda request: httpx.Response(status))

    snapshot = await client.get_snapshot()

    assert snapshot.available is False
    assert snapshot.client_ids is None


@pytest.mark.asyncio
async def test_connection_failure_is_unavailable():
    def handler(request):
        raise httpx.ConnectError("offline", request=request)

    assert (await client_for(handler).get_snapshot()).available is False


@pytest.mark.asyncio
async def test_missing_configuration_is_unavailable_without_http_call():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"data": [], "meta": {"hasnext": False}})

    client = EmqxPresenceClient(
        None, None, None, "Backend-Prod", transport=httpx.MockTransport(handler)
    )

    assert (await client.get_snapshot()).available is False
    assert calls == 0


@pytest.mark.asyncio
async def test_successful_snapshot_is_cached_for_three_seconds():
    calls = 0
    now = [10.0]

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"data": [], "meta": {"hasnext": False}})

    client = client_for(handler, clock=lambda: now[0])
    assert (await client.get_snapshot()).available is True
    assert (await client.get_snapshot()).available is True
    assert calls == 1
    now[0] += 3.01
    assert (await client.get_snapshot()).available is True
    assert calls == 2


@pytest.mark.asyncio
async def test_unavailable_snapshot_is_cached_then_retried_after_three_seconds():
    calls = 0
    now = [20.0]

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    client = client_for(handler, clock=lambda: now[0])
    assert (await client.get_snapshot()).available is False
    assert (await client.get_snapshot()).available is False
    assert calls == 1
    now[0] += 3.01
    assert (await client.get_snapshot()).available is False
    assert calls == 2


@pytest.mark.asyncio
async def test_unexpected_refresh_error_is_unavailable():
    def handler(request):
        raise RuntimeError("unexpected")

    assert (await client_for(handler).get_snapshot()).available is False


@pytest.mark.asyncio
async def test_cancellation_is_not_converted_to_unavailable():
    def handler(request):
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await client_for(handler).get_snapshot()


@pytest.mark.asyncio
@pytest.mark.parametrize("hasnext", [None, "yes", 1])
async def test_malformed_hasnext_is_unavailable(hasnext):
    client = client_for(
        lambda request: httpx.Response(
            200, json={"data": [], "meta": {"hasnext": hasnext}}
        )
    )

    assert (await client.get_snapshot()).available is False


@pytest.mark.asyncio
async def test_runaway_pagination_is_bounded():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "data": [{"clientid": f"IOT-0000-00{calls:02}", "connected": True}],
                "meta": {"hasnext": True},
            },
        )

    snapshot = await client_for(handler, max_pages=2).get_snapshot()

    assert snapshot.available is False
    assert calls == 2


@pytest.mark.asyncio
async def test_duplicate_raw_client_id_across_pages_is_unavailable():
    def handler(request):
        page = int(request.url.params["page"])
        return httpx.Response(
            200,
            json={
                "data": [{"clientid": "IOT-0000-0001", "connected": True}],
                "meta": {"hasnext": page == 1},
            },
        )

    assert (await client_for(handler).get_snapshot()).available is False


@pytest.mark.asyncio
async def test_final_raw_client_count_must_match_metadata():
    client = client_for(
        lambda request: httpx.Response(
            200,
            json={
                "data": [{"clientid": "IOT-0000-0001", "connected": True}],
                "meta": {"count": 2, "hasnext": False},
            },
        )
    )

    assert (await client.get_snapshot()).available is False


@pytest.mark.asyncio
async def test_count_must_remain_stable_across_pages():
    def handler(request):
        page = int(request.url.params["page"])
        return httpx.Response(
            200,
            json={
                "data": [{"clientid": f"IOT-0000-000{page}", "connected": True}],
                "meta": {"count": page + 1, "hasnext": page == 1},
            },
        )

    assert (await client_for(handler).get_snapshot()).available is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "meta",
    [
        {"count": True},
        {"count": -1},
        {"page": 2},
        {"limit": 99},
    ],
)
async def test_optional_pagination_metadata_is_validated(meta):
    meta = {**meta, "hasnext": False}
    client = client_for(
        lambda request: httpx.Response(200, json={"data": [], "meta": meta})
    )

    assert (await client.get_snapshot()).available is False


@pytest.mark.asyncio
async def test_total_refresh_duration_is_bounded():
    async def handler(request):
        await asyncio.sleep(1)
        return httpx.Response(200, json={"data": [], "meta": {"hasnext": False}})

    snapshot = await client_for(handler, refresh_deadline_seconds=0.01).get_snapshot()

    assert snapshot.available is False


@pytest.mark.asyncio
async def test_concurrent_callers_share_one_inflight_request():
    calls = 0

    async def handler(request):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.02)
        return httpx.Response(200, json={"data": [], "meta": {"hasnext": False}})

    client = client_for(handler)
    results = await asyncio.gather(*(client.get_snapshot() for _ in range(2)))

    assert all(result.available for result in results)
    assert calls == 1
