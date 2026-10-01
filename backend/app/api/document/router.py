"""Admin-only documents: the corpus the RAG ingestion will read.

Files live in object storage and travel through this API (upload and
streaming download); the browser never reaches SeaweedFS. Delete is a hard
delete (object first, then row): re-uploading the same bytes must stay
possible because `sha256` is unique, and the future RAG chunks will cascade
from the row, so a soft-deleted shell would only leave stale vectors behind.
"""

import codecs
import hashlib
import re
import unicodedata
import uuid
from contextlib import contextmanager
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.auth.models import User
from app.api.document import constants
from app.api.document.models import Document
from app.api.document.schemas import DocumentPatch, DocumentRead
from app.core.dependencies import AuthedAsyncDBSession, get_current_user
from app.core.search import ILIKE_ESCAPE, ilike_pattern
from app.core.sorting import parse_sort
from app.core.storage import ObjectStorage, StorageUnavailable, get_storage

CHUNK_SIZE = 64 * 1024
ZIP_MAGIC = b"PK\x03\x04"
PDF_MAGIC = b"%PDF-"

SORT_FIELDS = {
    "title": "title",
    "filename": "filename",
    "contentType": "content_type",
    "sizeBytes": "size_bytes",
    "ingestionStatus": "ingestion_status",
    "isActive": "is_active",
    "createdAt": "created_at",
}
_TEXT_SORTS = {"title", "filename", "content_type"}


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden gestionar documentos",
        )
    return current_user


router = APIRouter(dependencies=[Depends(require_admin)])


@contextmanager
def storage_errors():
    try:
        yield
    except StorageUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Almacenamiento no disponible",
        ) from None


def clean_filename(raw: str | None) -> str:
    """Basename only, without control or bidi characters, bounded length."""
    name = PurePosixPath((raw or "").replace("\\", "/")).name
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")
    name = re.sub(r"\s+", " ", name).strip(" .")
    if len(name) > constants.MAX_FILENAME_LENGTH:
        stem, dot, ext = name.rpartition(".")
        keep = constants.MAX_FILENAME_LENGTH - len(ext) - 1
        name = f"{stem[:keep]}.{ext}" if dot else name[: constants.MAX_FILENAME_LENGTH]
    return name


def _unsupported(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail)


async def inspect_upload(file: UploadFile, extension: str) -> tuple[str, int]:
    """Stream the upload once: size cap, sha256 and a content check per type."""
    limit = constants.MAX_DOCUMENT_BYTES
    digest = hashlib.sha256()
    decoder = codecs.getincrementaldecoder("utf-8")() if extension in {"txt", "md"} else None
    size = 0
    head = b""
    await file.seek(0)
    while chunk := await file.read(CHUNK_SIZE):
        size += len(chunk)
        if size > limit:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f"El archivo supera el máximo de {limit // (1024 * 1024) or 1} MB",
            )
        if len(head) < 8:
            head = (head + chunk)[:8]
        digest.update(chunk)
        if decoder is not None:
            try:
                text = decoder.decode(chunk)
            except UnicodeDecodeError:
                raise _unsupported("El archivo de texto debe estar codificado en UTF-8") from None
            if "\x00" in text:
                raise _unsupported("El archivo de texto contiene datos binarios")
    if size == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "El archivo está vacío")
    if decoder is not None:
        try:
            decoder.decode(b"", final=True)
        except UnicodeDecodeError:
            raise _unsupported("El archivo de texto debe estar codificado en UTF-8") from None
    if extension == "pdf" and not head.startswith(PDF_MAGIC):
        raise _unsupported("El contenido no es un PDF válido")
    if extension == "docx" and not head.startswith(ZIP_MAGIC):
        raise _unsupported("El contenido no es un DOCX válido")
    await file.seek(0)
    return digest.hexdigest(), size


