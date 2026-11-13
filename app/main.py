from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from typing import Any
import json
import shutil
import threading

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import cv2

from app import analysis

from app.video_processor import process_video

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
STATIC_DIR = BASE_DIR / "static"
JOBS_FILE = OUTPUT_DIR / "jobs.json"
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

app = FastAPI(
    title="AI Football Performance Analyzer",
    description="Video upload, player detection, tracking, and a web dashboard.",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this before production deployment.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}
_lock = threading.Lock()


def _load_jobs() -> dict[str, dict[str, Any]]:
    """Load persisted jobs. Jobs interrupted by a restart are marked failed."""
    if not JOBS_FILE.exists():
        return {}
    try:
        jobs = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    for job in jobs.values():
        if job.get("status") in ("queued", "processing"):
            job["status"] = "failed"
            job["message"] = "Processing was interrupted by a server restart."
            job["error"] = "interrupted"
    return jobs


JOBS: dict[str, dict[str, Any]] = _load_jobs()


def _save_jobs() -> None:
    with _lock:
        tmp = JOBS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(JOBS, indent=2), encoding="utf-8")
        tmp.replace(JOBS_FILE)


@app.get("/api/health")
def health():
    return {"status": "ok", "project": "AI Football Performance Analyzer"}


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/app/")


@app.get("/matches")
def list_matches():
    jobs = sorted(JOBS.values(), key=lambda j: j.get("created_at", ""), reverse=True)
    return jobs


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
        "filename": video.filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "queued",
        "progress": 0,
        "message": "Video uploaded; waiting for processing.",
        "result": None,
        "error": None,
    }
    _save_jobs()

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
    _save_jobs()

    def on_progress(pct: int):
        JOBS[job_id]["progress"] = pct

    try:
        summary = process_video(input_path, output_video, output_json, on_progress)
        JOBS[job_id]["status"] = "completed"
        JOBS[job_id]["progress"] = 100
        JOBS[job_id]["message"] = "Processing completed."
        JOBS[job_id]["result"] = summary
    except Exception as exc:
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["message"] = "Video processing failed."
        JOBS[job_id]["error"] = str(exc)
    _save_jobs()


@app.get("/matches/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found.")
    return job


