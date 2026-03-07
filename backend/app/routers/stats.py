from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from ..database import SessionLocal
from .. import models

router = APIRouter(prefix="/stats", tags=["stats"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    contacts = (
        db.query(models.Contact)
        .order_by(models.Contact.name.asc())
        .all()
    )
    companies = (
        db.query(
            models.Company.name.label("name"),
            func.count(models.Contact.id).label("contact_count"),
        )
        .join(models.Contact, models.Contact.company_id == models.Company.id, isouter=True)
        .group_by(models.Company.id)
        .having(func.count(models.Contact.id) > 0)
        .order_by(func.count(models.Contact.id).desc(), models.Company.name.asc())
        .all()
    )
    tags = (
        db.query(
            models.Tag.name.label("name"),
            func.count(models.contact_tags.c.contact_id).label("contact_count"),
        )
        .join(models.contact_tags, models.contact_tags.c.tag_id == models.Tag.id, isouter=True)
        .group_by(models.Tag.id)
        .having(func.count(models.contact_tags.c.contact_id) > 0)
        .order_by(func.count(models.contact_tags.c.contact_id).desc(), models.Tag.name.asc())
        .all()
    )
    meetings = (
        db.query(models.Meeting)
        .options(joinedload(models.Meeting.contact))
        .order_by(models.Meeting.timestamp.desc())
        .all()
    )

    contact_payload = [{"id": contact.id, "name": contact.name} for contact in contacts]
    company_payload = [{"name": row.name, "count": row.contact_count} for row in companies]
    tag_payload = [{"name": row.name, "count": row.contact_count} for row in tags]
    meeting_payload = [
        {
            "id": meeting.id,
            "timestamp": meeting.timestamp.isoformat() if meeting.timestamp else None,
            "contact_name": meeting.contact.name if meeting.contact else None,
        }
        for meeting in meetings
    ]

    return {
        "counts": {
            "contacts": len(contact_payload),
            "companies": len(company_payload),
            "tags": len(tag_payload),
            "meetings": len(meeting_payload),
        },
        "lists": {
            "contacts": contact_payload,
            "companies": company_payload,
            "tags": tag_payload,
            "meetings": meeting_payload,
        },
    }
