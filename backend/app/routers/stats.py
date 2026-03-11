from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import datetime
import asyncio
import json
import re
import socket
import time
import urllib.parse
import urllib.request
import logging
from ..database import SessionLocal
from .. import models

router = APIRouter(prefix="/stats", tags=["stats"])
logger = logging.getLogger("techcard.geocode")
_GEOCODE_SEMAPHORE = asyncio.Semaphore(1)


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


def _request_json(url: str, headers: dict[str, str], timeout: int = 10, retries: int = 3, label: str = ""):
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            reason = "timeout" if isinstance(exc, socket.timeout) or "timed out" in str(exc).lower() else "error"
            logger.warning("[geocode %s %s] %s", label or "request", reason, exc)
            if attempt >= retries:
                return None
            time.sleep(1.1)
    return None


def _zipcloud_lookup(postal_code: str):
    cleaned = re.sub(r"[^0-9]", "", postal_code or "")
    if len(cleaned) != 7:
        return None
    url = f"https://zipcloud.ibsnet.co.jp/api/search?zipcode={cleaned}"
    data = _request_json(
        url,
        headers={"User-Agent": "techcard-geocoder/1.0 (contact@techcard.local)"},
        timeout=10,
        retries=3,
        label="zipcloud",
    )
    if not data:
        return None
    if data.get("status") != 200:
        logger.warning("[geocode zipcloud error] %s", data.get("message") or "status not 200")
        return None
    results = data.get("results") or []
    if not results:
        return None
    top = results[0]
    logger.info(
        "[zipcloud result] %s %s%s%s",
        cleaned,
        top.get("address1", ""),
        top.get("address2", ""),
        top.get("address3", ""),
    )
    return top


def _build_address_from_zipcloud(result: dict) -> str:
    return f"{result.get('address1','')}{result.get('address2','')}{result.get('address3','')}".strip()


def _normalize_postal(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def _normalize_address(value: str) -> str:
    if not value:
        return ""
    cleaned = value.replace("　", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"\s*\d+\s*(F|Ｆ|階|フロア)\b.*$", "", cleaned)
    building_match = re.search(
        r"^(.*?)(\s*(ビル|タワー|別館|号館|本館|支店|営業所|工場|センター|研究所|プラザ|ビルディング|棟|館).*)$",
        cleaned,
    )
    if building_match:
        cleaned = building_match.group(1).strip()
    return cleaned


def _geocode_nominatim(query: str):
    if not query:
        return None
    logger.info("[nominatim query] %s", query)
    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": 1,
            "countrycodes": "jp",
            "accept-language": "ja",
            "addressdetails": 1,
        }
    )
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    data = _request_json(
        url,
        headers={"User-Agent": "techcard-geocoder/1.0 (contact@techcard.local)"},
        timeout=10,
        retries=3,
        label="nominatim",
    )
    if not data:
        return None
    top = data[0] if isinstance(data, list) and data else None
    if not top:
        return None
    try:
        lat = float(top.get("lat"))
        lon = float(top.get("lon"))
    except (TypeError, ValueError):
        return None
    if lat == 0 or lon == 0:
        return None
    logger.info("[nominatim success] %s lat=%s lon=%s", query, lat, lon)
    return lat, lon


def _extract_city(address: str) -> str:
    if not address:
        return ""
    match = re.search(r"(東京都|北海道|(?:京都|大阪)府|.{2}県)([^0-9\\s]{1,12}?(市|区|町|村))", address)
    if match:
        return match.group(2)
    return ""


def _geocode_gsi(address: str):
    if not address:
        return None
    logger.info("[gsi query] %s", address)
    url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(address)
    data = _request_json(
        url,
        headers={"User-Agent": "techcard-geocoder/1.0 (contact@techcard.local)"},
        timeout=10,
        retries=3,
        label="gsi",
    )
    if not data:
        return None
    try:
        lon, lat = data[0]["geometry"]["coordinates"]
        if lat == 0 or lon == 0:
            return None
        logger.info("[gsi success] %s lat=%s lon=%s", address, lat, lon)
        return lat, lon
    except Exception:
        return None


def _select_best_address(addresses: dict[tuple[str, str], int] | None):
    if not addresses:
        return "", ""
    scored = []
    for (postal_code, address), count in addresses.items():
        addr_text = (address or "").strip()
        postal_text = (postal_code or "").strip()
        length_score = len(addr_text.replace(" ", "").replace("　", ""))
        info_score = length_score + (100 if postal_text else 0)
        scored.append((info_score, count, length_score, postal_text, addr_text))
    scored.sort(reverse=True)
    _, _, _, postal, address = scored[0]
    return postal, address


