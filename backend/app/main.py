from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine
from . import models
from .routers import contacts, companies, tags, meetings, cards, graph, roi, stats

# create all tables
models.Base.metadata.create_all(bind=engine)

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
