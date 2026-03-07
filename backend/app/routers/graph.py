from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from ..database import SessionLocal
from .. import models

router = APIRouter(prefix="/graph", tags=["graph"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/network")
def get_network_graph(
    technology: str | None = Query(default=None),
    company: str | None = Query(default=None),
    person: str | None = Query(default=None),
    person_id: int | None = Query(default=None, ge=1),
    limit_contacts: int = Query(default=50, ge=1),
    limit_meetings: int = Query(default=100, ge=0),
    db: Session = Depends(get_db),
):
    contacts = (
        db.query(models.Contact)
        .options(
            joinedload(models.Contact.company),
            joinedload(models.Contact.tags),
            joinedload(models.Contact.meetings),
        )
        .all()
    )

    tech_filter = technology.strip() if technology else None
    company_filter = company.strip() if company else None
    person_filter = person.strip() if person else None
    if tech_filter:
        lowered = tech_filter.lower()
        contacts = [
            contact
            for contact in contacts
            if any(tag.name and lowered in tag.name.lower() for tag in contact.tags)
        ]

    if company_filter:
        lowered = company_filter.lower()
        contacts = [
            contact
            for contact in contacts
            if contact.company and contact.company.name and lowered in contact.company.name.lower()
        ]

    if person_filter:
        lowered = person_filter.lower()
        contacts = [
            contact
            for contact in contacts
            if contact.name and lowered in contact.name.lower()
        ]

    if person_id:
        contacts = [
            contact
            for contact in contacts
            if contact.id == person_id
        ]

    if len(contacts) > limit_contacts:
        contacts = contacts[:limit_contacts]

    nodes: list[dict[str, str]] = []
    links: list[dict[str, str]] = []
    node_ids: set[str] = set()
    meeting_count = 0

    def add_node(payload: dict[str, str]) -> None:
        node_id = payload["id"]
        if node_id in node_ids:
            return
        nodes.append(payload)
        node_ids.add(node_id)

    for contact in contacts:
        contact_id = contact.id
        add_node({"id": f"contact_{contact_id}", "type": "person", "label": contact.name})

        if contact.company_id is not None:
            links.append(
                {
                    "source": f"contact_{contact_id}",
                    "target": f"company_{contact.company_id}",
                    "type": "works_at",
                }
            )

        for tag in contact.tags:
            if tech_filter and (not tag.name or tech_filter.lower() not in tag.name.lower()):
                continue
            links.append(
                {
                    "source": f"contact_{contact_id}",
                    "target": f"tag_{tag.id}",
                    "type": "uses",
                }
            )

        for meeting in contact.meetings:
            if meeting_count >= limit_meetings:
                break
            add_node(
                {
                    "id": f"meeting_{meeting.id}",
                    "type": "meeting",
                    "label": "Meeting",
                    "timestamp": meeting.timestamp.isoformat(),
                }
            )
            links.append(
                {
                    "source": f"contact_{contact_id}",
                    "target": f"meeting_{meeting.id}",
                    "type": "met_at",
                }
            )
            meeting_count += 1

        if contact.company:
            add_node(
                {
                    "id": f"company_{contact.company.id}",
                    "type": "company",
                    "label": contact.company.name,
                }
            )

        for tag in contact.tags:
            if tech_filter and (not tag.name or tech_filter.lower() not in tag.name.lower()):
                continue
            add_node(
                {
                    "id": f"tag_{tag.id}",
                    "type": "technology",
                    "label": tag.name,
                }
            )

    return {"nodes": nodes, "links": links}
