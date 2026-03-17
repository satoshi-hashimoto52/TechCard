from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from .. import crud, models, schemas
from ..database import SessionLocal
from ..services.tech_extractor import extract_technologies

router = APIRouter(prefix="/tags", tags=["tags"])
_EVENT_TOP_LEVELS = ("Cards", "Expo", "Mixer", "OJT")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _normalize_tag_type(value: str | None) -> str:
    if not value:
        return "tech"
    if value in ("tech", "technology"):
        return "tech"
    if value == "event":
        return "event"
    if value == "relation":
        return "relation"
    return value


def _normalize_event_tag_name(value: str) -> str:
    name = (value or "").strip()
    for separator in ("::", "/", "／", ">", "＞"):
        if separator not in name:
            continue
        top_raw, child_raw = name.split(separator, 1)
        top_token = top_raw.replace("#", "").strip().lower()
        child = child_raw.strip()
        if not child:
            continue
        top = next((item for item in _EVENT_TOP_LEVELS if item.lower() == top_token), None)
        if top is None:
            continue
        return f"#{top} / {child}"
    return name


def _normalize_tag_payload(name: str, tag_type: str | None) -> tuple[str, str]:
    normalized_type = _normalize_tag_type(tag_type)
    normalized_name = (name or "").strip()
    if normalized_type == "event":
        normalized_name = _normalize_event_tag_name(normalized_name)
    return normalized_name, normalized_type

@router.post("/", response_model=schemas.TagRead)
def create_tag(tag: schemas.TagCreate, db: Session = Depends(get_db)):
    normalized_name, normalized_type = _normalize_tag_payload(tag.name, tag.type)
    payload = schemas.TagCreate(name=normalized_name, type=normalized_type)
    try:
        return crud.create_tag(db=db, tag=payload)
    except IntegrityError:
        db.rollback()
        existing = db.query(models.Tag).filter(models.Tag.name == normalized_name).first()
        if existing is None:
            raise
        return existing

@router.get("/", response_model=list[schemas.TagRead])
def read_tags(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    tags = crud.get_tags(db, skip=skip, limit=limit)
    return tags

@router.get("/{tag_id}", response_model=schemas.TagRead)
def read_tag(tag_id: int, db: Session = Depends(get_db)):
    db_tag = crud.get_tag(db, tag_id=tag_id)
    if db_tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    return db_tag

@router.put("/{tag_id}", response_model=schemas.TagRead)
def update_tag(tag_id: int, tag: schemas.TagBase, db: Session = Depends(get_db)):
    normalized_name, normalized_type = _normalize_tag_payload(tag.name, tag.type)
    db_tag = crud.update_tag(
        db,
        tag_id=tag_id,
        tag=schemas.TagBase(name=normalized_name, type=normalized_type),
    )
    if db_tag is None:
        raise HTTPException(status_code=404, detail="Tag not found")
    return db_tag

@router.delete("/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    success = crud.delete_tag(db, tag_id=tag_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tag not found")
    return {"message": "Tag deleted"}

@router.post("/extract", response_model=schemas.TechExtractResponse)
def extract_tags(payload: schemas.TechExtractRequest):
    tags = extract_technologies(payload.text)
    return {"tags": tags}
