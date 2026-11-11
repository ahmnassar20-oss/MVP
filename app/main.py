from pathlib import Path
from uuid import uuid4
from typing import Any
import shutil
import threading

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.video_processor import process_video

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(
    title="AI Football Performance Analyzer",
    description="MVP: video upload, player detection, and player tracking.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this before production deployment.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Development-only in-memory job store. Replace with PostgreSQL/Redis later.
JOBS: dict[str, dict[str, Any]] = {}
ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}


@app.get("/")
def health():
    return {"status": "ok", "project": "AI Football Performance Analyzer"}


@app.post("/matches/upload", status_code=202)
async def upload_match(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
):
    suffix = Path(video.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Use: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    job_id = str(uuid4())
    input_path = UPLOAD_DIR / f"{job_id}{suffix}"
    output_video = OUTPUT_DIR / f"{job_id}_tracked.mp4"
    output_json = OUTPUT_DIR / f"{job_id}_tracks.json"

    try:
        with input_path.open("wb") as buffer:
            shutil.copyfileobj(video.file, buffer)
    finally:
        await video.close()

    JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Video uploaded; waiting for processing.",
        "result": None,
        "error": None,
    }

    background_tasks.add_task(
        run_processing, job_id, input_path, output_video, output_json
    )
    return {
        "job_id": job_id,
        "status": "queued",
        "status_url": f"/matches/{job_id}",
    }


def run_processing(job_id: str, input_path: Path, output_video: Path, output_json: Path):
    JOBS[job_id]["status"] = "processing"
    JOBS[job_id]["message"] = "Detecting and tracking players..."
    try:
        summary = process_video(input_path, output_video, output_json)
        JOBS[job_id]["status"] = "completed"
        JOBS[job_id]["progress"] = 100
        JOBS[job_id]["message"] = "Processing completed."
        JOBS[job_id]["result"] = summary
    except Exception as exc:
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["message"] = "Video processing failed."
        JOBS[job_id]["error"] = str(exc)


@app.get("/matches/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found.")
    return job


@app.get("/matches/{job_id}/result")
def get_result(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found.")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail=f"Job status: {job['status']}")
    path = OUTPUT_DIR / f"{job_id}_tracks.json"
    return FileResponse(path, media_type="application/json", filename="tracking_result.json")


@app.get("/matches/{job_id}/video")
def get_annotated_video(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found.")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail=f"Job status: {job['status']}")
    path = OUTPUT_DIR / f"{job_id}_tracked.mp4"
    return FileResponse(path, media_type="video/mp4", filename="tracked_match.mp4")
