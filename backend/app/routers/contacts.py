from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from pathlib import Path
import uuid
from datetime import date
from .. import crud, models, schemas
from ..database import SessionLocal
from ..services.tech_extractor import extract_technologies

router = APIRouter(prefix="/contacts", tags=["contacts"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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
    combined_tags: list[str] = []
    seen = set()

    for tag_name in payload.tags:
        normalized = tag_name.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        combined_tags.append(normalized)

    for tag_name in extracted_tags:
        key = tag_name.lower()
        if key in seen:
            continue
        seen.add(key)
        combined_tags.append(tag_name)

    for tag_name in combined_tags:
        tag = (
            db.query(models.Tag)
            .filter(func.lower(models.Tag.name) == tag_name.lower())
            .first()
        )
        if tag is None:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        contact.tags.append(tag)

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
def read_contacts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
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
    combined_tags: list[str] = []
    seen = set()
    for tag_name in payload.tags:
        normalized = tag_name.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        combined_tags.append(normalized)

    for tag_name in extracted_tags:
        key = tag_name.lower()
        if key in seen:
            continue
        seen.add(key)
        combined_tags.append(tag_name)

    db_contact.tags.clear()
    for tag_name in combined_tags:
        tag = (
            db.query(models.Tag)
            .filter(func.lower(models.Tag.name) == tag_name.lower())
            .first()
        )
        if tag is None:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        db_contact.tags.append(tag)

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

@router.delete("/{contact_id}")
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    success = crud.delete_contact(db, contact_id=contact_id)
    if not success:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted"}
