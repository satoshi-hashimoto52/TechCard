from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from ..database import SessionLocal
from .. import models, schemas

router = APIRouter(prefix="/company-groups", tags=["company-groups"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _group_payload(group: models.CompanyGroup) -> schemas.CompanyGroupRead:
    return schemas.CompanyGroupRead(
        id=group.id,
        name=group.name,
        description=group.description,
        company_ids=[company.id for company in (group.companies or [])],
        aliases=[alias.alias for alias in (group.aliases or []) if alias.alias],
    )


@router.get("/", response_model=list[schemas.CompanyGroupRead])
def read_groups(db: Session = Depends(get_db)):
    groups = (
        db.query(models.CompanyGroup)
        .options(joinedload(models.CompanyGroup.companies), joinedload(models.CompanyGroup.aliases))
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
