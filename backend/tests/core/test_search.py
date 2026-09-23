import pytest

from app.core.search import ILIKE_ESCAPE, ilike_pattern


@pytest.mark.parametrize("value", [None, "", "   \t\n"])
def test_ilike_pattern_ignores_blank_values(value: str | None) -> None:
    assert ilike_pattern(value) is None


def test_ilike_pattern_trims_and_caps_user_input_at_64_characters() -> None:
    value = f"  {'x' * 64}ignored  "

    assert ilike_pattern(value) == f"%{'x' * 64}%"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("100%", r"%100\%%"),
        ("under_score", r"%under\_score%"),
        (r"back\slash", r"%back\\slash%"),
        (r"  50%_\done  ", r"%50\%\_\\done%"),
    ],
)
def test_ilike_pattern_escapes_like_metacharacters(
    value: str,
    expected: str,
) -> None:
    assert ILIKE_ESCAPE == "\\"
    assert ilike_pattern(value) == expected
