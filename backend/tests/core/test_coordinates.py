import pytest

from app.core.coordinates import format_location, parse_lat_lng


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("-34.6037,-58.3816", (-34.6037, -58.3816)),
        ("-34.6037, -58.3816", (-34.6037, -58.3816)),
        ("https://www.google.com/maps/@-31.4,-64.18,15z", (-31.4, -64.18)),
        ("https://maps.google.com/?q=-31.4,-64.18", (-31.4, -64.18)),
    ],
)
def test_parse_lat_lng_accepts_pairs_and_map_urls(raw, expected):
    assert parse_lat_lng(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "Synthetic Interior", "95.5,10.5", "10.5,190.5"])
def test_parse_lat_lng_rejects_text_and_out_of_range(raw):
    assert parse_lat_lng(raw) is None


def test_format_location_round_trips_through_the_parser():
    assert parse_lat_lng(format_location(-34.6037, -58.3816)) == (-34.6037, -58.3816)
