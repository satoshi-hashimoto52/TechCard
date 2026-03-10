from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, BackgroundTasks, Form
from sqlalchemy.orm import Session
import shutil
import os
import uuid
from typing import Dict, Any
import cv2
import numpy as np
from .. import crud, models, schemas
from ..database import SessionLocal
from ..ocr import run_ocr, extract_fields, ocr_image_array

router = APIRouter(prefix="/cards", tags=["cards"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

OCR_JOBS: Dict[str, Dict[str, Any]] = {}


def _update_job(job_id: str, **kwargs: Any) -> None:
    job = OCR_JOBS.get(job_id)
    if not job:
        return
    job.update(kwargs)


def _run_ocr_job(job_id: str, file_path: str) -> None:
    processed_path = None
    try:
        _update_job(job_id, status="processing", progress=30)
        _update_job(job_id, status="processing", progress=60)
        lines, raw_text = run_ocr(file_path)

        _update_job(job_id, status="processing", progress=90)
        result = extract_fields(lines, raw_text)

        _update_job(
            job_id,
            status="done",
            progress=100,
            result={
                "name": result.get("name") or None,
                "company": result.get("company") or None,
                "branch": result.get("branch") or None,
                "role": result.get("role") or None,
                "email": result.get("email") or None,
                "phone": result.get("phone") or None,
                "mobile": result.get("mobile") or None,
                "address": result.get("address") or None,
                "raw_text": result.get("raw_text") or "",
                "filename": OCR_JOBS[job_id]["filename"],
            },
        )
    except Exception as exc:
        _update_job(job_id, status="error", progress=100, error=str(exc))
    finally:
        pass

@router.post("/upload")
async def upload_business_card(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    # Save uploaded image
    upload_dir = os.path.join("data", "cards")
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    job_id = str(uuid.uuid4())
    OCR_JOBS[job_id] = {
        "status": "processing",
        "progress": 10,
        "result": None,
        "error": None,
        "filename": file.filename,
    }

    background_tasks.add_task(_run_ocr_job, job_id, file_path)
    return {"job_id": job_id}


@router.get("/upload/status/{job_id}")
def get_upload_status(job_id: str):
    job = OCR_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "status": job["status"],
        "progress": job["progress"],
        "result": job.get("result"),
        "error": job.get("error"),
    }


@router.post("/ocr-region")
async def ocr_region(field: str = Form(...), image: UploadFile = File(...)):
    content = await image.read()
    array = np.frombuffer(content, dtype=np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image")
    text = ocr_image_array(img)
    return {"field": field, "text": text}

@router.post("/", response_model=schemas.BusinessCardRead)
def create_business_card(business_card: schemas.BusinessCardCreate, db: Session = Depends(get_db)):
    return crud.create_business_card(db=db, business_card=business_card)

@router.get("/", response_model=list[schemas.BusinessCardRead])
def read_business_cards(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    business_cards = crud.get_business_cards(db, skip=skip, limit=limit)
    return business_cards

@router.get("/{business_card_id}", response_model=schemas.BusinessCardRead)
def read_business_card(business_card_id: int, db: Session = Depends(get_db)):
    db_business_card = crud.get_business_card(db, business_card_id=business_card_id)
    if db_business_card is None:
        raise HTTPException(status_code=404, detail="Business card not found")
    return db_business_card

@router.put("/{business_card_id}", response_model=schemas.BusinessCardRead)
def update_business_card(business_card_id: int, business_card: schemas.BusinessCardBase, db: Session = Depends(get_db)):
    db_business_card = crud.update_business_card(db, business_card_id=business_card_id, business_card=business_card)
    if db_business_card is None:
        raise HTTPException(status_code=404, detail="Business card not found")
    return db_business_card

@router.delete("/{business_card_id}")
def delete_business_card(business_card_id: int, db: Session = Depends(get_db)):
    success = crud.delete_business_card(db, business_card_id=business_card_id)
    if not success:
        raise HTTPException(status_code=404, detail="Business card not found")
    return {"message": "Business card deleted"}
