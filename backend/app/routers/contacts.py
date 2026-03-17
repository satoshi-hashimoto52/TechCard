from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from pathlib import Path
import uuid
from datetime import date
from .. import crud, models, schemas
from ..database import SessionLocal
from ..services.tech_extractor import extract_technologies

router = APIRouter(prefix="/contacts", tags=["contacts"])
_EVENT_TOP_LEVELS = ("Cards", "Expo", "Mixer", "OJT")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _normalize_tag_type(value: str | None) -> str | None:
    if not value:
        return None
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
    seen = set()
    for item in items:
        normalized_type = _normalize_tag_type(item.type) or "tech"
        name = _normalize_tag_name(item.name or "", normalized_type)
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        tag = (
            db.query(models.Tag)
            .filter(func.lower(models.Tag.name) == key)
            .first()
        )
        if tag is None:
            tag = models.Tag(name=name, type=normalized_type)
            db.add(tag)
            db.flush()
        elif item.type and tag.type in (None, "technology"):
            tag.type = normalized_type
        resolved.append(tag)
    return resolved

def _unique_card_filename(db: Session, filename: str) -> str:
    if not filename:
        return filename
    exists = db.query(models.BusinessCard).filter(models.BusinessCard.filename == filename).first()
    if not exists:
        return filename
    suffix = uuid.uuid4().hex[:8]
    path = Path(filename)
    stem = path.stem or "card"
    ext = path.suffix or ".png"
    return f"{stem}-{suffix}{ext}"

@router.post("/", response_model=schemas.ContactRead)
def create_contact(contact: schemas.ContactCreate, db: Session = Depends(get_db)):
    return crud.create_contact(db=db, contact=contact)

@router.post("/register", response_model=schemas.ContactRead)
def register_contact(payload: schemas.ContactRegisterRequest, db: Session = Depends(get_db)):
    normalized_name = payload.name.strip()
    company = None
    company_name = None
    if payload.company_name:
        company_name = payload.company_name.strip()

    if company_name:
        company = (
            db.query(models.Company)
            .filter(models.Company.name == company_name)
            .first()
        )
        if company is None:
            company = models.Company(name=company_name)
            db.add(company)
            db.flush()

        existing = (
            db.query(models.Contact)
            .filter(models.Contact.name == normalized_name)
            .filter(models.Contact.company_id == company.id)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "同名・同会社の連絡先が存在します。",
                    "existing_contact_id": existing.id,
                },
            )
    else:
        existing = (
            db.query(models.Contact)
            .filter(models.Contact.name == normalized_name)
            .filter(models.Contact.company_id.is_(None))
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "同名の連絡先が存在します。",
                    "existing_contact_id": existing.id,
                },
            )

    contact = models.Contact(
        name=normalized_name,
        email=payload.email,
        phone=payload.phone,
        role=payload.role,
        mobile=payload.mobile,
        postal_code=payload.postal_code,
        address=payload.address,
        branch=payload.branch,
        first_met_at=payload.first_met_at or date.today(),
        company=company,
        notes=payload.notes,
    )
    db.add(contact)

    extracted_tags = extract_technologies(payload.ocr_text or "")
    combined_tags: list[tuple[str, str | None]] = []
    seen = set()

    def add_tag_item(name: str, tag_type: str | None) -> None:
        normalized = _normalize_tag_name(name, tag_type)
        if not normalized:
            return
        key = normalized.lower()
        if key in seen:
            return
        seen.add(key)
        combined_tags.append((normalized, _normalize_tag_type(tag_type)))

    if payload.tag_items:
        for item in payload.tag_items:
            add_tag_item(item.name, item.type)
    else:
        for tag_name in payload.tags:
            add_tag_item(tag_name, None)

    for tag_name in extracted_tags:
        add_tag_item(tag_name, "tech")

    for tag_name, tag_type in combined_tags:
        tag = (
            db.query(models.Tag)
            .filter(func.lower(models.Tag.name) == tag_name.lower())
            .first()
        )
        normalized_type = _normalize_tag_type(tag_type) or "tech"
        if tag is None:
            tag = models.Tag(name=tag_name, type=normalized_type)
            db.add(tag)
            db.flush()
        else:
            if tag_type and tag.type in (None, "technology"):
                tag.type = normalized_type
        effective_type = _normalize_tag_type(tag.type) or normalized_type
        if tag not in contact.tags:
            contact.tags.append(tag)
        if effective_type == "tech":
            if tag not in contact.tech_tags:
                contact.tech_tags.append(tag)

    if company is not None and payload.company_tag_items is not None:
        company.tech_tags = _resolve_tag_items(db, payload.company_tag_items)
    if company is not None and company.group_id and payload.group_tag_items is not None:
        group = (
            db.query(models.CompanyGroup)
            .options(joinedload(models.CompanyGroup.tags))
            .filter(models.CompanyGroup.id == company.group_id)
            .first()
        )
        if group is not None:
            group.tags = _resolve_tag_items(db, payload.group_tag_items)

    if payload.card_filename:
        unique_filename = _unique_card_filename(db, payload.card_filename)
        business_card = models.BusinessCard(
            filename=unique_filename,
            ocr_text=payload.ocr_text,
            contact=contact,
        )
        db.add(business_card)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="連絡先の登録に失敗しました。")
    db.refresh(contact)
    return contact

