from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

# Tag schemas
class TagBase(BaseModel):
    name: str

class TagCreate(TagBase):
    pass

class TagRead(TagBase):
    id: int

    class Config:
        from_attributes = True

class TechExtractRequest(BaseModel):
    text: str

class TechExtractResponse(BaseModel):
    tags: List[str]

# Company schemas
class CompanyBase(BaseModel):
    name: str

class CompanyCreate(CompanyBase):
    pass

class CompanyRead(CompanyBase):
    id: int

    class Config:
        from_attributes = True

# BusinessCard schemas
class BusinessCardBase(BaseModel):
    filename: str
    ocr_text: Optional[str] = None
    contact_id: Optional[int] = None

class BusinessCardCreate(BusinessCardBase):
    pass

class BusinessCardRead(BusinessCardBase):
    id: int

    class Config:
        from_attributes = True

# Meeting schemas
class MeetingBase(BaseModel):
    contact_id: int
    timestamp: datetime
    notes: Optional[str] = None

class MeetingCreate(MeetingBase):
    pass

class MeetingRead(MeetingBase):
    id: int

    class Config:
        from_attributes = True

# Contact schemas
class ContactBase(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    mobile: Optional[str] = None
    postal_code: Optional[str] = None
    address: Optional[str] = None
    branch: Optional[str] = None
    company_id: Optional[int] = None
    notes: Optional[str] = None

class ContactCreate(ContactBase):
    pass

class ContactRead(ContactBase):
    id: int
    tags: List[TagRead] = []
    company: Optional[CompanyRead] = None
    meetings: List[MeetingRead] = []
    business_cards: List[BusinessCardRead] = []

    class Config:
        from_attributes = True

class ContactRegisterRequest(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    mobile: Optional[str] = None
    postal_code: Optional[str] = None
    address: Optional[str] = None
    branch: Optional[str] = None
    company_name: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    card_filename: Optional[str] = None
    ocr_text: Optional[str] = None
