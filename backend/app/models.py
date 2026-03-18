from sqlalchemy import Column, Integer, String, ForeignKey, Table, DateTime, Text, Date, Boolean, Float, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

contact_tags = Table(
    "contact_tags",
    Base.metadata,
    Column("contact_id", ForeignKey("contacts.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

contact_tech_tags = Table(
    "contact_tech_tags",
    Base.metadata,
    Column("contact_id", ForeignKey("contacts.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

company_tech_tags = Table(
    "company_tech_tags",
    Base.metadata,
    Column("company_id", ForeignKey("companies.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

company_group_tags = Table(
    "company_group_tags",
    Base.metadata,
    Column("group_id", ForeignKey("company_groups.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

event_contacts = Table(
    "event_contacts",
    Base.metadata,
    Column("event_id", ForeignKey("events.id"), primary_key=True),
    Column("contact_id", ForeignKey("contacts.id"), primary_key=True),
)


class CompanyGroup(Base):
    __tablename__ = "company_groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(Text, nullable=True)

    companies = relationship("Company", back_populates="group")
    aliases = relationship("CompanyGroupAlias", back_populates="group", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary=company_group_tags, back_populates="groups")


class CompanyGroupAlias(Base):
    __tablename__ = "company_group_alias"
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("company_groups.id"))
    alias = Column(String, index=True)

    group = relationship("CompanyGroup", back_populates="aliases")


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    location = Column(String, nullable=True)
    year = Column(Integer, nullable=True)

    contacts = relationship("Contact", secondary=event_contacts, back_populates="events")

class Contact(Base):
    __tablename__ = "contacts"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, index=True, nullable=True)
    phone = Column(String, index=True, nullable=True)
    role = Column(String, nullable=True)
    mobile = Column(String, nullable=True)
    postal_code = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    branch = Column(String, nullable=True)
    first_met_at = Column(Date, nullable=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=True)
    notes = Column(Text, nullable=True)
    is_self = Column(Boolean, nullable=False, default=False)

    company = relationship("Company", back_populates="contacts")
    tags = relationship("Tag", secondary=contact_tags, back_populates="contacts")
    tech_tags = relationship("Tag", secondary=contact_tech_tags, back_populates="tech_contacts")
    events = relationship("Event", secondary=event_contacts, back_populates="contacts")
    meetings = relationship("Meeting", back_populates="contact")
    business_cards = relationship("BusinessCard", back_populates="contact")

class Company(Base):
    __tablename__ = "companies"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    group_id = Column(Integer, ForeignKey("company_groups.id"), nullable=True)
    postal_code = Column(String, nullable=True)
    address = Column(Text, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    geocoded_at = Column(DateTime, nullable=True)
    geocode_note = Column(Text, nullable=True)

    contacts = relationship("Contact", back_populates="company")
    group = relationship("CompanyGroup", back_populates="companies")
    tech_tags = relationship("Tag", secondary=company_tech_tags, back_populates="companies")

class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    type = Column(String, nullable=False, default="tech")

    contacts = relationship("Contact", secondary=contact_tags, back_populates="tags")
    tech_contacts = relationship("Contact", secondary=contact_tech_tags, back_populates="tech_tags")
    companies = relationship("Company", secondary=company_tech_tags, back_populates="tech_tags")
    groups = relationship("CompanyGroup", secondary=company_group_tags, back_populates="tags")

class Meeting(Base):
    __tablename__ = "meetings"
    id = Column(Integer, primary_key=True, index=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"))
    timestamp = Column(DateTime)
    notes = Column(Text, nullable=True)

    contact = relationship("Contact", back_populates="meetings")

class BusinessCard(Base):
    __tablename__ = "business_cards"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, unique=True)
    ocr_text = Column(Text, nullable=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=True)

    contact = relationship("Contact", back_populates="business_cards")


class CompanyRouteCache(Base):
    __tablename__ = "company_route_cache"
    __table_args__ = (
        UniqueConstraint("from_company_id", "to_company_id", "policy", name="uq_company_route_cache_pair_policy"),
    )

    id = Column(Integer, primary_key=True, index=True)
    from_company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    to_company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    policy = Column(String, nullable=False, index=True)
    effective_mode = Column(String, nullable=False, default="inter_pref_mixed")
    coord_key = Column(String, nullable=False)
    provider = Column(String, nullable=False, default="openrouteservice")
    distance_m = Column(Float, nullable=False)
    duration_s = Column(Float, nullable=True)
    geometry_json = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
