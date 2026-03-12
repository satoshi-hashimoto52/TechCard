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
