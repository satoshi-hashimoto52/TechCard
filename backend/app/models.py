from sqlalchemy import Column, Integer, String, ForeignKey, Table, DateTime, Text, Date
from sqlalchemy.orm import relationship
from .database import Base

contact_tags = Table(
    "contact_tags",
    Base.metadata,
    Column("contact_id", ForeignKey("contacts.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)

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

    company = relationship("Company", back_populates="contacts")
    tags = relationship("Tag", secondary=contact_tags, back_populates="contacts")
    meetings = relationship("Meeting", back_populates="contact")
    business_cards = relationship("BusinessCard", back_populates="contact")

class Company(Base):
    __tablename__ = "companies"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    contacts = relationship("Contact", back_populates="company")

class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    contacts = relationship("Contact", secondary=contact_tags, back_populates="tags")

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