@app.delete("/matches/{job_id}")
def delete_match(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found.")
    if job["status"] in ("queued", "processing"):
        raise HTTPException(status_code=409, detail="Cannot delete a running job.")
    for p in list(UPLOAD_DIR.glob(f"{job_id}.*")) + list(OUTPUT_DIR.glob(f"{job_id}_*")):
        p.unlink(missing_ok=True)
    del JOBS[job_id]
    _save_jobs()
    return {"deleted": job_id}


def _require_completed(job_id: str) -> dict[str, Any]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Match job not found.")
    if job["status"] != "completed":
        raise HTTPException(status_code=409, detail=f"Job status: {job['status']}")
    return job


@app.get("/matches/{job_id}/result")
def get_result(job_id: str):
    _require_completed(job_id)
    path = OUTPUT_DIR / f"{job_id}_tracks.json"
    return FileResponse(path, media_type="application/json", filename="tracking_result.json")


@app.get("/matches/{job_id}/video")
def get_annotated_video(job_id: str):
    _require_completed(job_id)
    path = OUTPUT_DIR / f"{job_id}_tracked.mp4"
    return FileResponse(path, media_type="video/mp4", filename="tracked_match.mp4")


@app.get("/matches/{job_id}/players")
def get_players_summary(job_id: str):
    """Per-track summary: time on screen, average position, heatmap grid, path.

    Coordinates are NORMALIZED video-frame coordinates (0..1), not meters.
    Real distance/speed needs pitch calibration (roadmap phase 3).
    """
    _require_completed(job_id)
    cache = OUTPUT_DIR / f"{job_id}_players.json"
    if cache.exists():
        return FileResponse(cache, media_type="application/json")

    data = json.loads((OUTPUT_DIR / f"{job_id}_tracks.json").read_text(encoding="utf-8"))
    fps = data["fps"] or 25.0
    w, h = data["width"], data["height"]
    GX, GY = 32, 18

    tracks: dict[int, dict[str, Any]] = {}
    for fr in data["frames"]:
        for p in fr["players"]:
            tid = p["track_id"]
            if tid is None:
                continue
            x1, y1, x2, y2 = p["bbox_xyxy"]
            nx = min(max(((x1 + x2) / 2) / w, 0), 0.9999)
            ny = min(max(y2 / h, 0), 0.9999)  # foot point
            t = tracks.setdefault(tid, {
                "track_id": tid, "frames": 0, "first_frame": fr["frame"],
                "last_frame": fr["frame"], "sx": 0.0, "sy": 0.0,
                "conf": 0.0, "heat": [[0] * GX for _ in range(GY)], "path": [],
            })
            t["frames"] += 1
            t["last_frame"] = fr["frame"]
            t["sx"] += nx
            t["sy"] += ny
            t["conf"] += p["confidence"]
            t["heat"][int(ny * GY)][int(nx * GX)] += 1
            t["path"].append([fr["frame"], round(nx, 4), round(ny, 4)])

    players = []
    for t in tracks.values():
        n = t["frames"]
        step = max(1, n // 300)  # keep path small
        players.append({
            "track_id": t["track_id"],
            "frames": n,
            "seconds_visible": round(n / fps, 2),
            "first_seen_seconds": round(t["first_frame"] / fps, 2),
            "last_seen_seconds": round(t["last_frame"] / fps, 2),
            "avg_x": round(t["sx"] / n, 4),
            "avg_y": round(t["sy"] / n, 4),
            "avg_confidence": round(t["conf"] / n, 4),
            "heat": t["heat"],
            "path": t["path"][::step],
        })
    players.sort(key=lambda p: p["frames"], reverse=True)

    out = {
        "job_id": job_id,
        "fps": fps,
        "width": w,
        "height": h,
        "duration_seconds": round(data["processed_frames"] / fps, 2),
        "grid": [GX, GY],
        "coordinate_system": "normalized_frame",
        "players": players,
    }
    cache.write_text(json.dumps(out), encoding="utf-8")
    return out


# ---------------------------------------------------------------- analysis
def _tracks(job_id: str) -> dict:
    return json.loads((OUTPUT_DIR / f"{job_id}_tracks.json").read_text(encoding="utf-8"))


def _calib_path(job_id: str) -> Path:
    return OUTPUT_DIR / f"{job_id}_calibration.json"


def _analysis_path(job_id: str) -> Path:
    return OUTPUT_DIR / f"{job_id}_analysis.json"


@app.get("/matches/{job_id}/frame")
def get_frame(job_id: str):
    """First video frame (used for clicking the 4 pitch corners)."""
    _require_completed(job_id)
    path = OUTPUT_DIR / f"{job_id}_frame.jpg"
    if not path.exists():
        src = next(iter(UPLOAD_DIR.glob(f"{job_id}.*")), None)
        cap = cv2.VideoCapture(str(src)) if src else None
        ok, frame = cap.read() if cap is not None and cap.isOpened() else (False, None)
        if cap is not None:
            cap.release()
        if not ok:
            raise HTTPException(status_code=404, detail="Frame not available (original video missing).")
        cv2.imwrite(str(path), frame)
    return FileResponse(path, media_type="image/jpeg")


class Calibration(BaseModel):
    points: list[list[float]]  # 4 pitch corners in image pixels: far-left, far-right, near-right, near-left
    length: float              # meters, along the image's horizontal direction
    width: float


@app.get("/matches/{job_id}/calibration")
def get_calibration(job_id: str):
    _require_completed(job_id)
    path = _calib_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not calibrated.")
    return json.loads(path.read_text(encoding="utf-8"))


@app.put("/matches/{job_id}/calibration")
def put_calibration(job_id: str, cal: Calibration):
    _require_completed(job_id)
    data = cal.model_dump()
    try:
        analysis.validate_calibration(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _calib_path(job_id).write_text(json.dumps(data), encoding="utf-8")
    _analysis_path(job_id).unlink(missing_ok=True)  # invalidate cache
    return data


@app.delete("/matches/{job_id}/calibration")
def delete_calibration(job_id: str):
    _require_completed(job_id)
    _calib_path(job_id).unlink(missing_ok=True)
    _analysis_path(job_id).unlink(missing_ok=True)
    return {"deleted": True}


@app.get("/matches/{job_id}/analysis")
def get_analysis(job_id: str):
    """Teams (shirt colour), speed/distance (needs calibration), ball events."""
    _require_completed(job_id)
    cache = _analysis_path(job_id)
    if cache.exists():
        cached = json.loads(cache.read_text(encoding="utf-8"))
        if cached.get("version") == analysis.ANALYSIS_VERSION:
            return cached
    cal = None
    if _calib_path(job_id).exists():
        cal = json.loads(_calib_path(job_id).read_text(encoding="utf-8"))
    result = analysis.analyze(_tracks(job_id), cal)
    result["job_id"] = job_id
    cache.write_text(json.dumps(result), encoding="utf-8")
    return result


class FitRequest(BaseModel):
    team: int = 0
    attack: str = "right"      # direction the team attacks in the image: right | left
    min_seconds: float = 5.0
    slots: list[dict]          # [{x, y, role}] from the Tactical Builder (y=0 is the attacking end)


@app.post("/matches/{job_id}/fit")
def fit_to_formation(job_id: str, req: FitRequest):
    result = get_analysis(job_id)
    if not result.get("metrics") or not result.get("teams"):
        raise HTTPException(status_code=409, detail="Needs pitch calibration and team detection first.")
    labels = {int(k): v for k, v in result["teams"]["labels"].items()}
    metrics = {int(k): v for k, v in result["metrics"].items()}
    try:
        return analysis.fit_formation(
            metrics, labels, req.team, req.slots, req.attack,
            result["pitch"]["length"], result["pitch"]["width"], req.min_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/matches/{job_id}/jerseys")
def get_jerseys(job_id: str):
    _require_completed(job_id)
    path = OUTPUT_DIR / f"{job_id}_jerseys.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Jersey numbers not read yet.")
    return FileResponse(path, media_type="application/json")


@app.post("/matches/{job_id}/jerseys")
def run_jerseys(job_id: str):
    """Optional OCR (needs `pip install easyocr`). Can take a few minutes on CPU."""
    _require_completed(job_id)
    src = next(iter(UPLOAD_DIR.glob(f"{job_id}.*")), None)
    if not src:
        raise HTTPException(status_code=404, detail="Original video not found in uploads/.")
    from app import ocr
    try:
        res = ocr.read_jerseys(src, _tracks(job_id))
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc))
    (OUTPUT_DIR / f"{job_id}_jerseys.json").write_text(json.dumps(res), encoding="utf-8")
    return res


# The web dashboard (static files). Mounted last so API routes take priority.
app.mount("/app", StaticFiles(directory=STATIC_DIR, html=True), name="app")
