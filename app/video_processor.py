from pathlib import Path
from typing import Callable, Optional
import json
import cv2
import numpy as np
from ultralytics import YOLO

MODEL_NAME = "yolo11n.pt"
PERSON_CONF = 0.25
BALL_CONF = 0.12  # the ball is small, so it needs a lower threshold


def torso_color(frame, box):
    """Median RGB of the upper-body area of a person box (used for team clustering)."""
    x1, y1, x2, y2 = [int(v) for v in box]
    h, w = y2 - y1, x2 - x1
    if h < 20 or w < 8:
        return None
    crop = frame[max(y1 + int(h * 0.2), 0): y1 + int(h * 0.55), max(x1 + int(w * 0.25), 0): x2 - int(w * 0.25)]
    if crop.size == 0:
        return None
    b, g, r = np.median(crop.reshape(-1, 3), axis=0)
    return [int(r), int(g), int(b)]


def process_video(
    input_path: Path,
    output_video_path: Path,
    output_json_path: Path,
    progress_cb: Optional[Callable[[int], None]] = None,
) -> dict:
    """Detect people and track them across frames using YOLO + ByteTrack."""
    model = YOLO(MODEL_NAME)

    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError("Could not open the uploaded video.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if width <= 0 or height <= 0:
        cap.release()
        raise RuntimeError("Video has invalid dimensions.")

    # mp4v is widely supported for a basic local MVP.
    writer = cv2.VideoWriter(
        str(output_video_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Could not create annotated output video.")

    frames_data = []
    frame_index = 0
    unique_track_ids = set()

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_index == 0:
                cv2.imwrite(str(output_video_path.with_name(output_video_path.name.replace("_tracked.mp4", "_frame.jpg"))), frame)

            results = model.track(
                frame,
                persist=True,
                tracker="bytetrack.yaml",
                classes=[0, 32],  # COCO 0 = person, 32 = sports ball
                conf=BALL_CONF,
                verbose=False,
            )

            detections = []
            ball = None
            if results and results[0].boxes is not None:
                boxes = results[0].boxes
                xyxy = boxes.xyxy.cpu().tolist()
                ids = (
                    boxes.id.int().cpu().tolist()
                    if boxes.id is not None
                    else [None] * len(xyxy)
                )
                confs = boxes.conf.cpu().tolist()
                clss = boxes.cls.int().cpu().tolist()

                for box, track_id, confidence, cls in zip(xyxy, ids, confs, clss):
                    if cls == 32:
                        if ball is None or confidence > ball["confidence"]:
                            ball = {
                                "bbox_xyxy": [round(float(v), 2) for v in box],
                                "confidence": round(float(confidence), 4),
                            }
                        continue
                    if confidence < PERSON_CONF:
                        continue
                    if track_id is not None:
                        unique_track_ids.add(int(track_id))
                    detections.append({
                        "track_id": int(track_id) if track_id is not None else None,
                        "bbox_xyxy": [round(float(v), 2) for v in box],
                        "confidence": round(float(confidence), 4),
                        "color": torso_color(frame, box),
                    })

            annotated = results[0].plot() if results else frame
            writer.write(annotated)

            frames_data.append({
                "frame": frame_index,
                "timestamp_seconds": round(frame_index / fps, 3),
                "players": detections,
                "ball": ball,
            })
            frame_index += 1

            if progress_cb and total_frames > 0 and frame_index % 5 == 0:
                # Keep 100 for the final "completed" state.
                progress_cb(min(99, int(frame_index * 100 / total_frames)))
    finally:
        cap.release()
        writer.release()

    payload = {
        "video": input_path.name,
        "fps": fps,
        "width": width,
        "height": height,
        "processed_frames": frame_index,
        "unique_track_ids": sorted(unique_track_ids),
        "frames": frames_data,
        "notes": [
            "Track IDs are temporary tracking identities, not verified player names.",
            "The person detector may also detect referees or other people.",
            "Distance/speed are computed after manual pitch calibration (see /matches/{id}/analysis).",
            "Ball detection with a small model is unreliable; event analysis is experimental.",
        ],
    }

    output_json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    return {
        "processed_frames": frame_index,
        "duration_seconds": round(frame_index / fps, 2) if fps else 0,
        "unique_tracked_players": len(unique_track_ids),
        "annotated_video": str(output_video_path.name),
        "tracking_json": str(output_json_path.name),
    }
