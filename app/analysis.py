"""Post-processing of the tracking JSON: teams, metric coordinates, speed/distance,
ball events and formation fit.

Everything here works on the saved tracking JSON, so existing jobs can be
re-analysed (e.g. after changing the calibration) without re-running YOLO.
Event detection and formation fit are heuristics, not ground truth.
"""
from collections import defaultdict
from typing import Any, Optional
import math

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

PITCH_PRESETS = {"5": (40.0, 20.0), "7": (60.0, 40.0), "11": (105.0, 68.0)}
HEAT_GRID = (21, 14)          # cells along length / width (in meters space)
MIN_TRACK_SECONDS = 3.0
SPRINT_MS = 25 / 3.6          # 25 km/h
MAX_HUMAN_MS = 12.0
GOAL_WIDTH = 7.32


# ---------------------------------------------------------------- geometry
def validate_calibration(cal: dict) -> None:
    pts = cal.get("points")
    if not pts or len(pts) != 4 or any(len(p) != 2 for p in pts):
        raise ValueError("Calibration needs exactly 4 points.")
    if not (cal.get("length", 0) > 5 and cal.get("width", 0) > 5):
        raise ValueError("Pitch length/width must be greater than 5 meters.")
    # the quadrilateral must be convex (clicked in order around the pitch)
    signs = []
    for i in range(4):
        a, b, c = pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        signs.append(cross > 0)
    if len(set(signs)) != 1:
        raise ValueError("Points must be the 4 pitch corners in order around the pitch (far-left, far-right, near-right, near-left).")


def homography(cal: dict) -> np.ndarray:
    src = np.array(cal["points"], dtype=np.float32)
    L, W = float(cal["length"]), float(cal["width"])
    dst = np.array([[0, 0], [L, 0], [L, W], [0, W]], dtype=np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def to_meters(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    if len(pts) == 0:
        return np.zeros((0, 2))
    out = cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float32), H)
    return out.reshape(-1, 2).astype(float)


def smooth(a: np.ndarray, w: int) -> np.ndarray:
    if w <= 1 or len(a) < w:
        return a
    pad = w // 2
    ap = np.pad(a, (pad, w - 1 - pad), mode="edge")
    return np.convolve(ap, np.ones(w) / w, "valid")


