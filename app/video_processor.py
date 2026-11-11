from pathlib import Path
import json
import cv2
from ultralytics import YOLO

MODEL_NAME = "yolo11n.pt"


def process_video(
    input_path: Path,
    output_video_path: Path,
    output_json_path: Path,
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

            results = model.track(
                frame,
                persist=True,
                tracker="bytetrack.yaml",
                classes=[0],  # COCO class 0 = person
                conf=0.25,
                verbose=False,
            )

            detections = []
            if results and results[0].boxes is not None:
                boxes = results[0].boxes
                xyxy = boxes.xyxy.cpu().tolist()
                ids = (
                    boxes.id.int().cpu().tolist()
                    if boxes.id is not None
                    else [None] * len(xyxy)
                )
                confs = boxes.conf.cpu().tolist()

                for box, track_id, confidence in zip(xyxy, ids, confs):
                    if track_id is not None:
                        unique_track_ids.add(int(track_id))
                    detections.append({
                        "track_id": int(track_id) if track_id is not None else None,
                        "bbox_xyxy": [round(float(v), 2) for v in box],
                        "confidence": round(float(confidence), 4),
                    })

            annotated = results[0].plot() if results else frame
            writer.write(annotated)

            frames_data.append({
                "frame": frame_index,
                "timestamp_seconds": round(frame_index / fps, 3),
                "players": detections,
            })
            frame_index += 1
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
            "Distance and speed are not calculated until pitch calibration is implemented.",
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
