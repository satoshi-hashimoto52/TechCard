from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from .. import crud, models, schemas
from ..database import SessionLocal

router = APIRouter(prefix="/companies", tags=["companies"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/", response_model=schemas.CompanyRead)
def create_company(company: schemas.CompanyCreate, db: Session = Depends(get_db)):
    return crud.create_company(db=db, company=company)

@router.get("/", response_model=list[schemas.CompanyRead])
def read_companies(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    companies = crud.get_companies(db, skip=skip, limit=limit)
    return companies

@router.get("/{company_id}", response_model=schemas.CompanyRead)
def read_company(company_id: int, db: Session = Depends(get_db)):
    db_company = crud.get_company(db, company_id=company_id)
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return db_company


@router.get("/{company_id}/detail", response_model=schemas.CompanyDetail)
def read_company_detail(company_id: int, db: Session = Depends(get_db)):
    company = (
        db.query(models.Company)
        .options(
            joinedload(models.Company.group),
            joinedload(models.Company.tech_tags),
            joinedload(models.Company.contacts),
        )
        .filter(models.Company.id == company_id)
        .first()
    )
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    contacts = [
        {"id": contact.id, "name": contact.name}
        for contact in (company.contacts or [])
    ]
    return schemas.CompanyDetail(
        id=company.id,
        name=company.name,
        group_id=company.group_id,
        group_name=company.group.name if company.group else None,
        tech_tags=[tag.name for tag in (company.tech_tags or []) if tag.name],
        contacts=contacts,
    )

@router.put("/{company_id}", response_model=schemas.CompanyRead)
def update_company(company_id: int, company: schemas.CompanyBase, db: Session = Depends(get_db)):
    db_company = crud.update_company(db, company_id=company_id, company=company)
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return db_company


@router.put("/{company_id}/group", response_model=schemas.CompanyRead)
def update_company_group(company_id: int, payload: schemas.CompanyGroupUpdate, db: Session = Depends(get_db)):
    db_company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if db_company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    db_company.group_id = payload.group_id
    db.commit()
    db.refresh(db_company)
    return db_company

@router.delete("/{company_id}")
def delete_company(company_id: int, db: Session = Depends(get_db)):
    success = crud.delete_company(db, company_id=company_id)
    if not success:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"message": "Company deleted"}
