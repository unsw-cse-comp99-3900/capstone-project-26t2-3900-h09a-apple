import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session as DBSession

from app.database import get_db
from app.ingestion import ingest_session
from app.session_schema import SessionPayload
from app.storage import ObjectStorage, get_storage

load_dotenv()

app = FastAPI(title="H09A Apple API")

cors_origins = [o.strip() for o in os.getenv("API_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_DEPENDENCY = Depends(get_db)
STORAGE_DEPENDENCY = Depends(get_storage)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/sessions", status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionPayload,
    db: DBSession = DB_DEPENDENCY,
    storage: ObjectStorage = STORAGE_DEPENDENCY,
) -> dict[str, str]:
    try:
        ingested_session = ingest_session(payload, db, storage)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "session_id": ingested_session.session_id,
        "job_id": ingested_session.job_id,
    }
