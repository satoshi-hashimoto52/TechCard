import pillow_heif
from fastapi import FastAPI
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from .database import engine
from . import models
from .routers import contacts, companies, tags, meetings, cards, graph, stats, mobile_upload, admin, card_crop, events, company_groups

pillow_heif.register_heif_opener()

# create all tables
models.Base.metadata.create_all(bind=engine)

with engine.begin() as connection:
    columns = connection.execute(text("PRAGMA table_info(contacts)")).fetchall()
    if columns and not any(column[1] == "postal_code" for column in columns):
        connection.execute(text("ALTER TABLE contacts ADD COLUMN postal_code TEXT"))
    if columns and not any(column[1] == "first_met_at" for column in columns):
        connection.execute(text("ALTER TABLE contacts ADD COLUMN first_met_at DATE"))
    if columns and not any(column[1] == "is_self" for column in columns):
        connection.execute(text("ALTER TABLE contacts ADD COLUMN is_self INTEGER DEFAULT 0"))
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
                    first_met_at DATE,
                    company_id INTEGER,
                    notes TEXT,
                    is_self INTEGER DEFAULT 0,
                    FOREIGN KEY(company_id) REFERENCES companies(id)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO contacts_new (id, name, email, phone, role, mobile, postal_code, address, branch, first_met_at, company_id, notes, is_self)
                SELECT id, name, email, phone, role, mobile, postal_code, address, branch, first_met_at, company_id, notes, 0
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

    company_columns = connection.execute(text("PRAGMA table_info(companies)")).fetchall()
    if company_columns and not any(column[1] == "postal_code" for column in company_columns):
        connection.execute(text("ALTER TABLE companies ADD COLUMN postal_code TEXT"))
    if company_columns and not any(column[1] == "address" for column in company_columns):
        connection.execute(text("ALTER TABLE companies ADD COLUMN address TEXT"))
    if company_columns and not any(column[1] == "group_id" for column in company_columns):
        connection.execute(text("ALTER TABLE companies ADD COLUMN group_id INTEGER"))
    if company_columns and not any(column[1] == "latitude" for column in company_columns):
        connection.execute(text("ALTER TABLE companies ADD COLUMN latitude REAL"))
    if company_columns and not any(column[1] == "longitude" for column in company_columns):
        connection.execute(text("ALTER TABLE companies ADD COLUMN longitude REAL"))
    if company_columns and not any(column[1] == "geocoded_at" for column in company_columns):
        connection.execute(text("ALTER TABLE companies ADD COLUMN geocoded_at DATETIME"))
    if company_columns and not any(column[1] == "geocode_note" for column in company_columns):
        connection.execute(text("ALTER TABLE companies ADD COLUMN geocode_note TEXT"))

    tag_columns = connection.execute(text("PRAGMA table_info(tags)")).fetchall()
    if tag_columns and not any(column[1] == "type" for column in tag_columns):
        connection.execute(text("ALTER TABLE tags ADD COLUMN type TEXT DEFAULT 'tech'"))
    if tag_columns:
        connection.execute(text("UPDATE tags SET type='tech' WHERE type IS NULL"))
        connection.execute(text("UPDATE tags SET type='tech' WHERE type='technology'"))
        connection.execute(
            text(
                """
                UPDATE tags
                SET type='event'
                WHERE name IN (
                    'IIFES 2024',
                    '国際画像機器展 2025',
                    'MEX金沢',
                    '製造DX応援フェア'
                )
                """
            )
        )
        connection.execute(
            text(
                """
                UPDATE tags
                SET type='relation'
                WHERE name IN (
                    '交流 ホクショー',
                    '家族',
                    '師弟',
                    '旅行(会社)',
                    'フリーアドレス',
                    '別川未来塾X月星道場',
                    'JXI'
                )
                """
            )
        )

    route_cache_columns = connection.execute(text("PRAGMA table_info(company_route_cache)")).fetchall()
    if route_cache_columns and not any(column[1] == "effective_mode" for column in route_cache_columns):
        connection.execute(
            text("ALTER TABLE company_route_cache ADD COLUMN effective_mode TEXT DEFAULT 'inter_pref_mixed'")
        )
    if route_cache_columns and not any(column[1] == "steps_json" for column in route_cache_columns):
        connection.execute(
            text("ALTER TABLE company_route_cache ADD COLUMN steps_json TEXT")
        )

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
app.include_router(card_crop.router)
app.include_router(stats.router)
app.include_router(events.router)
app.include_router(company_groups.router)
app.include_router(mobile_upload.router)
app.include_router(mobile_upload.api_router)
app.include_router(admin.router)
