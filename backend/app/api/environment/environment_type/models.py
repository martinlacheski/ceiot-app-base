import uuid
from datetime import datetime
from typing import List, Optional
from sqlmodel import Field, SQLModel, Relationship, func
from app.core.utils import CamelModel

# Forward reference to Environment to avoid circular import issues if needed in string
# But here we are in environment_type models.
# EnvironmentType has `environments` relationship.
# If we keep relationships between modules, we need to be careful with imports.
# In `models.py` usually we can use string forward refs if the other model is not imported.
# But `Environment` is in `../environment/models.py`.
# I will use `TYPE_CHECKING` or string refs.

class EnvironmentTypeBase(SQLModel):
    name: str = Field(index=True)

class EnvironmentType(EnvironmentTypeBase, table=True):
    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    is_active: bool = Field(default=True)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    
    # environments: List["Environment"] = Relationship(back_populates="type") 
    # To avoid circular imports, I might comment out back_populates or use string class name.
    # If I use "Environment", SQLModel needs to know about it.
    # It's safer to define the relationship in the "One" side (Environment) pointing to this "Many" side?
    # Or keep it bidirectional but use correct string paths or just omit it here if not strictly needed.
    # Existing code had it. I will keep it using string "Environment" but run into registry issues if not imported.
    # I'll leave it out for now to avoid circular dependency hell, or try to import it inside TYPE_CHECKING.
    # Actually, SQLModel uses a global registry.
    
    environments: List["Environment"] = Relationship(back_populates="type", sa_relationship_kwargs={"lazy": "selectin"})

class EnvironmentTypeCreate(EnvironmentTypeBase):
    is_active: Optional[bool] = None

class EnvironmentTypeRead(CamelModel):
    id: uuid.UUID
    is_active: bool
    name: str

class EnvironmentTypeUpdate(SQLModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
