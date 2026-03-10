from sqlalchemy.orm import Session
from . import models, schemas
from typing import List

# Company CRUD
def create_company(db: Session, company: schemas.CompanyCreate) -> models.Company:
    db_company = models.Company(**company.dict())
    db.add(db_company)
    db.commit()
    db.refresh(db_company)
    return db_company

def get_company(db: Session, company_id: int) -> models.Company:
    return db.query(models.Company).filter(models.Company.id == company_id).first()

def get_companies(db: Session, skip: int = 0, limit: int = 100) -> List[models.Company]:
    return db.query(models.Company).offset(skip).limit(limit).all()

def update_company(db: Session, company_id: int, company: schemas.CompanyBase) -> models.Company:
    db_company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if db_company:
        for key, value in company.dict().items():
            setattr(db_company, key, value)
        db.commit()
        db.refresh(db_company)
    return db_company

def delete_company(db: Session, company_id: int) -> bool:
    db_company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if db_company:
        db.delete(db_company)
        db.commit()
        return True
    return False

# Contact CRUD
def create_contact(db: Session, contact: schemas.ContactCreate) -> models.Contact:
    db_contact = models.Contact(**contact.dict())
    db.add(db_contact)
    db.commit()
    db.refresh(db_contact)
    return db_contact

def get_contact(db: Session, contact_id: int) -> models.Contact:
    return db.query(models.Contact).filter(models.Contact.id == contact_id).first()

def get_contacts(db: Session, skip: int = 0, limit: int = 100) -> List[models.Contact]:
    return db.query(models.Contact).offset(skip).limit(limit).all()

def update_contact(db: Session, contact_id: int, contact: schemas.ContactBase) -> models.Contact:
    db_contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if db_contact:
        for key, value in contact.dict().items():
            setattr(db_contact, key, value)
        db.commit()
        db.refresh(db_contact)
    return db_contact

def delete_contact(db: Session, contact_id: int) -> bool:
    db_contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if db_contact:
        db.delete(db_contact)
        db.commit()
        return True
    return False

# Tag CRUD
def create_tag(db: Session, tag: schemas.TagCreate) -> models.Tag:
    db_tag = models.Tag(**tag.dict())
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    return db_tag

def get_tag(db: Session, tag_id: int) -> models.Tag:
    return db.query(models.Tag).filter(models.Tag.id == tag_id).first()

def get_tags(db: Session, skip: int = 0, limit: int = 100) -> List[models.Tag]:
    return db.query(models.Tag).offset(skip).limit(limit).all()

def update_tag(db: Session, tag_id: int, tag: schemas.TagBase) -> models.Tag:
    db_tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if db_tag:
        for key, value in tag.dict(exclude_none=True).items():
            setattr(db_tag, key, value)
        db.commit()
        db.refresh(db_tag)
    return db_tag

def delete_tag(db: Session, tag_id: int) -> bool:
    db_tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if db_tag:
        db.delete(db_tag)
        db.commit()
        return True
    return False

# Meeting CRUD
def create_meeting(db: Session, meeting: schemas.MeetingCreate) -> models.Meeting:
    db_meeting = models.Meeting(**meeting.dict())
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting

def get_meeting(db: Session, meeting_id: int) -> models.Meeting:
    return db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()

def get_meetings(db: Session, skip: int = 0, limit: int = 100) -> List[models.Meeting]:
    return db.query(models.Meeting).offset(skip).limit(limit).all()

def update_meeting(db: Session, meeting_id: int, meeting: schemas.MeetingBase) -> models.Meeting:
    db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if db_meeting:
        for key, value in meeting.dict().items():
            setattr(db_meeting, key, value)
        db.commit()
        db.refresh(db_meeting)
    return db_meeting

def delete_meeting(db: Session, meeting_id: int) -> bool:
    db_meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if db_meeting:
        db.delete(db_meeting)
        db.commit()
        return True
    return False

# BusinessCard CRUD
def create_business_card(db: Session, business_card: schemas.BusinessCardCreate) -> models.BusinessCard:
    db_business_card = models.BusinessCard(**business_card.dict())
    db.add(db_business_card)
    db.commit()
    db.refresh(db_business_card)
    return db_business_card

def get_business_card(db: Session, business_card_id: int) -> models.BusinessCard:
    return db.query(models.BusinessCard).filter(models.BusinessCard.id == business_card_id).first()

def get_business_cards(db: Session, skip: int = 0, limit: int = 100) -> List[models.BusinessCard]:
    return db.query(models.BusinessCard).offset(skip).limit(limit).all()

def update_business_card(db: Session, business_card_id: int, business_card: schemas.BusinessCardBase) -> models.BusinessCard:
    db_business_card = db.query(models.BusinessCard).filter(models.BusinessCard.id == business_card_id).first()
    if db_business_card:
        for key, value in business_card.dict().items():
            setattr(db_business_card, key, value)
        db.commit()
        db.refresh(db_business_card)
    return db_business_card

def delete_business_card(db: Session, business_card_id: int) -> bool:
    db_business_card = db.query(models.BusinessCard).filter(models.BusinessCard.id == business_card_id).first()
    if db_business_card:
        db.delete(db_business_card)
        db.commit()
        return True
    return False
