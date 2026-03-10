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
    link_keys: set[tuple[str, str, str]] = set()
    meeting_count = 0

    def add_node(payload: dict[str, str]) -> None:
        node_id = payload["id"]
        if node_id in node_ids:
            return
        nodes.append(payload)
        node_ids.add(node_id)

    def add_link(source: str, target: str, link_type: str) -> None:
        key = (source, target, link_type)
        if key in link_keys:
            return
        links.append({"source": source, "target": target, "type": link_type})
        link_keys.add(key)

    for contact in contacts:
        contact_id = contact.id
        add_node(
            {
                "id": f"contact_{contact_id}",
                "type": "person",
                "label": contact.name or "",
                "role": contact.role or "",
                "email": contact.email or "",
                "phone": contact.phone or "",
                "mobile": contact.mobile or "",
            }
        )

        if contact.company_id is not None:
            add_link(
                f"contact_{contact_id}",
                f"company_{contact.company_id}",
                "works_at",
            )

        for tag in contact.tags:
            if tech_filter and (not tag.name or tech_filter.lower() not in tag.name.lower()):
                continue
            add_link(
                f"contact_{contact_id}",
                f"tag_{tag.id}",
                "uses",
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
            add_link(
                f"contact_{contact_id}",
                f"meeting_{meeting.id}",
                "met_at",
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
            if contact.company:
                add_link(
                    f"company_{contact.company.id}",
                    f"tag_{tag.id}",
                    "company_uses",
                )

    return {"nodes": nodes, "links": links}
