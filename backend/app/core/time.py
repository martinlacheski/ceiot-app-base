from datetime import UTC, date, datetime, time


def utc_now() -> datetime:
    # DB columns currently store UTC values as naive datetimes for compatibility.
    return datetime.now(UTC).replace(tzinfo=None)


def utc_start_of_day(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        value = value.date()

    return datetime.combine(value, time.min)
