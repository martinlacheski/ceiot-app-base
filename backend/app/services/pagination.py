
from sqlmodel.ext.asyncio.session import AsyncSession
from math import ceil
from typing import Any, Optional, Dict
from sqlmodel import Session, select, func


DEFAULT_PER_PAGE = 10
MAX_PER_PAGE = 10000


# Sanitiza la paginación
def sanitize_pagination(page: int = 1, per_page: int = DEFAULT_PER_PAGE):
    # Se valida que la página sea mayor o igual a 1
    page = max(1, int(page or 1))
    # Se valida que el número de elementos por página sea mayor o igual a 1 y menor o igual a 10000
    per_page = min(MAX_PER_PAGE, max(1, int(per_page or DEFAULT_PER_PAGE)))
    # Se retorna la página y el número de elementos por página
    return page, per_page


# Función para obtener los resultados paginados
def paginate_query(
    db: Session,
    model,
    base_query=None,
    page: int = 1,
    per_page: int = DEFAULT_PER_PAGE,
    order_by: Optional[str] = None,
    direction: str = "asc",
    allowed_order: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    page, per_page = sanitize_pagination(page, per_page)
    # Se crea la consulta base
    query = base_query if base_query is not None else select(model)

    # Se obtiene el total de registros
    if base_query is not None:
        subquery = base_query.subquery()
        count_query = select(func.count()).select_from(subquery)
        total = db.scalar(count_query) or 0
    else:
        total = db.scalar(select(func.count()).select_from(model)) or 0

    # Si no hay registros, se retorna un diccionario con la información de la paginación
    if total == 0:
        return {"total": 0, "pages": 0, "page": page, "per_page": per_page, "items": []}

    # Si se especifica y permite el ordenamiento
    if allowed_order and order_by:
        if order_by in allowed_order:
            col = allowed_order[order_by]
        else:
            col = allowed_order.get("id")  # fallback

        if col is not None:
            query = query.order_by(
                col.desc() if direction == "desc" else col.asc())

    # Se obtienen los elementos
    items = db.exec(query.offset(
        (page-1) * per_page).limit(per_page)).all()

    # Se retorna la información de la paginación
    return {
        "total": total,
        "pages": ceil(total/per_page),
        "page": page,
        "per_page": per_page,
        "items": items
    }


async def paginate_query_async(
    db: AsyncSession,
    model,
    base_query=None,
    page: int = 1,
    per_page: int = DEFAULT_PER_PAGE,
    order_by: Optional[str] = None,
    direction: str = "asc",
    allowed_order: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    page, per_page = sanitize_pagination(page, per_page)

    # Se crea la consulta base
    query = base_query if base_query is not None else select(model)

    # Logic to be implemented:
    if base_query is not None:
        # Wrap the query in a subquery to count rows
        # This is more robust for complex queries with joins/groups
        # But for simple filters on a model, we might just want to clone the query and replace select with count
        # SQLModel/SQLAlchemy make this a bit tricky.
        # A common pattern:
        # count_query = select(func.count()).select_from(base_query.subquery())
        # Let's try that.
        subquery = base_query.subquery()
        count_query = select(func.count()).select_from(subquery)
        total = await db.scalar(count_query) or 0
    else:
        total = await db.scalar(select(func.count()).select_from(model)) or 0

    # Si no hay registros, se retorna un diccionario con la información de la paginación
    if total == 0:
        return {"total": 0, "pages": 0, "page": page, "per_page": per_page, "items": []}

    # Si se especifica y permite el ordenamiento
    if allowed_order and order_by:
        if order_by in allowed_order:
            col = allowed_order[order_by]
        else:
            col = allowed_order.get("id")  # fallback

        if col is not None:
            query = query.order_by(
                col.desc() if direction == "desc" else col.asc())

    # Se obtienen los elementos
    result = await db.exec(query.offset(
        (page-1) * per_page).limit(per_page))
    items = result.all()

    # Se retorna la información de la paginación
    return {
        "total": total,
        "pages": ceil(total/per_page),
        "page": page,
        "per_page": per_page,
        "items": items
    }
