import pillow_heif
from fastapi import FastAPI
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from .database import engine
from . import models
from .routers import contacts, companies, tags, meetings, cards, graph, roi, stats, mobile_upload, admin

pillow_heif.register_heif_opener()

# create all tables
models.Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    columns = connection.execute(text("PRAGMA table_info(contacts)")).fetchall()
    if columns and not any(column[1] == "postal_code" for column in columns):
        connection.execute(text("ALTER TABLE contacts ADD COLUMN postal_code TEXT"))
    indexes = connection.execute(text("PRAGMA index_list(contacts)")).fetchall()
    has_unique_contact_index = False
    for index in indexes:
        index_name = index[1]
        is_unique = index[2] == 1
        if not is_unique:
            continue
        index_columns = connection.execute(text(f"PRAGMA index_info({index_name})")).fetchall()
        column_names = [col[2] for col in index_columns]
        if "email" in column_names or "phone" in column_names:
            has_unique_contact_index = True
            break
    if has_unique_contact_index:
        connection.execute(text("PRAGMA foreign_keys=OFF"))
        connection.execute(text("DROP TABLE IF EXISTS contacts_new"))
        connection.execute(
            text(
                """
                CREATE TABLE contacts_new (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR,
                    email VARCHAR,
                    phone VARCHAR,
                    role VARCHAR,
                    mobile VARCHAR,
                    postal_code VARCHAR,
                    address TEXT,
                    branch VARCHAR,
                    company_id INTEGER,
                    notes TEXT,
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO contacts_new (id, name, email, phone, role, mobile, postal_code, address, branch, company_id, notes)
                SELECT id, name, email, phone, role, mobile, postal_code, address, branch, company_id, notes
                FROM contacts
                """
            )
        )
        connection.execute(text("DROP TABLE contacts"))
        connection.execute(text("ALTER TABLE contacts_new RENAME TO contacts"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_contacts_name ON contacts (name)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_contacts_email ON contacts (email)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_contacts_phone ON contacts (phone)"))
        connection.execute(text("PRAGMA foreign_keys=ON"))

app = FastAPI(title="TechCard Backend")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to TechCard API"}

# Include routers
app.include_router(contacts.router)
app.include_router(companies.router)
app.include_router(tags.router)
app.include_router(meetings.router)
app.include_router(cards.router)
app.include_router(graph.router)
app.include_router(roi.router)
app.include_router(stats.router)
app.include_router(mobile_upload.router)
app.include_router(admin.router)
