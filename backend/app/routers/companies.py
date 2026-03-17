from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from .. import crud, models, schemas
from ..database import SessionLocal

router = APIRouter(prefix="/companies", tags=["companies"])
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


@router.get("/resolve", response_model=schemas.CompanyTagResolveResponse)
def resolve_company(name: str = Query(...), db: Session = Depends(get_db)):
    normalized = (name or "").strip()
    if not normalized:
        return schemas.CompanyTagResolveResponse()
    company = (
        db.query(models.Company)
        .options(
            joinedload(models.Company.tech_tags),
            joinedload(models.Company.group).joinedload(models.CompanyGroup.tags),
        )
        .filter(func.lower(models.Company.name) == normalized.lower())
        .first()
    )
    if not company:
        return schemas.CompanyTagResolveResponse()
    group = company.group
    return schemas.CompanyTagResolveResponse(
        company_id=company.id,
        group_id=group.id if group else None,
        group_name=group.name if group else None,
        company_tags=[schemas.TagRead(id=tag.id, name=tag.name, type=tag.type) for tag in (company.tech_tags or [])],
        group_tags=[schemas.TagRead(id=tag.id, name=tag.name, type=tag.type) for tag in (group.tags or [])] if group else [],
    )


@router.get("/{company_id}/tags", response_model=list[schemas.TagRead])
def read_company_tags(company_id: int, db: Session = Depends(get_db)):
    company = (
        db.query(models.Company)
        .options(joinedload(models.Company.tech_tags))
        .filter(models.Company.id == company_id)
        .first()
    )
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    tags = sorted(company.tech_tags or [], key=lambda tag: tag.name or "")
    return [schemas.TagRead(id=tag.id, name=tag.name, type=tag.type) for tag in tags]


@router.put("/{company_id}/tags", response_model=list[schemas.TagRead])
def update_company_tags(company_id: int, payload: schemas.TagBindingRequest, db: Session = Depends(get_db)):
    company = (
        db.query(models.Company)
        .options(joinedload(models.Company.tech_tags))
        .filter(models.Company.id == company_id)
        .first()
    )
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    company.tech_tags = _resolve_tag_items(db, payload.tag_items or [])
    db.commit()
    db.refresh(company)
    tags = sorted(company.tech_tags or [], key=lambda tag: tag.name or "")
    return [schemas.TagRead(id=tag.id, name=tag.name, type=tag.type) for tag in tags]

@router.post("/", response_model=schemas.CompanyRead)
def create_company(company: schemas.CompanyCreate, db: Session = Depends(get_db)):
    return crud.create_company(db=db, company=company)

@router.get("/", response_model=list[schemas.CompanyRead])
def read_companies(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    companies = crud.get_companies(db, skip=skip, limit=limit)
    return companies

@router.get("/{company_id}", response_model=schemas.CompanyRead)
def read_company(company_id: int, db: Session = Depends(get_db)):
    db_company = crud.get_company(db, company_id=company_id)
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return db_company


@router.get("/{company_id}/detail", response_model=schemas.CompanyDetail)
def read_company_detail(company_id: int, db: Session = Depends(get_db)):
    company = (
        db.query(models.Company)
        .options(
            joinedload(models.Company.group),
            joinedload(models.Company.tech_tags),
            joinedload(models.Company.contacts),
        )
        .filter(models.Company.id == company_id)
        .first()
    )
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    contacts = [
        {"id": contact.id, "name": contact.name}
        for contact in (company.contacts or [])
    ]
    tech_names: dict[str, None] = {}
    for tag in company.tech_tags or []:
        if tag.name:
            tech_names[tag.name] = None
    tech_list = sorted(tech_names.keys(), key=lambda name: name)

    return schemas.CompanyDetail(
        id=company.id,
        name=company.name,
        group_id=company.group_id,
        group_name=company.group.name if company.group else None,
        tech_tags=tech_list,
        contacts=contacts,
    )

@router.put("/{company_id}", response_model=schemas.CompanyRead)
def update_company(company_id: int, company: schemas.CompanyBase, db: Session = Depends(get_db)):
    db_company = crud.update_company(db, company_id=company_id, company=company)
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return db_company


@router.put("/{company_id}/group", response_model=schemas.CompanyRead)
def update_company_group(company_id: int, payload: schemas.CompanyGroupUpdate, db: Session = Depends(get_db)):
    db_company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    db_company.group_id = payload.group_id
    db.commit()
    db.refresh(db_company)
    return db_company

@router.delete("/{company_id}")
def delete_company(company_id: int, db: Session = Depends(get_db)):
    success = crud.delete_company(db, company_id=company_id)
    if not success:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"message": "Company deleted"}
