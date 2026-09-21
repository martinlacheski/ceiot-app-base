from typing import Mapping, TypeAlias

from fastapi import HTTPException, status


SortSpec: TypeAlias = tuple[tuple[str, str], ...]


def parse_sort(
    value: str | None,
    allowed_fields: Mapping[str, str],
    *,
    max_fields: int,
) -> SortSpec:
    if value is None:
        return ()

    if not value or value.strip() != value:
        raise _invalid_sort()

    parts = value.split(",")
    if len(parts) > max_fields:
        raise _invalid_sort()

    parsed: list[tuple[str, str]] = []
    seen: set[str] = set()
    for part in parts:
        if part.count(":") != 1:
            raise _invalid_sort()

        field, direction = part.split(":")
        canonical_field = allowed_fields.get(field)
        if (
            not field
            or canonical_field is None
            or direction not in {"asc", "desc"}
            or canonical_field in seen
        ):
            raise _invalid_sort()

        seen.add(canonical_field)
        parsed.append((canonical_field, direction))

    return tuple(parsed)


def _invalid_sort() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="Invalid sort parameter",
    )
