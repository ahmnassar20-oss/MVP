# Development roadmap

## Phase 1 — Video MVP
- [x] Upload a match video
- [x] Detect people using pretrained YOLO
- [x] Track people using ByteTrack
- [x] Export annotated video and frame-by-frame JSON
- [x] Add a browser upload/results interface (static/ dashboard, 10 pages)
- [x] Add robust progress reporting and persistent job storage (outputs/jobs.json)

## Phase 2 — Player identity
- [x] Team-color classification (k-means on shirt colour)
- [~] Jersey-number detection/OCR (optional EasyOCR, experimental)
- [x] Coach roster mapping and manual correction (manual Track -> player mapping in UI)
- [ ] Re-identification support for long occlusions

## Phase 3 — Pitch coordinates and movement
- [x] Pitch-size presets: 5-a-side, 7-a-side, 11-a-side, custom
- [~] Homography calibration (manual 4-corner click; automatic keypoint detection still TODO)
- [x] Player coordinates in meters
- [x] Distance, speed estimates, and heatmaps

## Phase 4 — Tactical analysis
- [x] Formation builder (UI, saved in browser)
- [ ] Assign positions and player roles
- [ ] Coach-defined tactical instructions
- [~] Tactical compliance metrics (formation-shape fit, match-average only; not phase-aware yet)
- [ ] Separate tactical compliance from player-role suitability

## Phase 5 — Match events and product
- [~] Ball detection (YOLO class 'sports ball'; weak with yolo11n)
- [~] Passes, shots, possession (heuristic, experimental)
- [ ] Player/team dashboards
- [ ] PDF reports (print-to-PDF + CSV exist)
- [ ] Mobile app
