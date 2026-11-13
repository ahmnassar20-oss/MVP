"""Optional jersey-number reading with EasyOCR (not installed by default).

pip install easyocr   (downloads PyTorch models; slow on CPU)
Accuracy on small, blurry, far-away players is limited, so results are suggestions
that the coach confirms in the UI.
"""
from collections import defaultdict
from pathlib import Path
import cv2


def read_jerseys(video_path: Path, data: dict, max_crops: int = 8, min_seconds: float = 3.0) -> dict:
    try:
        import easyocr
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("EasyOCR غير مثبت. شغّل: .venv\\Scripts\\pip install easyocr") from exc

    fps = data["fps"] or 25.0
    per_track: dict[int, list] = defaultdict(list)
    for fr in data["frames"]:
        for p in fr["players"]:
            if p["track_id"] is None:
                continue
            x1, y1, x2, y2 = p["bbox_xyxy"]
            if y2 - y1 >= 70:  # need enough pixels for digits
                per_track[p["track_id"]].append((fr["frame"], p["bbox_xyxy"]))

    wanted: dict[int, list] = {}
    for tid, items in per_track.items():
        if len(items) < min_seconds * fps:
            continue
        step = max(1, len(items) // max_crops)
        for frame, box in items[::step][:max_crops]:
            wanted.setdefault(frame, []).append((tid, box))

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError("تعذر فتح الفيديو الأصلي (ربما اتحذف من uploads).")
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    votes: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for frame in sorted(wanted):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
        ok, img = cap.read()
        if not ok:
            continue
        for tid, (x1, y1, x2, y2) in wanted[frame]:
            h, w = y2 - y1, x2 - x1
            crop = img[max(int(y1 + h * 0.12), 0): int(y1 + h * 0.6), max(int(x1), 0): int(x2)]
            if crop.size == 0:
                continue
            crop = cv2.resize(crop, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC)
            for _, text, conf in reader.readtext(crop, allowlist="0123456789", detail=1):
                if 1 <= len(text) <= 2 and conf >= 0.4 and not (len(text) == 2 and text[0] == "0"):
                    votes[tid][str(int(text))] += conf
    cap.release()

    out = {}
    for tid, v in votes.items():
        num, score = max(v.items(), key=lambda kv: kv[1])
        total = sum(v.values())
        out[str(tid)] = {"number": int(num), "score": round(score, 2), "share": round(score / total, 2)}
    return out
