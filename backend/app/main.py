from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.projects import router as projects_router
from app.api.llm import router as llm_router
from app.database import create_tables
from app.config import settings


app = FastAPI(
    title=settings.app_name,
    description=(
        "ProofLine turns GitHub activity "
        "into transparent contribution evidence."
    ),
    version="0.1.0",
)

# CORS MIDDLEWARE - REQUIRED FOR FRONTEND CONNECTION
origins = [
    "http://localhost:5173",  # Vite default dev server
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],      # Allow GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],      # Allow Content-Type, Authorization, etc.
)
create_tables()

app.include_router(projects_router)
app.include_router(llm_router)


@app.get("/")
def root():
    return {
        "name": "ProofLine",
        "message": (
            "Turn project activity "
            "into transparent contribution evidence."
        ),
        "version": "0.1.0",
    }



@app.get("/database-status")
def database_status():
    return {
        "database_url": settings.database_url
    }