# ------------------------------------------------------------------- teams
def cluster_teams(data: dict) -> Optional[dict]:
    """Split tracks into 2 groups by median shirt colour (k-means, k=2)."""
    fps = data["fps"] or 25.0
    colors: dict[int, list] = defaultdict(list)
    count: dict[int, int] = defaultdict(int)
    for fr in data["frames"]:
        for p in fr["players"]:
            tid = p["track_id"]
            if tid is None:
                continue
            count[tid] += 1
            if p.get("color"):
                colors[tid].append(p["color"])
    ids = [t for t in colors if count[t] >= MIN_TRACK_SECONDS * fps and len(colors[t]) >= 10]
    if len(ids) < 4:
        return None
    med = np.array([np.median(np.array(colors[t]), axis=0) for t in ids], dtype=np.float32)
    lab = cv2.cvtColor(med.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
    _, labels, _ = cv2.kmeans(lab, 2, None, crit, 10, cv2.KMEANS_PP_CENTERS)
    labels = labels.ravel()
    if len(set(labels.tolist())) < 2:
        return None
    ordered = sorted(range(2), key=lambda k: -(labels == k).sum())  # label 0 = bigger group
    remap = {old: new for new, old in enumerate(ordered)}
    out_labels = {int(t): remap[int(l)] for t, l in zip(ids, labels)}
    centers = []
    for new in range(2):
        members = med[[i for i, t in enumerate(ids) if out_labels[int(t)] == new]]
        centers.append([int(v) for v in members.mean(axis=0)])
    return {"labels": out_labels, "colors": centers}


# ----------------------------------------------------------------- metrics
def project_players(data: dict, H: np.ndarray, L: float, W: float) -> np.ndarray:
    """Rows: frame, track_id, x_m, y_m  (feet position, only points near the pitch)."""
    rows = []
    for fr in data["frames"]:
        for p in fr["players"]:
            if p["track_id"] is None:
                continue
            x1, y1, x2, y2 = p["bbox_xyxy"]
            rows.append((fr["frame"], p["track_id"], (x1 + x2) / 2, y2))
    if not rows:
        return np.zeros((0, 4))
    arr = np.array(rows, dtype=float)
    m = to_meters(H, arr[:, 2:4])
    out = np.column_stack([arr[:, 0], arr[:, 1], m])
    margin = 3.0
    keep = (out[:, 2] > -margin) & (out[:, 2] < L + margin) & (out[:, 3] > -margin) & (out[:, 3] < W + margin)
    return out[keep]


def compute_metrics(rows: np.ndarray, fps: float, L: float, W: float) -> dict:
    metrics: dict[int, dict[str, Any]] = {}
    if len(rows) == 0:
        return metrics
    win = max(5, int(fps * 0.6) | 1)  # ~0.6 s window to suppress bbox jitter
    gx, gy = HEAT_GRID
    for tid in np.unique(rows[:, 1]).astype(int):
        r = rows[rows[:, 1] == tid]
        r = r[np.argsort(r[:, 0])]
        if len(r) < 3:
            continue
        fr = r[:, 0]
        x, y = smooth(r[:, 2], win), smooth(r[:, 3], win)
        dt = np.diff(fr) / fps
        d = np.hypot(np.diff(x), np.diff(y))
        valid = (dt > 0) & (dt <= 1.0)
        sp = np.where(valid, d / np.where(dt > 0, dt, 1), 0.0)
        ok = valid & (sp <= MAX_HUMAN_MS) & (sp >= 0.3)  # dead-zone for standing jitter
        dist = float(d[ok].sum())
        active = float(dt[valid].sum())
        sps = smooth(np.where(ok, sp, 0.0), 5)
        max_sp = float(sps[ok].max()) if ok.any() else 0.0
        sprints, run = 0, 0.0
        for i in range(len(sps)):
            if ok[i] and sps[i] >= SPRINT_MS:
                run += dt[i]
            else:
                if run >= 1.0:
                    sprints += 1
                run = 0.0
        if run >= 1.0:
            sprints += 1
        heat = np.zeros((gy, gx), dtype=int)
        ix = np.clip((x / L * gx).astype(int), 0, gx - 1)
        iy = np.clip((y / W * gy).astype(int), 0, gy - 1)
        np.add.at(heat, (iy, ix), 1)
        step = max(1, len(x) // 300)
        metrics[int(tid)] = {
            "seconds_valid": round(active, 2),
            "distance_m": round(dist, 1),
            "avg_speed_kmh": round(dist / active * 3.6, 2) if active > 0 else 0.0,
            "max_speed_kmh": round(max_sp * 3.6, 1),
            "sprints": sprints,
            "avg_x": round(float(x.mean()), 2),
            "avg_y": round(float(y.mean()), 2),
            "heat": heat.tolist(),
            "path": [[int(f), round(float(a), 2), round(float(b), 2)] for f, a, b in zip(fr[::step], x[::step], y[::step])],
        }
    return metrics


# ------------------------------------------------------------------ events
def _ball_series(data: dict, H: np.ndarray, fps: float):
    fr, pts = [], []
    for f in data["frames"]:
        b = f.get("ball")
        if b:
            x1, y1, x2, y2 = b["bbox_xyxy"]
            fr.append(f["frame"])
            pts.append(((x1 + x2) / 2, (y1 + y2) / 2))
    if len(fr) < 5:
        return np.array([]), np.zeros((0, 2)), len(fr)
    m = to_meters(H, np.array(pts))
    # reject impossible jumps (false detections)
    keep_f, keep_p = [fr[0]], [m[0]]
    for i in range(1, len(fr)):
        dt = (fr[i] - keep_f[-1]) / fps
        if dt > 0 and np.hypot(*(m[i] - keep_p[-1])) / dt <= 35:
            keep_f.append(fr[i]); keep_p.append(m[i])
    out_f, out_p = [], []
    for i in range(len(keep_f)):
        out_f.append(keep_f[i]); out_p.append(keep_p[i])
        if i + 1 < len(keep_f):
            gap = keep_f[i + 1] - keep_f[i]
            if 1 < gap <= 12:  # fill short gaps linearly
                for g in range(1, gap):
                    t = g / gap
                    out_f.append(keep_f[i] + g); out_p.append(keep_p[i] * (1 - t) + keep_p[i + 1] * t)
    return np.array(out_f), np.array(out_p), len(fr)


def compute_events(data: dict, H: np.ndarray, rows: np.ndarray, labels: dict, L: float, W: float) -> dict:
    fps = data["fps"] or 25.0
    bf, bp, raw_ball_frames = _ball_series(data, H, fps)
    total_frames = max(1, data["processed_frames"])
    res: dict[str, Any] = {
        "ball_detected_frames": raw_ball_frames,
        "ball_coverage_pct": round(100 * len(bf) / total_frames, 1),
        "possession": None, "passes": [], "turnovers": [], "shots": [], "per_player": {},
    }
    if len(bf) < 10:
        res["warning"] = "الكرة اتكشفت في عدد إطارات قليل جدًا — الأحداث غير متاحة (موديل yolo11n ضعيف في الكرة الصغيرة؛ جرّب موديل أكبر مثل yolo11m/l)."
        return res

    ball_pos = {int(f): p for f, p in zip(bf, bp)}
    by_frame: dict[int, list] = defaultdict(list)
    for f, tid, x, y in rows:
        by_frame[int(f)].append((int(tid), x, y))

    # who is closest to the ball (within 2.0 m)?
    cand = []
    for f in sorted(ball_pos):
        pl = by_frame.get(f)
        if not pl:
            continue
        bx, by = ball_pos[f]
        tid, x, y = min(pl, key=lambda t: (t[1] - bx) ** 2 + (t[2] - by) ** 2)
        if math.hypot(x - bx, y - by) <= 2.0:
            cand.append((f, tid))
    segs: list[dict] = []
    for f, tid in cand:
        if segs and segs[-1]["tid"] == tid and f - segs[-1]["end"] <= 6:
            segs[-1]["end"] = f; segs[-1]["n"] += 1
        else:
            segs.append({"tid": tid, "start": f, "end": f, "n": 1})
    min_n = max(2, int(fps * 0.12))
    segs = [s for s in segs if s["n"] >= min_n]
    merged: list[dict] = []
    for s in segs:
        if merged and merged[-1]["tid"] == s["tid"] and s["start"] - merged[-1]["end"] <= 6:
            merged[-1]["end"] = s["end"]; merged[-1]["n"] += s["n"]
        else:
            merged.append(dict(s))
    segs = merged

    per: dict[int, dict[str, int]] = defaultdict(lambda: {"touches": 0, "passes": 0, "received": 0, "lost": 0})
    for s in segs:
        per[s["tid"]]["touches"] += 1

    if labels and segs:
        tot = defaultdict(int)
        for s in segs:
            if s["tid"] in labels:
                tot[labels[s["tid"]]] += s["end"] - s["start"] + 1
        t = sum(tot.values())
        if t:
            res["possession"] = {str(k): round(100 * v / t, 1) for k, v in tot.items()}

    for a, b in zip(segs, segs[1:]):
        if a["tid"] == b["tid"]:
            continue
        gap = (b["start"] - a["end"]) / fps
        if gap > 3.0 or a["end"] not in ball_pos or b["start"] not in ball_pos:
            continue
        length = float(np.hypot(*(ball_pos[b["start"]] - ball_pos[a["end"]])))
        if length < 2.5:
            continue
        ta, tb = labels.get(a["tid"]), labels.get(b["tid"])
        ev = {"time": round(a["end"] / fps, 2), "from": a["tid"], "to": b["tid"], "length_m": round(length, 1), "team": ta}
        if ta is None or tb is None:
            continue
        if ta == tb:
            res["passes"].append(ev)
            per[a["tid"]]["passes"] += 1
            per[b["tid"]]["received"] += 1
        else:
            res["turnovers"].append(ev)
            per[a["tid"]]["lost"] += 1

    # shots: fast ball heading to a goal line
    if len(bf) > 5:
        contiguous = np.diff(bf) == 1
        v = np.zeros(len(bf))
        vx = np.zeros(len(bf)); vy = np.zeros(len(bf))
        dxy = np.diff(bp, axis=0) * fps
        vx[1:] = np.where(contiguous, dxy[:, 0], 0); vy[1:] = np.where(contiguous, dxy[:, 1], 0)
        vx, vy = smooth(vx, 3), smooth(vy, 3)
        v = np.hypot(vx, vy)
        i, last_shot = 0, -999.0
        while i < len(bf):
            if v[i] > 14:
                j = i
                while j < len(bf) and v[j] > 14:
                    j += 1
                if j - i >= 3 and abs(vx[i:j].mean()) > 0.6 * v[i:j].mean():
                    x0, y0 = bp[i]
                    mvx, mvy = vx[i:j].mean(), vy[i:j].mean()
                    xl = L if mvx > 0 else 0.0
                    y_at = y0 + mvy / mvx * (xl - x0)
                    t0 = bf[i] / fps
                    if abs(xl - x0) <= 40 and abs(y_at - W / 2) <= GOAL_WIDTH / 2 + 4 and t0 - last_shot > 1.5:
                        shooter = None
                        for s in reversed(segs):
                            if s["end"] <= bf[i] and (bf[i] - s["end"]) / fps <= 1.0:
                                shooter = s["tid"]; break
                        res["shots"].append({"time": round(t0, 2), "player": shooter, "speed_kmh": round(float(v[i:j].max()) * 3.6, 1),
                                             "team": labels.get(shooter), "toward": "right" if mvx > 0 else "left"})
                        last_shot = t0
                i = j
            else:
                i += 1
    res["per_player"] = {str(k): v for k, v in per.items()}
    return res


# --------------------------------------------------------- formation fit
def fit_formation(metrics: dict, labels: dict, team: int, slots: list, attack: str, L: float, W: float,
                  min_seconds: float = 5.0) -> dict:
    tr = [(int(t), m) for t, m in metrics.items() if labels.get(int(t)) == team and m["seconds_valid"] >= min_seconds]
    tr.sort(key=lambda t: -t[1]["seconds_valid"])
    tr = tr[: len(slots)]
    if len(tr) < 3:
        raise ValueError("عدد اللاعبين المكتشفين للفريق قليل (أقل من 3) — جرّب تقليل الحد الأدنى للظهور.")
    P = np.array([[m["avg_x"], m["avg_y"]] for _, m in tr])
    S = np.array([[(1 - s["y"]) * L, s["x"] * W] for s in slots])  # (along attack, across)

    def solve_dir(direction: str, mirror: bool):
        u = P[:, 0] if direction == "right" else L - P[:, 0]
        v = P[:, 1] if direction == "right" else W - P[:, 1]
        if mirror:
            v = W - v
        Q = np.column_stack([u, v])
        off = S.mean(axis=0) - Q.mean(axis=0)
        for _ in range(3):  # re-centre on the assigned subset
            C = np.linalg.norm((Q + off)[:, None, :] - S[None, :, :], axis=2)
            ri, ci = linear_sum_assignment(C)
            off = (S[ci] - Q[ri]).mean(axis=0)
        C = np.linalg.norm((Q + off)[:, None, :] - S[None, :, :], axis=2)
        ri, ci = linear_sum_assignment(C)
        return C[ri, ci].sum(), ri, ci, C

    attack_used = attack
    if attack == "auto":
        cands = [(solve_dir(d, m), d) for d in ("right", "left") for m in (False, True)]
        (best, attack_used) = min(cands, key=lambda c: c[0][0])
    else:
        best = min((solve_dir(attack, False), solve_dir(attack, True)), key=lambda r: r[0])
    _, ri, ci, C = best
    rows = []
    for r, c in zip(ri, ci):
        d = float(C[r, c])
        rows.append({"track_id": tr[r][0], "slot": int(c), "role": slots[c].get("role", ""),
                     "distance_m": round(d, 1), "score": round(max(0.0, 100 - 5 * d), 1)})
    rows.sort(key=lambda x: x["slot"])
    return {"attack_used": attack_used, "players": rows, "team_score": round(float(np.mean([r["score"] for r in rows])), 1),
            "unassigned_slots": [int(i) for i in range(len(slots)) if i not in set(ci.tolist())],
            "note": "المقارنة تتم على شكل التشكيل (بعد إزالة إزاحة مركز الفريق) باستخدام متوسط مراكز اللاعبين طوال الفيديو."}


# ------------------------------------------------------------ orchestrator
def analyze(data: dict, calibration: Optional[dict]) -> dict:
    fps = data["fps"] or 25.0
    teams = cluster_teams(data)
    labels = teams["labels"] if teams else {}
    out: dict[str, Any] = {
        "calibrated": bool(calibration), "calibration": calibration,
        "teams": teams, "metrics": None, "events": None, "pitch": None, "warnings": [],
    }
    if not teams:
        out["warnings"].append("تعذّر تقسيم الفرق بالألوان (فيديو قديم بدون ألوان، أو لاعبين قليلين). أعد معالجة الفيديو بالنسخة الجديدة.")
    if not calibration:
        return out
    H = homography(calibration)
    L, W = float(calibration["length"]), float(calibration["width"])
    rows = project_players(data, H, L, W)
    out["pitch"] = {"length": L, "width": W, "grid": list(HEAT_GRID)}
    out["metrics"] = compute_metrics(rows, fps, L, W)
    out["events"] = compute_events(data, H, rows, labels, L, W)
    if not any(f.get("ball") for f in data["frames"]):
        out["warnings"].append("لا توجد بيانات كرة في هذا الفيديو (معالج بالنسخة القديمة). أعد رفعه لاكتشاف الكرة.")
    return out
