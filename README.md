# AI Football Performance Analyzer — MVP v0.2

Upload a football video, detect players with YOLO, track them with ByteTrack, and explore results in a web dashboard.

## Requirements
- Python 3.10–3.12, 8 GB RAM minimum (NVIDIA GPU optional)

## Run (Windows)
1. Double-click `Setup_Football_Analyzer.bat` (once).
2. Double-click `Start_Football_Analyzer.bat` — the dashboard opens at http://127.0.0.1:8000/app/

Or manually in PowerShell:
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```
API docs: http://127.0.0.1:8000/docs

On first run Ultralytics downloads `yolo11n.pt` automatically.

## Dashboard pages
Home · Upload Match · Matches History · Players · Player Performance · Tactical Builder · Tactical Analysis · Reports · Team Management · Settings

Teams, players, formations and Track→player mappings are stored in the browser (localStorage); use Settings → Export for a backup. Matches/jobs are stored on the server in `outputs/jobs.json`.

## API
- `POST /matches/upload`, `GET /matches`, `GET /matches/{id}`, `DELETE /matches/{id}`
- `GET /matches/{id}/result` (tracking JSON), `/video` (annotated MP4), `/players` (per-track summary + heatmap)

## New in this version
- **Pitch calibration** (Performance or Tactical Analysis page): click the 4 pitch corners on the first frame -> player coordinates in meters, distance, speed, sprints, meter heatmaps.
- **Teams** split automatically by shirt colour; **ball** detection; **possession / passes / shots** (heuristics, experimental); **formation-fit** score against Tactical Builder formations.
- **Jersey OCR**: installed by `Setup_Football_Analyzer.bat`. If you set up before this version, double-click `Install_OCR.bat` once, then use Players -> "قراءة أرقام التيشيرتات".
- Videos processed with v0.1 have no colour/ball data: re-upload them to get teams and events.
- Better ball detection: change `MODEL_NAME` in `app/video_processor.py` to `yolo11m.pt` (slower, more accurate).

## Limitations
- Fixed, elevated camera recommended. Out-of-frame players cannot be measured.
- Coordinates are video-frame based; meters/speed need pitch calibration (Phase 3).
- Track IDs are temporary; names/jersey numbers are mapped manually for now.
- Development starter, not production-ready (CORS is open, no auth).