@router.post("", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def upload_document(
    session: AuthedAsyncDBSession,
    admin: User = Depends(require_admin),
    storage: ObjectStorage = Depends(get_storage),
    file: UploadFile = File(...),
    title: str | None = Form(None),
):
    filename = clean_filename(file.filename)
    extension = filename.rpartition(".")[2].lower() if "." in filename else ""
    if extension not in constants.CONTENT_TYPES:
        allowed = ", ".join(f".{ext}" for ext in constants.CONTENT_TYPES)
        raise _unsupported(f"Tipo de archivo no permitido. Formatos admitidos: {allowed}")
    clean_title = (title or "").strip() or filename.rpartition(".")[0] or filename
    if len(clean_title) > constants.MAX_TITLE_LENGTH:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"El título supera los {constants.MAX_TITLE_LENGTH} caracteres",
        )

    sha256, size = await inspect_upload(file, extension)
    duplicate = (await session.execute(select(Document.id).where(Document.sha256 == sha256))).first()
    if duplicate is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un documento con el mismo contenido")

    document = Document(
        title=clean_title,
        filename=filename,
        content_type=constants.CONTENT_TYPES[extension],
        size_bytes=size,
        sha256=sha256,
        storage_key="",
        uploaded_by=admin.id,
    )
    document.storage_key = f"documents/{document.id}/{sha256}.{extension}"
    with storage_errors():
        await storage.put(
            document.storage_key, file.file, content_type=document.content_type, sha256=sha256, size=size
        )
    try:
        # SAVEPOINT: a full rollback would also revert the uncommitted RLS identity of this session.
        async with session.begin_nested():
            session.add(document)
        await session.commit()
    except IntegrityError:
        await _discard_object(storage, document.storage_key)
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya existe un documento con el mismo contenido") from None
    except Exception:
        await _discard_object(storage, document.storage_key)
        raise
    await session.refresh(document)
    return document


async def _discard_object(storage: ObjectStorage, key: str) -> None:
    try:
        await storage.delete(key)
    except StorageUnavailable:
        pass  # orphan object only; the row never existed


@router.get("", response_model=None)
async def list_documents(
    session: AuthedAsyncDBSession,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    search: str | None = None,
    file_type: Literal["pdf", "txt", "md", "docx"] | None = None,
    ingestion_status: Literal["pending", "processing", "ready", "failed"] | None = None,
    is_active: bool | None = None,
    sort: str | None = None,
):
    query = select(Document)
    if file_type:
        query = query.where(Document.content_type == constants.CONTENT_TYPES[file_type])
    if ingestion_status:
        query = query.where(Document.ingestion_status == ingestion_status)
    if is_active is not None:
        query = query.where(Document.is_active.is_(is_active))
    pattern = ilike_pattern(search)
    if pattern is not None:
        query = query.where(
            or_(
                Document.title.ilike(pattern, escape=ILIKE_ESCAPE),
                Document.filename.ilike(pattern, escape=ILIKE_ESCAPE),
            )
        )
    total = (await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()

    spec = parse_sort(sort, SORT_FIELDS, max_fields=3) or (("created_at", "desc"),)
    ordering = []
    for field, direction in spec:
        column = getattr(Document, field)
        expression = func.lower(column) if field in _TEXT_SORTS else column
        ordering.append(expression.desc() if direction == "desc" else expression.asc())
    rows = (
        await session.execute(
            query.order_by(*ordering, Document.id.asc()).offset((page - 1) * per_page).limit(per_page)
        )
    ).scalars().all()
    return {
        "items": [DocumentRead.model_validate(row) for row in rows],
        "total": total,
        "page": page,
        "perPage": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


async def _get_or_404(session: AuthedAsyncDBSession, document_id: uuid.UUID) -> Document:
    document = await session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
    return document


@router.get("/{document_id}", response_model=DocumentRead)
async def get_document(document_id: uuid.UUID, session: AuthedAsyncDBSession):
    return await _get_or_404(session, document_id)


@router.get("/{document_id}/download")
async def download_document(
    document_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    storage: ObjectStorage = Depends(get_storage),
):
    document = await _get_or_404(session, document_id)
    with storage_errors():
        present = await storage.exists(document.storage_key)
    if not present:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El archivo no se encuentra en el almacenamiento")
    ascii_name = re.sub(r'[^A-Za-z0-9._ -]', "_", document.filename)
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(document.filename, safe='')}"
    return StreamingResponse(
        storage.stream(document.storage_key),
        media_type=document.content_type,
        headers={
            "Content-Disposition": disposition,
            "Content-Length": str(document.size_bytes),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.patch("/{document_id}", response_model=DocumentRead)
async def patch_document(document_id: uuid.UUID, body: DocumentPatch, session: AuthedAsyncDBSession):
    document = await _get_or_404(session, document_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(document, key, value)
    await session.commit()
    await session.refresh(document)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    storage: ObjectStorage = Depends(get_storage),
):
    document = await _get_or_404(session, document_id)
    # Object first: if it fails the row stays and the delete can be retried;
    # deleting a missing object is a no-op, so a half-done delete is repairable.
    with storage_errors():
        await storage.delete(document.storage_key)
    await session.delete(document)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
