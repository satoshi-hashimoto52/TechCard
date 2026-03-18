from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from ..database import SessionLocal
from .. import models, schemas

router = APIRouter(prefix="/company-groups", tags=["company-groups"])
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


def _normalize_tag_name(name: str, tag_type: str | None) -> str:
    normalized = (name or "").strip()
    if not normalized:
        return normalized
    if _normalize_tag_type(tag_type) == "event":
        return _normalize_event_tag_name(normalized)
    return normalized


def _resolve_tag_items(db: Session, items: list[schemas.ContactTagItem]) -> list[models.Tag]:
    resolved: list[models.Tag] = []
    seen: set[str] = set()
    for item in items:
        normalized_type = _normalize_tag_type(item.type)
        name = _normalize_tag_name(item.name or "", normalized_type)
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        tag = db.query(models.Tag).filter(func.lower(models.Tag.name) == key).first()
        if tag is None:
            tag = models.Tag(name=name, type=normalized_type)
            db.add(tag)
            db.flush()
        elif item.type and tag.type in (None, "technology"):
            tag.type = normalized_type
        resolved.append(tag)
    return resolved


def _group_payload(group: models.CompanyGroup) -> schemas.CompanyGroupRead:
    return schemas.CompanyGroupRead(
        id=group.id,
        name=group.name,
        description=group.description,
        company_ids=[company.id for company in (group.companies or [])],
        aliases=[alias.alias for alias in (group.aliases or []) if alias.alias],
        tags=[schemas.TagRead(id=tag.id, name=tag.name, type=tag.type) for tag in (group.tags or [])],
    )


@router.get("/{group_id}/tags", response_model=list[schemas.TagRead])
def read_group_tags(group_id: int, db: Session = Depends(get_db)):
    group = (
        db.query(models.CompanyGroup)
        .options(joinedload(models.CompanyGroup.tags))
        .filter(models.CompanyGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    tags = sorted(group.tags or [], key=lambda tag: tag.name or "")
    return [schemas.TagRead(id=tag.id, name=tag.name, type=tag.type) for tag in tags]


@router.put("/{group_id}/tags", response_model=list[schemas.TagRead])
def update_group_tags(group_id: int, payload: schemas.TagBindingRequest, db: Session = Depends(get_db)):
    group = (
        db.query(models.CompanyGroup)
        .options(joinedload(models.CompanyGroup.tags))
        .filter(models.CompanyGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    group.tags = _resolve_tag_items(db, payload.tag_items or [])
    db.commit()
    db.refresh(group)
    tags = sorted(group.tags or [], key=lambda tag: tag.name or "")
    return [schemas.TagRead(id=tag.id, name=tag.name, type=tag.type) for tag in tags]


@router.get("/", response_model=list[schemas.CompanyGroupRead])
def read_groups(db: Session = Depends(get_db)):
    groups = (
        db.query(models.CompanyGroup)
        .options(
            joinedload(models.CompanyGroup.companies),
            joinedload(models.CompanyGroup.aliases),
            joinedload(models.CompanyGroup.tags),
        )
        .order_by(models.CompanyGroup.name.asc())
        .all()
    )
    return [_group_payload(group) for group in groups]


@router.post("/", response_model=schemas.CompanyGroupRead)
def create_group(payload: schemas.CompanyGroupCreate, db: Session = Depends(get_db)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="グループ名を入力してください。")
    existing = db.query(models.CompanyGroup).filter(func.lower(models.CompanyGroup.name) == name.lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail="同名のグループが既に存在します。")
    group = models.CompanyGroup(name=name, description=payload.description)
    db.add(group)
    db.commit()
    db.refresh(group)
    return _group_payload(group)


@router.put("/{group_id}", response_model=schemas.CompanyGroupRead)
def update_group(group_id: int, payload: schemas.CompanyGroupCreate, db: Session = Depends(get_db)):
    group = db.query(models.CompanyGroup).filter(models.CompanyGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="グループ名を入力してください。")
    group.name = name
    group.description = payload.description
    db.commit()
    db.refresh(group)
    return _group_payload(group)


@router.post("/{group_id}/aliases", response_model=schemas.CompanyGroupRead)
def add_alias(group_id: int, alias: str = Query(...), db: Session = Depends(get_db)):
    group = (
        db.query(models.CompanyGroup)
        .options(joinedload(models.CompanyGroup.aliases))
        .filter(models.CompanyGroup.id == group_id)
        .first()
    )
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    normalized = alias.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Aliasを入力してください。")
    exists = any(a.alias and a.alias.lower() == normalized.lower() for a in (group.aliases or []))
    if not exists:
        group.aliases.append(models.CompanyGroupAlias(alias=normalized))
        db.commit()
        db.refresh(group)
    return _group_payload(group)


@router.get("/suggest")
def suggest_group(name: str = Query(...), db: Session = Depends(get_db)):
    query = (name or "").strip()
    if not query:
        return []
    lowered = query.lower()
    groups = (
        db.query(models.CompanyGroup)
        .options(joinedload(models.CompanyGroup.aliases))
        .all()
    )
    matches = []
    for group in groups:
        if group.name and group.name.lower() in lowered:
            matches.append({"id": group.id, "name": group.name})
            continue
        for alias in group.aliases or []:
            if alias.alias and alias.alias.lower() in lowered:
                matches.append({"id": group.id, "name": group.name})
                break
    return matches