def _geocode_company(address: str, postal_code: str):
    normalized_address = _normalize_address(address)
    zip_address = ""
    if postal_code:
        zip_result = _zipcloud_lookup(postal_code)
        if zip_result:
            zip_address = _build_address_from_zipcloud(zip_result)

    if zip_address:
        latlon = _geocode_gsi(zip_address)
        if latlon:
            return latlon, zip_address, zip_address
    if zip_address and address:
        combined = f"{zip_address} {address}"
        latlon = _geocode_gsi(combined)
        if latlon:
            return latlon, combined, zip_address
    if normalized_address:
        latlon = _geocode_gsi(normalized_address)
        if latlon:
            return latlon, normalized_address, zip_address
    if address:
        latlon = _geocode_nominatim(address)
        if latlon:
            return latlon, address, zip_address

    return None, "", zip_address


async def _async_geocode(address: str, postal_code: str):
    async with _GEOCODE_SEMAPHORE:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _geocode_company, address, postal_code)
        await asyncio.sleep(1.1)
        return result


@router.get("/company-map")
async def get_company_map(refresh: bool = Query(False), db: Session = Depends(get_db)):
    contacts = (
        db.query(models.Contact)
        .options(joinedload(models.Contact.company))
        .all()
    )
    self_contact = next((c for c in contacts if c.is_self and c.company_id), None)
    self_company_id = self_contact.company_id if self_contact else None

    company_entries = {}
    address_groups: dict[tuple[str, str], dict] = {}
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
        postal = (contact.postal_code or "").strip()
        address = (contact.address or "").strip()
        address_key = (postal, address)
        if address_key != ("", ""):
            entry["addresses"][address_key] = entry["addresses"].get(address_key, 0) + 1
            group = address_groups.setdefault(
                address_key,
                {"postal_code": postal, "address": address, "companies": set()},
            )
            group["companies"].add(contact.company.id)

    company_count = len(company_entries)
    geocode_success = 0
    geocode_fail = 0
    company_items = []

    for entry in company_entries.values():
        company = entry["company"]
        count = entry["count"]
        addresses = entry["addresses"]
        needs_commit = False

        selected_postal = (company.postal_code or "").strip()
        selected_address = (company.address or "").strip()
        if addresses:
            best_postal, best_address = _select_best_address(addresses)
            if best_postal or best_address:
                selected_postal = best_postal or selected_postal
                selected_address = best_address or selected_address
            if (
                (best_postal and best_postal != (company.postal_code or "").strip())
                or (best_address and best_address != (company.address or "").strip())
                or (refresh and (best_postal or best_address))
            ):
                if selected_postal:
                    company.postal_code = selected_postal
                if selected_address:
                    company.address = selected_address
                needs_commit = True

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

        company_items.append(
            {
                "company": company,
                "count": count,
                "selected_postal": selected_postal,
                "selected_address": selected_address,
                "needs_commit": needs_commit,
                "should_retry": should_retry,
                "task_index": None,
            }
        )

    tasks = []
    for item in company_items:
        if not item["should_retry"]:
            continue
        company = item["company"]
        if refresh:
            company.latitude = None
            company.longitude = None
        address = item["selected_address"]
        postal_code = item["selected_postal"]
        if not address and not postal_code:
            item["task_index"] = None
            continue
        tasks.append(_async_geocode(address, postal_code))
        item["task_index"] = len(tasks) - 1

    async_results = []
    if tasks:
        async_results = await asyncio.gather(*tasks)

    for item in company_items:
        company = item["company"]
        count = item["count"]
        selected_postal = item["selected_postal"]
        selected_address = item["selected_address"]
        needs_commit = item["needs_commit"]
        used_address = ""
        zip_address = ""
        result = None

        if item["should_retry"]:
            task_index = item["task_index"]
            if task_index is not None:
                result, used_address, zip_address = async_results[task_index]
            if result:
                lat, lon = result
                company.latitude = lat
                company.longitude = lon
                company.geocoded_at = datetime.utcnow()
                company.geocode_note = None
                needs_commit = True
                geocode_success += 1
                logger.info(
                    "[geocode success] %s lat=%s lon=%s query=%s",
                    company.name,
                    lat,
                    lon,
                    used_address or "",
                )
            else:
                if refresh or company.latitude is None or company.longitude is None:
                    company.latitude = None
                    company.longitude = None
                company.geocoded_at = datetime.utcnow()
                company.geocode_note = "geocode_failed"
                needs_commit = True
                geocode_fail += 1
                failed_address = used_address or selected_address or zip_address or ""
                logger.warning(
                    "[geocode failed] %s address=%s postal=%s",
                    company.name,
                    failed_address,
                    selected_postal,
                )

            if zip_address and not company.address:
                company.address = zip_address
                needs_commit = True
            if selected_postal and not company.postal_code:
                company.postal_code = selected_postal
                needs_commit = True

        if needs_commit:
            db.add(company)
            db.commit()

    address_results: dict[tuple[str, str], tuple[float, float]] = {}
    if not refresh:
        for item in company_items:
            company = item["company"]
            cached_postal = (company.postal_code or "").strip()
            cached_address = (company.address or "").strip()
            if cached_postal or cached_address:
                if company.latitude is not None and company.longitude is not None:
                    address_results[(cached_postal, cached_address)] = (company.latitude, company.longitude)

    address_tasks = []
    address_task_index: dict[tuple[str, str], int] = {}
    for address_key in address_groups.keys():
        postal, address = address_key
        if not postal and not address:
            continue
        if not refresh and address_key in address_results:
            continue
        address_tasks.append(_async_geocode(address, postal))
        address_task_index[address_key] = len(address_tasks) - 1

    if address_tasks:
        async_address_results = await asyncio.gather(*address_tasks)
        for address_key, task_index in address_task_index.items():
            result, used_address, zip_address = async_address_results[task_index]
            if result:
                lat, lon = result
                address_results[address_key] = (lat, lon)
                geocode_success += 1
            else:
                geocode_fail += 1
                failed_address = used_address or address_key[1] or zip_address or ""
                logger.warning(
                    "[geocode failed] address=%s postal=%s",
                    failed_address,
                    address_key[0],
                )

    results = []
    locations_by_company: dict[int, list[dict]] = {}
    for entry in company_entries.values():
        company = entry["company"]
        for (postal, address), address_count in entry["addresses"].items():
            latlon = address_results.get((postal, address))
            if not latlon:
                continue
            lat, lon = latlon
            display_address = address or postal or ""
            city = _extract_city(display_address)
            locations_by_company.setdefault(company.id, []).append(
                {
                    "lat": lat,
                    "lon": lon,
                    "address": display_address,
                    "postal_code": postal,
                    "city": city,
                    "count": address_count,
                }
            )

    for item in company_items:
        company = item["company"]
        count = item["count"]
        selected_postal = item["selected_postal"]
        selected_address = item["selected_address"]
        display_address = (company.address or selected_address).strip()
        if not display_address and selected_postal:
            display_address = selected_postal
        city = _extract_city(display_address)
        if not city and selected_address:
            city = _extract_city(selected_address)
        payload = {
            "company_id": company.id,
            "company_name": company.name,
            "name": company.name,
            "count": count,
            "lat": company.latitude,
            "lon": company.longitude,
            "is_self": company.id == self_company_id,
            "postal_code": company.postal_code,
            "address": display_address,
            "city": city,
        }
        locations = locations_by_company.get(company.id) or []
        if locations:
            payload["locations"] = locations
        results.append(payload)

    progress_success = sum(
        1 for item in company_items if item["company"].latitude is not None and item["company"].longitude is not None
    )
    progress_total = company_count
    for item in results:
        item["geocode_progress"] = {"success": progress_success, "total": progress_total}

    logger.info(
        "[geocode summary] company=%s success=%s fail=%s",
        company_count,
        geocode_success,
        geocode_fail,
    )
    return results


