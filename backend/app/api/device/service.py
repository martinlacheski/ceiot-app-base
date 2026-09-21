import random


CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
SERIAL_PREFIX = "IOT"


class DeviceService:
    @staticmethod
    def generate_serial() -> str:
        """Generate a neutral device serial in IOT-XXXX-XXXX format."""
        random_chars = "".join(random.choices(CROCKFORD_ALPHABET, k=8))
        return f"{SERIAL_PREFIX}-{random_chars[:4]}-{random_chars[4:]}"

    @staticmethod
    def validate_serial(serial: str) -> bool:
        """Validate the neutral device serial, accepting optional hyphens."""
        normalized = serial.upper().replace("-", "")
        if not normalized.startswith(SERIAL_PREFIX) or len(normalized) != 11:
            return False
        return all(char in CROCKFORD_ALPHABET for char in normalized[3:])

    @staticmethod
    def normalize_serial(serial: str) -> str:
        """Return an uppercase IOT serial with standard hyphen grouping."""
        clean = serial.upper().replace("-", "")
        if not clean.startswith(SERIAL_PREFIX):
            return clean
        suffix = clean[3:]
        if len(suffix) == 8:
            return f"{SERIAL_PREFIX}-{suffix[:4]}-{suffix[4:]}"
        return clean