@router.get("/", response_model=list[schemas.ContactRead])
def read_contacts(skip: int = 0, limit: int | None = None, db: Session = Depends(get_db)):
    contacts = crud.get_contacts(db, skip=skip, limit=limit)
    return contacts

@router.get("/{contact_id}", response_model=schemas.ContactRead)
def read_contact(contact_id: int, db: Session = Depends(get_db)):
    db_contact = crud.get_contact(db, contact_id=contact_id)
    if db_contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return db_contact

@router.put("/{contact_id}", response_model=schemas.ContactRead)
def update_contact(contact_id: int, contact: schemas.ContactBase, db: Session = Depends(get_db)):
    db_contact = crud.update_contact(db, contact_id=contact_id, contact=contact)
    if db_contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return db_contact


@router.put("/{contact_id}/register", response_model=schemas.ContactRead)
def update_registered_contact(contact_id: int, payload: schemas.ContactRegisterRequest, db: Session = Depends(get_db)):
    db_contact = crud.get_contact(db, contact_id=contact_id)
    if db_contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    normalized_name = payload.name.strip()
    company = None
    company_name = payload.company_name.strip() if payload.company_name else None
    if company_name:
        company = (
            db.query(models.Company)
            .filter(models.Company.name == company_name)
            .first()
        )
        if company is None:
            company = models.Company(name=company_name)
            db.add(company)
            db.flush()

    existing = (
        db.query(models.Contact)
        .filter(models.Contact.name == normalized_name)
        .filter(models.Contact.company_id == (company.id if company else None))
        .filter(models.Contact.id != contact_id)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "同名・同会社の連絡先が存在します。",
                "existing_contact_id": existing.id,
            },
        )

    old_company_id = db_contact.company_id
    db_contact.name = normalized_name
    db_contact.email = payload.email
    db_contact.phone = payload.phone
    db_contact.role = payload.role
    db_contact.mobile = payload.mobile
    db_contact.postal_code = payload.postal_code
    db_contact.address = payload.address
    db_contact.branch = payload.branch
    if payload.first_met_at is not None:
        db_contact.first_met_at = payload.first_met_at
    db_contact.notes = payload.notes
    db_contact.company = company

    extracted_tags = extract_technologies(payload.ocr_text or "")
    combined_tags: list[tuple[str, str | None]] = []
    seen = set()

    def add_tag_item(name: str, tag_type: str | None) -> None:
        normalized = _normalize_tag_name(name, tag_type)
        if not normalized:
            return
        key = normalized.lower()
        if key in seen:
            return
        seen.add(key)
        combined_tags.append((normalized, _normalize_tag_type(tag_type)))

    if payload.tag_items:
        for item in payload.tag_items:
            add_tag_item(item.name, item.type)
    else:
        for tag_name in payload.tags:
            add_tag_item(tag_name, None)

    for tag_name in extracted_tags:
        add_tag_item(tag_name, "tech")

    db_contact.tags.clear()
    db_contact.tech_tags.clear()
    for tag_name, tag_type in combined_tags:
        tag = (
            db.query(models.Tag)
            .filter(func.lower(models.Tag.name) == tag_name.lower())
            .first()
        )
        normalized_type = _normalize_tag_type(tag_type) or "tech"
        if tag is None:
            tag = models.Tag(name=tag_name, type=normalized_type)
            db.add(tag)
            db.flush()
        else:
            if tag_type and tag.type in (None, "technology"):
                tag.type = normalized_type
        effective_type = _normalize_tag_type(tag.type) or normalized_type
        if tag not in db_contact.tags:
            db_contact.tags.append(tag)
        if effective_type == "tech":
            if tag not in db_contact.tech_tags:
                db_contact.tech_tags.append(tag)

    if company is not None and payload.company_tag_items is not None:
        company.tech_tags = _resolve_tag_items(db, payload.company_tag_items)
    if company is not None and company.group_id and payload.group_tag_items is not None:
        group = (
            db.query(models.CompanyGroup)
            .options(joinedload(models.CompanyGroup.tags))
            .filter(models.CompanyGroup.id == company.group_id)
            .first()
        )
        if group is not None:
            group.tags = _resolve_tag_items(db, payload.group_tag_items)

    if payload.card_filename:
        unique_filename = _unique_card_filename(db, payload.card_filename)
        business_card = models.BusinessCard(
            filename=unique_filename,
            ocr_text=payload.ocr_text,
            contact=db_contact,
        )
        db.add(business_card)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="連絡先の更新に失敗しました。")
    db.refresh(db_contact)
    return db_contact

@router.put("/{contact_id}/self", response_model=schemas.ContactRead)
def set_self_contact(contact_id: int, payload: schemas.ContactSelfRequest, db: Session = Depends(get_db)):
    db_contact = crud.get_contact(db, contact_id=contact_id)
    if db_contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")

    if payload.is_self:
        db.query(models.Contact).filter(models.Contact.id != contact_id).filter(models.Contact.is_self.is_(True)).update(
            {models.Contact.is_self: False},
            synchronize_session=False,
        )
        db_contact.is_self = True
    else:
        db_contact.is_self = False

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="自分の更新に失敗しました。")
    db.refresh(db_contact)
    return db_contact

@router.delete("/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    success = crud.delete_contact(db, contact_id=contact_id)
    if not success:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted"}