@router.get("/company-map/diagnostics")
def get_company_map_diagnostics(db: Session = Depends(get_db)):
    contacts = (
        db.query(models.Contact)
        .options(joinedload(models.Contact.company))
        .all()
    )
    company_entries = {}
    for contact in contacts:
        if not contact.company:
            continue
        entry = company_entries.setdefault(
            contact.company.id,
            {
                "company": contact.company,
                "addresses": {},
            },
        )
        address_key = (
            (contact.postal_code or "").strip(),
            (contact.address or "").strip(),
        )
        if address_key != ("", ""):
            entry["addresses"][address_key] = entry["addresses"].get(address_key, 0) + 1

    missing = []
    invalidated = []
    short_address = []
    for entry in company_entries.values():
        company = entry["company"]
        best_postal, best_address = _select_best_address(entry["addresses"])
        postal = best_postal or (company.postal_code or "").strip()
        address = best_address or (company.address or "").strip()
        if not postal and not address:
            missing.append({"company_id": company.id, "name": company.name})
            continue
        if address and not _extract_city(address):
            short_address.append({"company_id": company.id, "name": company.name})
        if company.latitude is None and company.longitude is None and company.geocoded_at is not None:
            note = (company.geocode_note or "").strip()
            if note == "prefecture_mismatch":
                reason = "都道府県不一致"
            elif note == "postal_pref_mismatch":
                reason = "郵便番号と都道府県不一致"
            elif note == "geocode_failed":
                reason = "ジオコーディング失敗"
            else:
                reason = "不明"
            invalidated.append({"company_id": company.id, "name": company.name, "reason": reason})

    missing.sort(key=lambda item: item["name"])
    invalidated.sort(key=lambda item: item["name"])
    short_address.sort(key=lambda item: item["name"])
    return {
        "missing_addresses": missing,
        "invalidated_coords": invalidated,
        "short_addresses": short_address,
    }
