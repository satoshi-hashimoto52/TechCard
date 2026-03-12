from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from ..database import SessionLocal
from .. import models, schemas

router = APIRouter(prefix="/events", tags=["events"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _event_payload(event: models.Event) -> schemas.EventRead:
    contact_ids = [contact.id for contact in (event.contacts or [])]
    return schemas.EventRead(
        id=event.id,
        name=event.name,
        start_date=event.start_date,
        end_date=event.end_date,
        location=event.location,
        year=event.year,
        contact_ids=contact_ids,
    )


@router.get("/", response_model=list[schemas.EventRead])
def read_events(db: Session = Depends(get_db)):
    events = (
        db.query(models.Event)
        .options(joinedload(models.Event.contacts))
        .order_by(models.Event.start_date.is_(None), models.Event.start_date.asc(), models.Event.name.asc())
        .all()
    )
    return [_event_payload(event) for event in events]


@router.get("/{event_id}", response_model=schemas.EventDetail)
def read_event(event_id: int, db: Session = Depends(get_db)):
    event = (
        db.query(models.Event)
        .options(joinedload(models.Event.contacts).joinedload(models.Contact.company))
        .filter(models.Event.id == event_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    participants = []
    companies = {}
    for contact in event.contacts or []:
        participants.append(
            {
                "id": contact.id,
                "name": contact.name,
                "company_name": contact.company.name if contact.company else None,
            }
        )
        if contact.company:
            companies.setdefault(contact.company.id, contact.company.name or "")
    company_items = [{"id": cid, "name": name} for cid, name in companies.items()]
    return schemas.EventDetail(
        id=event.id,
        name=event.name,
        start_date=event.start_date,
        end_date=event.end_date,
        location=event.location,
        year=event.year,
        participants=participants,
        companies=company_items,
    )


@router.post("/", response_model=schemas.EventRead)
def create_event(payload: schemas.EventCreate, db: Session = Depends(get_db)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="イベント名を入力してください。")
    existing = db.query(models.Event).filter(models.Event.name == name).first()
    if existing:
        raise HTTPException(status_code=409, detail="同名のイベントが既に存在します。")

    event = models.Event(
        name=name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        location=payload.location,
        year=payload.year,
    )
    if payload.contact_ids:
        contacts = db.query(models.Contact).filter(models.Contact.id.in_(payload.contact_ids)).all()
        event.contacts = contacts
    db.add(event)
    db.commit()
    db.refresh(event)
    return _event_payload(event)


@router.post("/{event_id}/participants")
def add_participants(event_id: int, contact_ids: list[int], db: Session = Depends(get_db)):
    event = (
        db.query(models.Event)
        .options(joinedload(models.Event.contacts))
        .filter(models.Event.id == event_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not contact_ids:
        return {"added": 0}
    contacts = db.query(models.Contact).filter(models.Contact.id.in_(contact_ids)).all()
    added = 0
    for contact in contacts:
        if contact not in (event.contacts or []):
            event.contacts.append(contact)
            added += 1
    db.commit()
    return {"added": added}


@router.delete("/{event_id}/participants/{contact_id}")
def remove_participant(event_id: int, contact_id: int, db: Session = Depends(get_db)):
    event = (
        db.query(models.Event)
        .options(joinedload(models.Event.contacts))
        .filter(models.Event.id == event_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    contact = next((item for item in (event.contacts or []) if item.id == contact_id), None)
    if not contact:
        raise HTTPException(status_code=404, detail="Participant not found")
    event.contacts.remove(contact)
    db.commit()
    return {"removed": True}
