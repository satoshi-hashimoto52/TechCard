from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import datetime
import json
import re
import time
import urllib.parse
import urllib.request
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
    self_contact = (
        db.query(models.Contact)
        .options(joinedload(models.Contact.tags))
        .filter(models.Contact.is_self.is_(True))
        .first()
    )
    self_tag_ids = {tag.id for tag in (self_contact.tags if self_contact else [])}

    connection_contacts = (
        db.query(models.Contact)
        .options(
            joinedload(models.Contact.tags),
            joinedload(models.Contact.company),
        )
        .all()
    )

    connection_items = []
    for contact in connection_contacts:
        if contact.is_self:
            continue
        overlap = 0
        if contact.tags and self_tag_ids:
            overlap = sum(1 for tag in contact.tags if tag.id in self_tag_ids)
        if overlap <= 0:
            continue
        connection_items.append(
            {
                "id": contact.id,
                "contact_name": contact.name,
                "company_name": contact.company.name if contact.company else None,
                "overlap": overlap,
            }
        )

    connection_items.sort(
        key=lambda item: (item["overlap"], item["contact_name"] or "", item["id"]),
        reverse=True,
    )

    contact_payload = [{"id": contact.id, "name": contact.name} for contact in contacts]
    company_payload = [{"name": row.name, "count": row.contact_count} for row in companies]
    tag_payload = [{"name": row.name, "count": row.contact_count} for row in tags]
    meeting_payload = connection_items

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


PREFECTURES = [
    "北海道",
    "青森県",
    "岩手県",
    "宮城県",
    "秋田県",
    "山形県",
    "福島県",
    "茨城県",
    "栃木県",
    "群馬県",
    "埼玉県",
    "千葉県",
    "東京都",
    "神奈川県",
    "新潟県",
    "富山県",
    "石川県",
    "福井県",
    "山梨県",
    "長野県",
    "岐阜県",
    "静岡県",
    "愛知県",
    "三重県",
    "滋賀県",
    "京都府",
    "大阪府",
    "兵庫県",
    "奈良県",
    "和歌山県",
    "鳥取県",
    "島根県",
    "岡山県",
    "広島県",
    "山口県",
    "徳島県",
    "香川県",
    "愛媛県",
    "高知県",
    "福岡県",
    "佐賀県",
    "長崎県",
    "熊本県",
    "大分県",
    "宮崎県",
    "鹿児島県",
    "沖縄県",
]


def _detect_prefecture(address: str):
    if not address:
        return None
    for pref in PREFECTURES:
        if pref in address:
            return pref
    return None


def _geocode_japan(query: str, expected_prefecture: str | None = None):
    if not query:
        return None
    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": 1,
            "countrycodes": "jp",
            "addressdetails": 1,
            "accept-language": "ja",
        }
    )
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "TechCard/1.0 (local)"},
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data:
        return None
    top = data[0]
    address = top.get("address") or {}
    if address.get("country_code") not in (None, "jp"):
        return None
    if expected_prefecture:
        address_blob = " ".join(str(value) for value in address.values())
        display_name = top.get("display_name") or ""
        if expected_prefecture not in address_blob and expected_prefecture not in display_name:
            return None
    return float(top["lat"]), float(top["lon"])


def _geocode_postal_code(postal_code: str, expected_prefecture: str | None = None):
    cleaned = re.sub(r"[^0-9]", "", postal_code or "")
    if len(cleaned) != 7:
        return None
    url = f"https://geoapi.heartrails.com/api/json?method=searchByPostal&postal={cleaned}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "TechCard/1.0 (local)"},
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    locations = data.get("response", {}).get("location", [])
    if not locations:
        return None
    loc = locations[0]
    if expected_prefecture:
        pref = loc.get("prefecture") or ""
        if expected_prefecture not in pref:
            return None
    return float(loc["y"]), float(loc["x"])


@router.get("/company-map")
def get_company_map(refresh: bool = Query(False), db: Session = Depends(get_db)):
    contacts = (
        db.query(models.Contact)
        .options(joinedload(models.Contact.company))
        .all()
    )
    self_contact = next((c for c in contacts if c.is_self and c.company_id), None)
    self_company_id = self_contact.company_id if self_contact else None

    company_entries = {}
    for contact in contacts:
        if not contact.company:
            continue
        entry = company_entries.setdefault(
            contact.company.id,
            {
                "company": contact.company,
                "count": 0,
                "addresses": {},
            },
        )
        entry["count"] += 1
        address_key = (
            (contact.postal_code or "").strip(),
            (contact.address or "").strip(),
        )
        if address_key != ("", ""):
            entry["addresses"][address_key] = entry["addresses"].get(address_key, 0) + 1

    results = []
    for entry in company_entries.values():
        company = entry["company"]
        count = entry["count"]
        addresses = entry["addresses"]

        geocoded_at = company.geocoded_at
        if isinstance(geocoded_at, str):
            try:
                geocoded_at = datetime.fromisoformat(geocoded_at)
            except ValueError:
                geocoded_at = None
        should_retry = False
        if refresh:
            should_retry = True
        if company.latitude is None or company.longitude is None:
            if refresh:
                should_retry = True
            if company.id == self_company_id:
                should_retry = True
            elif geocoded_at is None:
                should_retry = True
            elif (datetime.utcnow() - geocoded_at).days >= 7:
                should_retry = True

        if should_retry:
            address_key = max(addresses.items(), key=lambda item: item[1])[0] if addresses else None
            if address_key:
                postal_code, address = address_key
                expected_prefecture = _detect_prefecture(address)
                candidates = []
                query_parts = []
                if address:
                    candidates.append(address)
                if postal_code:
                    query_parts.append(postal_code)
                if address:
                    query_parts.append(address)
                if query_parts:
                    combined = " ".join(query_parts)
                    if combined not in candidates:
                        candidates.append(combined)
                if postal_code and postal_code not in candidates:
                    candidates.append(postal_code)

                result = None
                if postal_code:
                    try:
                        result = _geocode_postal_code(postal_code, expected_prefecture)
                    except Exception:
                        result = None
                    time.sleep(0.6)
                for candidate in candidates:
                    if result:
                        break
                    try:
                        result = _geocode_japan(candidate, expected_prefecture)
                    except Exception:
                        result = None
                    time.sleep(1.1)
                if result:
                    lat, lon = result
                    company.latitude = lat
                    company.longitude = lon
                    company.geocoded_at = datetime.utcnow()
                else:
                    if refresh:
                        company.latitude = None
                        company.longitude = None
                        company.geocoded_at = datetime.utcnow()
                    elif company.id != self_company_id:
                        company.geocoded_at = datetime.utcnow()
                db.add(company)
                db.commit()

        results.append(
            {
                "name": company.name,
                "count": count,
                "lat": company.latitude,
                "lon": company.longitude,
                "is_self": company.id == self_company_id,
            }
        )

    return results
