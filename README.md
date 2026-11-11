# AI Football Performance Analyzer — MVP

First milestone: upload a football video, detect players with YOLO, track them with ByteTrack, and export an annotated video + tracking JSON.

## Requirements
- Python 3.10–3.12 recommended
- 8 GB RAM minimum; NVIDIA GPU is optional
- VS Code

## Setup (Windows PowerShell)

```powershell
cd football_analyzer_mvp
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000/docs

On the first run, Ultralytics downloads the pretrained `yolo11n.pt` model automatically.
The initial MVP detects people (players/referees may both be detected) and tracks them.
It does not yet identify real names, jersey numbers, the ball, or tactical roles.

## API
- `POST /matches/upload` — upload an MP4/AVI/MOV video
- `GET /matches/{job_id}` — processing status
- `GET /matches/{job_id}/result` — tracking JSON after completion
- `GET /matches/{job_id}/video` — annotated MP4 after completion

## Important limitations
- Use a fixed, elevated camera showing as much of the pitch as possible.
- A single camera cannot measure players that are out of frame.
- Accurate distance/speed requires pitch calibration and known pitch dimensions; those are not implemented yet.
- This is a development starter, not a production deployment. Jobs are stored in memory and reset when the server restarts.
