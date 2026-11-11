# Development roadmap

## Phase 1 — Video MVP
- [x] Upload a match video
- [x] Detect people using pretrained YOLO
- [x] Track people using ByteTrack
- [x] Export annotated video and frame-by-frame JSON
- [ ] Add a browser upload/results interface
- [ ] Add robust progress reporting and persistent job storage

## Phase 2 — Player identity
- [ ] Team-color classification
- [ ] Jersey-number detection/OCR
- [ ] Coach roster mapping and manual correction
- [ ] Re-identification support for long occlusions

## Phase 3 — Pitch coordinates and movement
- [ ] Pitch-size presets: 5-a-side, 7-a-side, 11-a-side, custom
- [ ] Pitch keypoint detection and homography calibration
- [ ] Player coordinates in meters
- [ ] Distance, speed estimates, and heatmaps

## Phase 4 — Tactical analysis
- [ ] Formation builder
- [ ] Assign positions and player roles
- [ ] Coach-defined tactical instructions
- [ ] Phase-aware tactical compliance metrics
- [ ] Separate tactical compliance from player-role suitability

## Phase 5 — Match events and product
- [ ] Ball detection and tracking
- [ ] Passes, shots, possession, and defensive events
- [ ] Player/team dashboards
- [ ] PDF reports
- [ ] Mobile app
