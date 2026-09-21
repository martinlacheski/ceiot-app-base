from pydantic import ConfigDict
from sqlmodel import SQLModel

def to_camel(string: str) -> str:
    """
    Converts a snake_case string to camelCase.
    """
    words = string.split("_")
    return words[0] + "".join(word.capitalize() for word in words[1:])

class CamelModel(SQLModel):
    """
    Modelo base que convierte automáticamente los campos de snake_case a camelCase
    para la serialización JSON (aliases), manteniendo snake_case para el acceso en Python.
    """
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True
    )
