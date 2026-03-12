from datetime import datetime, date
from typing import List, Optional
from pydantic import BaseModel, Field

# Tag schemas
class TagBase(BaseModel):
    name: str
    type: Optional[str] = None

class TagCreate(TagBase):
    type: str = "tech"

class ContactTagItem(BaseModel):
    name: str
    type: Optional[str] = None

class TagRead(TagBase):
    id: int

    class Config:
        from_attributes = True

class TechExtractRequest(BaseModel):
    text: str

class TechExtractResponse(BaseModel):
    tags: List[str]

# Event schemas
class EventBase(BaseModel):
    name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    location: Optional[str] = None
    year: Optional[int] = None

class EventCreate(EventBase):
    contact_ids: List[int] = Field(default_factory=list)

class EventRead(EventBase):
    id: int
    contact_ids: List[int] = Field(default_factory=list)

    class Config:
        from_attributes = True

class EventDetail(BaseModel):
    id: int
    name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    location: Optional[str] = None
    year: Optional[int] = None
    participants: List[dict] = []
    companies: List[dict] = []

    class Config:
        from_attributes = True

# Company schemas
class CompanyBase(BaseModel):
    name: str
    group_id: Optional[int] = None
    postal_code: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class CompanyCreate(CompanyBase):
    pass

class CompanyRead(CompanyBase):
    id: int

    class Config:
        from_attributes = True

class CompanyGroupBase(BaseModel):
    name: str
    description: Optional[str] = None

class CompanyGroupCreate(CompanyGroupBase):
    pass

class CompanyGroupRead(CompanyGroupBase):
    id: int
    company_ids: List[int] = []
    aliases: List[str] = []

    class Config:
        from_attributes = True

class CompanyDetail(BaseModel):
    id: int
    name: str
    group_id: Optional[int] = None
    group_name: Optional[str] = None
    tech_tags: List[str] = []
    contacts: List[dict] = []

    class Config:
        from_attributes = True

class CompanyGroupUpdate(BaseModel):
    group_id: Optional[int] = None

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
    first_met_at: Optional[date] = None
    company_id: Optional[int] = None
    notes: Optional[str] = None
    is_self: Optional[bool] = None

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
    first_met_at: Optional[date] = None
    company_name: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    tag_items: List[ContactTagItem] = Field(default_factory=list)
    notes: Optional[str] = None
    card_filename: Optional[str] = None
    ocr_text: Optional[str] = None

class ContactSelfRequest(BaseModel):
    is_self: bool
