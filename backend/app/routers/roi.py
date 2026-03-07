import json
import os
from pathlib import Path
from typing import List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/roi", tags=["roi"])

TEMPLATE_DIR = Path("data/roi_templates")
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)


class RoiItem(BaseModel):
    field: str
    x: float
    y: float
    w: float
    h: float


class RoiTemplate(BaseModel):
    company_name: str
    template_name: str
    image_width: int
    image_height: int
    rois: List[RoiItem]


def _safe_filename(value: str) -> str:
    return "".join(ch for ch in value if ch.isalnum() or ch in ("-", "_")).strip("_")


@router.get("/templates")
def list_templates():
    templates = []
    for path in TEMPLATE_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            templates.append(
                {
                    "company_name": data.get("company_name", ""),
                    "template_name": data.get("template_name", ""),
                }
            )
        except json.JSONDecodeError:
            continue
    return templates


@router.post("/templates")
def save_template(payload: RoiTemplate):
    company = _safe_filename(payload.company_name) or "unknown"
    name = _safe_filename(payload.template_name) or "default"
    filename = f"{company}_{name}.json"
    path = TEMPLATE_DIR / filename
    path.write_text(payload.model_dump_json(indent=2), encoding="utf-8")
    return {"message": "Template saved", "filename": filename}


@router.get("/templates/{key}")
def get_templates_by_key(key: str):
    company_key = _safe_filename(key)
    matches = []
    for path in TEMPLATE_DIR.glob(f"{company_key}_*.json"):
        try:
            matches.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    if not matches:
        for path in TEMPLATE_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if data.get("template_name") == key:
                matches.append(data)
        if not matches:
            raise HTTPException(status_code=404, detail="Template not found")
    return matches


@router.delete("/templates/{key}")
def delete_template(key: str, company_name: str | None = Query(default=None)):
    matched_paths = []
    for path in TEMPLATE_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if data.get("template_name") != key:
            continue
        if company_name and data.get("company_name") != company_name:
            continue
        matched_paths.append(path)

    if not matched_paths:
        raise HTTPException(status_code=404, detail="Template not found")

    deleted = 0
    for path in matched_paths:
        try:
            path.unlink()
            deleted += 1
        except OSError:
            continue
    if deleted == 0:
        raise HTTPException(status_code=500, detail="Failed to delete template")
    return {"deleted": deleted}
