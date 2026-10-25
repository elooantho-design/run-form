from pathlib import Path
import argparse
import hashlib
import json
import re
from collections import defaultdict

import cv2
import numpy as np
from arrow_marker import MIN_MARGIN as ARROW_MIN_MARGIN, MIN_SCORE as ARROW_MIN_SCORE, detect_cell_arrow


BASE_W = 3840
BASE_H = 2160

BOT_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = BOT_ROOT / "data" / "templates" / "templates_heroes"

EXPECTED_HEROES = 5

# New GVG season map calibration.
# Towers = 7 rows x 10 columns.
# Fortress = 8 rows x 11 columns.
GRID_ROWS = 7
GRID_COLS = 10
FORTRESS_GRID_ROWS = 8
FORTRESS_GRID_COLS = 11

# The responsive launcher saves a normalized 3840x2160 screenshot.
# BASE_BOARD_* is the top-left anchor of the board area in that viewport.
BASE_BOARD_LEFT = 1279
BASE_BOARD_TOP = 466
FORTRESS_BOARD_LEFT = 1173
FORTRESS_BOARD_TOP = 490

# Grid coordinates below are measured on the new board reference images.
TOWER_GRID_ORIGIN_X = 186
TOWER_GRID_BOTTOM_Y = 938
FORTRESS_GRID_ORIGIN_X = 0.5
FORTRESS_GRID_BOTTOM_Y = 1085

BASE_CELL_PX = 127
FORTRESS_BASE_CELL_PX = 136
TOWER_BOARD_W = 1637
TOWER_BOARD_H = 961
FORTRESS_BOARD_W = 1497
FORTRESS_BOARD_H = 1082

FULL_GRID_ORIGIN_X = BASE_BOARD_LEFT + TOWER_GRID_ORIGIN_X
FULL_GRID_BOTTOM_Y = BASE_BOARD_TOP + TOWER_GRID_BOTTOM_Y
FORTRESS_FULL_GRID_ORIGIN_X = FORTRESS_BOARD_LEFT + FORTRESS_GRID_ORIGIN_X
FORTRESS_FULL_GRID_BOTTOM_Y = FORTRESS_BOARD_TOP + FORTRESS_GRID_BOTTOM_Y
GRID_LEFT_OFFSET_FACTOR = TOWER_GRID_ORIGIN_X / BASE_CELL_PX
GRID_BOTTOM_OFFSET_FACTOR = TOWER_GRID_BOTTOM_Y / BASE_CELL_PX
FORTRESS_GRID_LEFT_OFFSET_FACTOR = FORTRESS_GRID_ORIGIN_X / FORTRESS_BASE_CELL_PX
FORTRESS_GRID_BOTTOM_OFFSET_FACTOR = FORTRESS_GRID_BOTTOM_Y / FORTRESS_BASE_CELL_PX

# The fortress modal can shift and scale slightly depending on the launcher
# environment. Anchor the grid to the detected map frame instead of the full
# 3840x2160 viewport whenever the frame is visible.
FORTRESS_GRID_LEFT_IN_FRAME_FACTOR = 0.10
FORTRESS_GRID_BOTTOM_IN_FRAME_FACTOR = 0.0

DEBUG_RECT_W = 124
DEBUG_RECT_H = 124
FORTRESS_DEBUG_RECT_W = 140
FORTRESS_DEBUG_RECT_H = 140
FORTRESS_TRI_SIZE = 16
CELL_SEARCH_MARGIN = 20
CIRCLE_SHRINK = 12

GREEN_H_MIN, GREEN_H_MAX = 45, 85
GREEN_S_MIN, GREEN_V_MIN = 75, 105

YELLOW_H_MIN, YELLOW_H_MAX = 18, 40
YELLOW_S_MIN, YELLOW_V_MIN = 80, 80

DIRECTION_VECTORS = {
    "N": (0.0, -1.0),
    "S": (0.0, 1.0),
    "E": (1.0, 0.0),
    "O": (-1.0, 0.0),
}
OPPOSITE_DIRECTION = {
    "N": "S",
    "S": "N",
    "E": "O",
    "O": "E",
}

H_BINS = 30
S_BINS = 32
COLOR_WEIGHT = 0.22

MIN_GRAY = 0.70
MIN_COLOR = 0.28
MIN_COMBINED = 0.78
MIN_MARGIN = 0.018

CELL_EDGE_RAW_TRUST_RATIO = 0.12
CELL_EDGE_RAW_TRUST_MARGIN = 100
CELL_EDGE_ARBITER_RATIO = 0.06
CELL_EDGE_ARBITER_MARGIN = 35
CELL_EDGE_MIN_MARKER_SCORE = 90
CELL_EDGE_CORE_MARKER_SCORE = 120
CELL_EDGE_CORE_MARGIN = 90
CELL_EDGE_CORE_RATIO = 0.055
CELL_EDGE_OUTWARD_WEIGHT = 2.0
CELL_EDGE_OUTWARD_MARGIN = 45
CELL_EDGE_OUTWARD_RATIO = 0.03

HERO_MARGIN_ALIASES = {
    "damemina": "ladymina",
    "ladymina2": "ladymina",
}


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", "", name.strip().lower())


def canonical_hero_margin_name(name: str) -> str:
    normalized = normalize_name(str(name or ""))
    return HERO_MARGIN_ALIASES.get(normalized, normalized)


def normalize_champion_id(name: str) -> str:
    return re.sub(r"\d+$", "", normalize_name(name or ""))


def read_img(path: Path):
    return cv2.imread(str(path), cv2.IMREAD_COLOR)


def scale_for(img):
    h, w = img.shape[:2]
    sx = w / BASE_W
    sy = h / BASE_H
    s = (sx + sy) / 2.0
    return sx, sy, s


def scale_px(v, s):
    return max(1, int(round(float(v) * float(s))))


def circular_mask_u8(h, w, shrink=CIRCLE_SHRINK):
    mask = np.zeros((h, w), dtype=np.uint8)
    cy, cx = h // 2, w // 2
    r = min(cx, cy) - int(shrink)
    if r <= 0:
        mask[:] = 255
        return mask
    cv2.circle(mask, (cx, cy), r, 255, -1)
    return mask


def hsv_hist_signature(bgr_img, mask):
    hsv = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], mask, [H_BINS, S_BINS], [0, 180, 0, 256])
    cv2.normalize(hist, hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
    return hist


def color_similarity(screen_patch_bgr, hero_sigs):
    if screen_patch_bgr is None or screen_patch_bgr.size == 0:
        return 0.0
    h, w = screen_patch_bgr.shape[:2]
    mask = circular_mask_u8(h, w)
    patch_hist = hsv_hist_signature(screen_patch_bgr, mask)

    best_sim = 0.0
    for sig in hero_sigs:
        d = cv2.compareHist(patch_hist, sig, cv2.HISTCMP_BHATTACHARYYA)
        best_sim = max(best_sim, 1.0 - float(d))
    return float(best_sim)


def clamp_rect(x1, y1, x2, y2, w, h):
    x1 = max(0, min(w - 1, int(round(x1))))
    y1 = max(0, min(h - 1, int(round(y1))))
    x2 = max(1, min(w, int(round(x2))))
    y2 = max(1, min(h, int(round(y2))))
    if x2 <= x1:
        x2 = min(w, x1 + 1)
    if y2 <= y1:
        y2 = min(h, y1 + 1)
    return x1, y1, x2, y2


def grid_label(col_idx, row_idx_from_bottom):
    return f"{chr(ord('A') + row_idx_from_bottom)}{col_idx + 1}"


def grid_cell_center(col_idx, row_idx_from_bottom, origin_x, bottom_y, cell_px):
    cx = origin_x + (col_idx + 0.5) * cell_px
    cy = bottom_y - (row_idx_from_bottom + 0.5) * cell_px
    return cx, cy


def yellow_score_in_roi(hsv, x1, y1, x2, y2):
    h, w = hsv.shape[:2]
    x1, y1, x2, y2 = clamp_rect(x1, y1, x2, y2, w, h)
    roi = hsv[y1:y2, x1:x2]
    if roi.size == 0:
        return 0
    lower = np.array([YELLOW_H_MIN, YELLOW_S_MIN, YELLOW_V_MIN], dtype=np.uint8)
    upper = np.array([YELLOW_H_MAX, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(roi, lower, upper)
    return int(cv2.countNonZero(mask))


def yellow_mask_for_roi(hsv, x1, y1, x2, y2):
    h, w = hsv.shape[:2]
    x1, y1, x2, y2 = clamp_rect(x1, y1, x2, y2, w, h)
    roi = hsv[y1:y2, x1:x2]
    lower = np.array([YELLOW_H_MIN, YELLOW_S_MIN, YELLOW_V_MIN], dtype=np.uint8)
    upper = np.array([YELLOW_H_MAX, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(roi, lower, upper)
    kernel = np.ones((2, 2), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return mask, x1, y1


def direction_from_offset(dx, dy):
    dist = float(np.hypot(dx, dy))
    if dist <= 0:
        return "E", 0.0, dist

    if abs(dx) >= abs(dy):
        direction = "E" if dx >= 0 else "O"
        alignment = abs(dx) / dist
    else:
        direction = "S" if dy >= 0 else "N"
        alignment = abs(dy) / dist
    return direction, float(alignment), dist


def direction_search_rect(direction, cell, params, img_shape):
    h, w = img_shape[:2]
    cx = float(cell["cx"])
    cy = float(cell["cy"])
    cp = float(params["cell_px"])
    inner = cp * 0.10
    outer = cp * 0.72
    half = cp * 0.34

    if direction == "E":
        return clamp_rect(cx + inner, cy - half, cx + outer, cy + half, w, h)
    if direction == "O":
        return clamp_rect(cx - outer, cy - half, cx - inner, cy + half, w, h)
    if direction == "S":
        return clamp_rect(cx - half, cy + inner, cx + half, cy + outer, w, h)
    return clamp_rect(cx - half, cy - outer, cx + half, cy - inner, w, h)


def triangle_template_masks(direction, cell_px, size_mul=1.0):
    length = max(8, int(round(cell_px * 0.13 * size_mul)))
    width = max(10, int(round(cell_px * 0.17 * size_mul)))
    pad = max(4, int(round(cell_px * 0.04)))

    if direction in ("E", "O"):
        tw = length + 2 * pad
        th = width + 2 * pad
        mid_y = th // 2
        half_w = width // 2
        if direction == "E":
            pts = np.array([[pad, mid_y - half_w], [pad, mid_y + half_w], [pad + length, mid_y]], dtype=np.int32)
            apex = (pad + length, mid_y)
            base_mid = (pad, mid_y)
        else:
            pts = np.array([[pad + length, mid_y - half_w], [pad + length, mid_y + half_w], [pad, mid_y]], dtype=np.int32)
            apex = (pad, mid_y)
            base_mid = (pad + length, mid_y)
    else:
        tw = width + 2 * pad
        th = length + 2 * pad
        mid_x = tw // 2
        half_w = width // 2
        if direction == "S":
            pts = np.array([[mid_x - half_w, pad], [mid_x + half_w, pad], [mid_x, pad + length]], dtype=np.int32)
            apex = (mid_x, pad + length)
            base_mid = (mid_x, pad)
        else:
            pts = np.array([[mid_x - half_w, pad + length], [mid_x + half_w, pad + length], [mid_x, pad]], dtype=np.int32)
            apex = (mid_x, pad)
            base_mid = (mid_x, pad + length)

    tri = np.zeros((th, tw), dtype=np.uint8)
    cv2.fillConvexPoly(tri, pts, 255)
    dilate_k = max(3, int(round(cell_px * 0.045)))
    if dilate_k % 2 == 0:
        dilate_k += 1
    outline = cv2.dilate(tri, np.ones((dilate_k, dilate_k), np.uint8), iterations=1)
    outline = cv2.subtract(outline, tri)
    return tri, outline, pts, apex, base_mid


def masked_ccorr_score(signal, mask):
    if signal.shape[0] < mask.shape[0] or signal.shape[1] < mask.shape[1]:
        return None
    template = np.ones(mask.shape, dtype=np.float32)
    mask_u8 = (mask > 0).astype(np.uint8) * 255
    try:
        res = cv2.matchTemplate(signal.astype(np.float32), template, cv2.TM_CCORR_NORMED, mask=mask_u8)
    except cv2.error:
        return None
    if res is None or res.size == 0:
        return None
    return np.nan_to_num(res, nan=0.0, posinf=0.0, neginf=0.0)


def direction_marker_candidates(img, hero, params, cell):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cell_px = float(params["cell_px"])
    candidates = []

    for direction in DIRECTION_VECTORS:
        x1, y1, x2, y2 = direction_search_rect(direction, cell, params, img.shape)
        roi_hsv = hsv[y1:y2, x1:x2]
        roi_gray = gray[y1:y2, x1:x2]
        if roi_hsv.size == 0 or roi_gray.size == 0:
            continue

        gold = cv2.inRange(
            roi_hsv,
            np.array([YELLOW_H_MIN, 45, 105], dtype=np.uint8),
            np.array([YELLOW_H_MAX, 255, 255], dtype=np.uint8),
        )
        green_bg = cv2.inRange(
            roi_hsv,
            np.array([GREEN_H_MIN, 45, 70], dtype=np.uint8),
            np.array([GREEN_H_MAX, 255, 255], dtype=np.uint8),
        )
        hole_signal = ((gold == 0) & (green_bg == 0) & (roi_gray < 215)).astype(np.float32)
        gold_signal = (gold > 0).astype(np.float32)

        best = None
        for size_mul in (0.82, 1.0, 1.18):
            tri, outline, pts, apex, base_mid = triangle_template_masks(direction, cell_px, size_mul)
            hole_resp = masked_ccorr_score(hole_signal, tri)
            outline_resp = masked_ccorr_score(gold_signal, outline)
            if hole_resp is None or outline_resp is None:
                continue

            combined = 0.40 * hole_resp + 0.60 * outline_resp
            _, maxv, _, maxloc = cv2.minMaxLoc(combined)
            lx, ly = maxloc
            hole_score = float(hole_resp[ly, lx])
            outline_score = float(outline_resp[ly, lx])

            pts_abs = pts.astype(np.float32) + np.array([float(x1 + lx), float(y1 + ly)], dtype=np.float32)
            apex_abs = np.array([float(x1 + lx + apex[0]), float(y1 + ly + apex[1])], dtype=np.float32)
            base_abs = np.array([float(x1 + lx + base_mid[0]), float(y1 + ly + base_mid[1])], dtype=np.float32)
            vx, vy = DIRECTION_VECTORS[direction]
            axis_dist = (apex_abs[0] - float(cell["cx"])) * vx + (apex_abs[1] - float(cell["cy"])) * vy
            perp_dist = abs(-vy * (apex_abs[0] - float(cell["cx"])) + vx * (apex_abs[1] - float(cell["cy"])))

            tri_abs_mask = np.zeros(gray.shape[:2], dtype=np.uint8)
            cv2.fillConvexPoly(tri_abs_mask, pts_abs.astype(np.int32), 255)
            tri_pixels = tri_abs_mask > 0
            if np.count_nonzero(tri_pixels):
                tri_hsv = hsv[tri_pixels]
                hole_v = float(np.mean(tri_hsv[:, 2]))
                hole_green_ratio = float(
                    np.count_nonzero(
                        (tri_hsv[:, 0] >= GREEN_H_MIN)
                        & (tri_hsv[:, 0] <= GREEN_H_MAX)
                        & (tri_hsv[:, 1] >= 45)
                        & (tri_hsv[:, 2] >= 70)
                    )
                    / max(1, tri_hsv.shape[0])
                )
            else:
                hole_v = 0.0
                hole_green_ratio = 1.0

            bx1, by1, bw, bh = int(x1 + lx), int(y1 + ly), int(tri.shape[1]), int(tri.shape[0])
            rx1, ry1, rx2, ry2 = clamp_rect(bx1 - 8, by1 - 8, bx1 + bw + 8, by1 + bh + 8, img.shape[1], img.shape[0])
            local_ring_mask = np.zeros(gray.shape[:2], dtype=np.uint8)
            cv2.rectangle(local_ring_mask, (rx1, ry1), (rx2 - 1, ry2 - 1), 255, -1)
            tri_big = cv2.dilate(tri_abs_mask, np.ones((9, 9), np.uint8), iterations=1)
            ring_pixels = (local_ring_mask > 0) & (tri_big == 0)
            if np.count_nonzero(ring_pixels):
                ring_hsv = hsv[ring_pixels]
                bg_green_ratio = float(
                    np.count_nonzero(
                        (ring_hsv[:, 0] >= GREEN_H_MIN)
                        & (ring_hsv[:, 0] <= GREEN_H_MAX)
                        & (ring_hsv[:, 1] >= 45)
                        & (ring_hsv[:, 2] >= 70)
                    )
                    / max(1, ring_hsv.shape[0])
                )
            else:
                bg_green_ratio = 1.0

            center_bonus = max(0.0, 1.0 - (perp_dist / max(1.0, cell_px * 0.25)))
            score = float(0.36 * hole_score + 0.54 * outline_score + 0.10 * center_bonus)
            raw_score = float(maxv)

            rejected = hole_score < 0.55 or outline_score < 0.18 or score < 0.40
            if axis_dist < cell_px * 0.10 or axis_dist > cell_px * 0.80 or perp_dist > cell_px * 0.25:
                rejected = True
            if hole_v < 70.0 or hole_green_ratio > 0.35 or bg_green_ratio > 0.34:
                rejected = True

            item = {
                "direction": direction,
                "score": score,
                "raw_score": round(raw_score, 4),
                "hole_score": round(hole_score, 4),
                "outline_score": round(outline_score, 4),
                "center_bonus": round(float(center_bonus), 4),
                "hole_v": round(float(hole_v), 2),
                "hole_green_ratio": round(float(hole_green_ratio), 4),
                "bg_green_ratio": round(float(bg_green_ratio), 4),
                "area": int(cv2.countNonZero(tri)),
                "fill_ratio": 1.0,
                "cx": round(float(np.mean(pts_abs[:, 0])), 2),
                "cy": round(float(np.mean(pts_abs[:, 1])), 2),
                "axis_alignment": 1.0,
                "axis_dist": round(float(axis_dist), 2),
                "perp_dist": round(float(perp_dist), 2),
                "tip_length": round(float(np.hypot(apex_abs[0] - base_abs[0], apex_abs[1] - base_abs[1])), 2),
                "apex_dist": round(float(axis_dist), 2),
                "base_dist": round(float(np.hypot(base_abs[0] - float(cell["cx"]), base_abs[1] - float(cell["cy"]))), 2),
                "aligned_to_center": bool(not rejected),
                "invalid_toward_center": False,
                "rejected": bool(rejected),
                "box": [bx1, by1, bw, bh],
                "triangle": [
                    [round(float(pt[0]), 2), round(float(pt[1]), 2)]
                    for pt in pts_abs
                ],
                "apex": [round(float(apex_abs[0]), 2), round(float(apex_abs[1]), 2)],
                "base_mid": [round(float(base_abs[0]), 2), round(float(base_abs[1]), 2)],
            }
            if best is None or item["score"] > best["score"]:
                best = item

        if best is not None:
            candidates.append(best)

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates


def load_hero_templates():
    if not TEMPLATES_DIR.exists():
        raise FileNotFoundError(f"Templates folder missing: {TEMPLATES_DIR}")

    heroes_gray = defaultdict(list)
    hero_color_sigs = defaultdict(list)
    paths = sorted(TEMPLATES_DIR.glob("*.png"))
    if not paths:
        raise FileNotFoundError(f"No hero templates in: {TEMPLATES_DIR}")

    for path in paths:
        hero_name = normalize_name(path.stem.split("_p")[0])
        tpl_gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        tpl_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if tpl_gray is None or tpl_bgr is None:
            continue

        heroes_gray[hero_name].append(tpl_gray)
        mask = circular_mask_u8(*tpl_gray.shape)
        hero_color_sigs[hero_name].append(hsv_hist_signature(tpl_bgr, mask))

    return heroes_gray, hero_color_sigs


def green_mask_for_board(img):
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower = np.array([GREEN_H_MIN, GREEN_S_MIN, GREEN_V_MIN], dtype=np.uint8)
    upper = np.array([GREEN_H_MAX, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower, upper)

    roi = np.zeros_like(mask)
    x1, y1, x2, y2 = clamp_rect(0.22 * w, 0.16 * h, 0.90 * w, 0.82 * h, w, h)
    roi[y1:y2, x1:x2] = 255
    mask = cv2.bitwise_and(mask, roi)

    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return mask


def green_components(mask):
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    comps = []
    for idx in range(1, count):
        x, y, bw, bh, area = stats[idx]
        if area < 500 or bw < 30 or bh < 30:
            continue
        if bw > 1000 or bh > 800:
            continue
        aspect = float(bw) / float(bh)
        if aspect < 0.28 or aspect > 3.5:
            continue
        comps.append({
            "x": int(x),
            "y": int(y),
            "w": int(bw),
            "h": int(bh),
            "x2": int(x + bw),
            "y2": int(y + bh),
            "area": int(area),
        })
    return comps


def strongest_edge(gray, x1, y1, x2, y2, axis, fallback):
    h, w = gray.shape[:2]
    x1, y1, x2, y2 = clamp_rect(x1, y1, x2, y2, w, h)
    roi = gray[y1:y2, x1:x2]
    if roi.size == 0:
        return float(fallback)

    if axis == "x":
        profile = roi.mean(axis=0)
        offset = x1
    else:
        profile = roi.mean(axis=1)
        offset = y1

    if profile.size < 2:
        return float(fallback)
    diff = np.abs(np.diff(profile.astype(np.float32)))
    return float(offset + int(np.argmax(diff)) + 1)


def estimate_board_anchor(img):
    h, w = img.shape[:2]
    sx, sy, _ = scale_for(img)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    board_left = strongest_edge(
        gray,
        0.23 * w,
        0.18 * h,
        0.45 * w,
        0.82 * h,
        "x",
        BASE_BOARD_LEFT * sx,
    )
    board_top = strongest_edge(
        gray,
        0.25 * w,
        0.12 * h,
        0.88 * w,
        0.36 * h,
        "y",
        BASE_BOARD_TOP * sy,
    )
    return board_left, board_top


def detect_fortress_map_frame(img):
    h, w = img.shape[:2]
    if w >= 2600 or h >= 1600:
        x0 = int(round(0.245 * w))
        y0 = int(round(0.19 * h))
        x2 = int(round(0.85 * w))
        y2 = int(round(0.78 * h))
    else:
        x0, y0, x2, y2 = 0, 0, w, h

    x0, y0, x2, y2 = clamp_rect(x0, y0, x2, y2, w, h)
    roi = img[y0:y2, x0:x2]
    if roi.size == 0:
        return None

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=120,
        minLineLength=max(240, int(round(0.35 * (x2 - x0)))),
        maxLineGap=18,
    )
    if lines is None:
        return None

    min_vertical = max(420, int(round(0.72 * (y2 - y0))))
    min_horizontal = max(900, int(round(0.70 * (x2 - x0))))
    max_axis_slop = max(8, int(round(0.004 * w)))
    vertical_xs = []
    horizontal_ys = []

    for x1, y1, lx2, ly2 in lines[:, 0, :]:
        dx = abs(int(lx2) - int(x1))
        dy = abs(int(ly2) - int(y1))
        if dy >= min_vertical and dx <= max_axis_slop:
            vertical_xs.append(float((x1 + lx2) / 2.0 + x0))
        elif dx >= min_horizontal and dy <= max_axis_slop:
            horizontal_ys.append(float((y1 + ly2) / 2.0 + y0))

    if len(vertical_xs) < 2 or len(horizontal_ys) < 2:
        return None

    xs = clustered_values(vertical_xs, max(6.0, 0.004 * w))
    ys = clustered_values(horizontal_ys, max(6.0, 0.004 * h))
    if len(xs) < 2 or len(ys) < 2:
        return None

    left = min(xs)
    right = max(xs)
    top = min(ys)
    bottom = max(ys)
    frame_w = right - left
    frame_h = bottom - top
    if frame_w <= 0 or frame_h <= 0:
        return None
    aspect = frame_w / frame_h
    if aspect < 1.45 or aspect > 1.9:
        return None

    return {
        "left": float(left),
        "top": float(top),
        "right": float(right),
        "bottom": float(bottom),
        "w": float(frame_w),
        "h": float(frame_h),
    }


def estimate_cell_px(comps):
    candidates = []
    for comp in comps:
        for dim in (comp["w"], comp["h"]):
            for span in range(1, 6):
                cell = float(dim) / float(span)
                if 118 <= cell <= 178:
                    candidates.append(cell)

    if not candidates:
        return None
    return float(np.median(np.array(candidates, dtype=np.float32)))


def cluster_candidates(values, tolerance):
    if not values:
        return []

    clusters = []
    sorted_values = sorted(float(v) for v in values)
    current = [sorted_values[0]]
    for value in sorted_values[1:]:
        mean = sum(current) / len(current)
        if abs(value - mean) <= tolerance:
            current.append(value)
        else:
            clusters.append(current)
            current = [value]
    clusters.append(current)

    return [
        {
            "value": float(sum(cluster) / len(cluster)),
            "count": len(cluster),
            "spread": float(max(cluster) - min(cluster)) if len(cluster) > 1 else 0.0,
        }
        for cluster in clusters
    ]


def choose_candidate(values, expected, tolerance, fallback):
    clusters = cluster_candidates(values, tolerance)
    if not clusters:
        return float(fallback)

    def score(cluster):
        distance = abs(cluster["value"] - expected)
        support_bonus = min(cluster["count"], 12) * tolerance * 0.35
        return distance - support_bonus

    best = min(clusters, key=score)
    if abs(best["value"] - expected) > tolerance * 10:
        return float(fallback)
    return float(best["value"])


def fit_grid_axis_from_green(
    comps,
    cell_px,
    board_left,
    board_top,
    left_offset_factor=GRID_LEFT_OFFSET_FACTOR,
    bottom_offset_factor=GRID_BOTTOM_OFFSET_FACTOR,
    grid_cols=GRID_COLS,
    grid_rows=GRID_ROWS,
):
    expected_x = board_left + left_offset_factor * cell_px
    expected_y = board_top + bottom_offset_factor * cell_px
    fallback_x = expected_x
    fallback_y = expected_y
    tolerance = max(8.0, cell_px * 0.08)

    x_candidates = []
    y_candidates = []
    for comp in comps:
        for edge in (comp["x"], comp["x2"]):
            for line_idx in range(grid_cols + 1):
                origin = float(edge) - line_idx * cell_px
                if board_left - cell_px <= origin <= board_left + 4.0 * cell_px:
                    x_candidates.append(origin)

        for edge in (comp["y"], comp["y2"]):
            for line_idx in range(grid_rows + 1):
                bottom = float(edge) + line_idx * cell_px
                if board_top + 4.0 * cell_px <= bottom <= board_top + 10.0 * cell_px:
                    y_candidates.append(bottom)

    origin_x = choose_candidate(x_candidates, expected_x, tolerance, fallback_x)
    bottom_y = choose_candidate(y_candidates, expected_y, tolerance, fallback_y)
    return origin_x, bottom_y


def board_crop_grid_params(img, mode):
    h, w = img.shape[:2]
    mode = (mode or "tower").lower()
    if mode == "fortress":
        sx = w / FORTRESS_BOARD_W
        sy = h / FORTRESS_BOARD_H
        s = (sx + sy) / 2.0
        return {
            "mode": "fortress",
            "sx": sx,
            "sy": sy,
            "s": s,
            "origin_x": FORTRESS_GRID_ORIGIN_X * sx,
            "bottom_y": FORTRESS_GRID_BOTTOM_Y * sy,
            "cell_px": FORTRESS_BASE_CELL_PX * s,
            "grid_rows": FORTRESS_GRID_ROWS,
            "grid_cols": FORTRESS_GRID_COLS,
            "debug_w": FORTRESS_DEBUG_RECT_W * s,
            "debug_h": FORTRESS_DEBUG_RECT_H * s,
            "template_s": 0.90 * s,
            "marker_dist": 68 * s,
            "marker_w": max(4, 8 * s),
            "marker_h": max(10, 18 * s),
            "tri_size": max(6, FORTRESS_TRI_SIZE * s),
            "board_left": 0,
            "board_top": 0,
            "green_components": [],
            "green_fit_reliable": False,
            "green_score_fit": False,
            "grid_reliable": True,
            "grid_source": "board_crop",
        }

    sx = w / TOWER_BOARD_W
    sy = h / TOWER_BOARD_H
    s = (sx + sy) / 2.0
    return {
        "mode": "tower",
        "sx": sx,
        "sy": sy,
        "s": s,
        "origin_x": TOWER_GRID_ORIGIN_X * sx,
        "bottom_y": TOWER_GRID_BOTTOM_Y * sy,
        "cell_px": BASE_CELL_PX * s,
        "grid_rows": GRID_ROWS,
        "grid_cols": GRID_COLS,
        "debug_w": DEBUG_RECT_W * s,
        "debug_h": DEBUG_RECT_H * s,
        "template_s": 1.0,
        "marker_dist": 70 * s,
        "marker_w": max(4, 8 * s),
        "marker_h": max(10, 18 * s),
        "tri_size": max(6, FORTRESS_TRI_SIZE * s),
        "board_left": 0,
        "board_top": 0,
        "green_components": [],
        "green_fit_reliable": False,
        "green_score_fit": False,
        "grid_reliable": True,
        "grid_source": "board_crop",
    }


def looks_like_board_crop(img, mode):
    h, w = img.shape[:2]
    if w >= 2600 or h >= 1600:
        return False
    if (mode or "tower").lower() == "fortress":
        return abs((w / h) - (FORTRESS_BOARD_W / FORTRESS_BOARD_H)) < 0.08
    return abs((w / h) - (TOWER_BOARD_W / TOWER_BOARD_H)) < 0.08


def full_grid_params(img, mode="tower"):
    sx, sy, _ = scale_for(img)
    mode = (mode or "tower").lower()

    if looks_like_board_crop(img, mode):
        return board_crop_grid_params(img, mode)

    if mode == "fortress":
        mask = green_mask_for_board(img)
        comps = green_components(mask)
        map_frame = detect_fortress_map_frame(img)
        board_left = FORTRESS_BOARD_LEFT * sx
        board_top = FORTRESS_BOARD_TOP * sy
        cell_px = estimate_cell_px(comps)
        grid_reliable = comps and cell_px is not None
        if grid_reliable:
            s = cell_px / FORTRESS_BASE_CELL_PX
            if map_frame:
                expected_x = map_frame["left"] + FORTRESS_GRID_LEFT_IN_FRAME_FACTOR * map_frame["w"]
                expected_bottom_y = map_frame["bottom"] + FORTRESS_GRID_BOTTOM_IN_FRAME_FACTOR * map_frame["h"]
                anchor_source = "fortress_map_frame"
            else:
                expected_x = board_left + FORTRESS_GRID_LEFT_OFFSET_FACTOR * cell_px
                expected_bottom_y = board_top + FORTRESS_GRID_BOTTOM_OFFSET_FACTOR * cell_px
                anchor_source = "viewport_fallback"
            debug_w = FORTRESS_DEBUG_RECT_W * s
            debug_h = FORTRESS_DEBUG_RECT_H * s
            min_green = max(450, int(1800 * s * s))
            origin_x, bottom_y, score_fit = fit_grid_from_green_scores(
                mask,
                comps,
                cell_px,
                expected_x,
                expected_bottom_y,
                FORTRESS_GRID_COLS,
                FORTRESS_GRID_ROWS,
                debug_w,
                debug_h,
                min_green,
                0.055,
            )
        else:
            origin_x = FORTRESS_FULL_GRID_ORIGIN_X * sx
            bottom_y = FORTRESS_FULL_GRID_BOTTOM_Y * sy
            cell_px = FORTRESS_BASE_CELL_PX * ((sx + sy) / 2.0)
            comps = []
            board_left = FORTRESS_BOARD_LEFT * sx
            board_top = FORTRESS_BOARD_TOP * sy
            score_fit = False
            anchor_source = "viewport_fallback"

        s = cell_px / FORTRESS_BASE_CELL_PX
        return {
            "mode": "fortress",
            "sx": sx,
            "sy": sy,
            "s": s,
            "origin_x": origin_x,
            "bottom_y": bottom_y,
            "cell_px": cell_px,
            "grid_rows": FORTRESS_GRID_ROWS,
            "grid_cols": FORTRESS_GRID_COLS,
            "debug_w": FORTRESS_DEBUG_RECT_W * s,
            "debug_h": FORTRESS_DEBUG_RECT_H * s,
            "template_s": 0.90 * s,
            "marker_dist": 68 * s,
            "marker_w": max(4, 8 * s),
            "marker_h": max(10, 18 * s),
            "tri_size": max(6, FORTRESS_TRI_SIZE * s),
            "board_left": board_left,
            "board_top": board_top,
            "green_components": comps,
            "fortress_map_frame": map_frame,
            "grid_anchor_source": anchor_source,
            "grid_expected_x": float(expected_x) if grid_reliable else float(origin_x),
            "grid_expected_bottom_y": float(expected_bottom_y) if grid_reliable else float(bottom_y),
            "green_fit_reliable": bool(grid_reliable),
            "green_score_fit": bool(score_fit),
            "grid_reliable": True,
        }

    mask = green_mask_for_board(img)
    comps = green_components(mask)
    board_left, board_top = estimate_board_anchor(img)
    cell_px = estimate_cell_px(comps)

    grid_reliable = comps and cell_px is not None
    if grid_reliable:
        origin_x, bottom_y = fit_grid_axis_from_green(comps, cell_px, board_left, board_top)
        s = cell_px / BASE_CELL_PX
        debug_w = DEBUG_RECT_W * s
        debug_h = DEBUG_RECT_H * s
        min_green = max(450, int(1800 * s * s))
        origin_x, bottom_y, score_fit = fit_grid_from_green_scores(
            mask,
            comps,
            cell_px,
            origin_x,
            bottom_y,
            GRID_COLS,
            GRID_ROWS,
            debug_w,
            debug_h,
            min_green,
            0.055,
        )
    else:
        origin_x = FULL_GRID_ORIGIN_X * sx
        bottom_y = FULL_GRID_BOTTOM_Y * sy
        cell_px = BASE_CELL_PX * ((sx + sy) / 2.0)
        score_fit = False

    s = cell_px / BASE_CELL_PX
    return {
        "mode": "tower",
        "sx": sx,
        "sy": sy,
        "s": s,
        "origin_x": origin_x,
        "bottom_y": bottom_y,
        "cell_px": cell_px,
        "grid_rows": GRID_ROWS,
        "grid_cols": GRID_COLS,
        "debug_w": DEBUG_RECT_W * s,
        "debug_h": DEBUG_RECT_H * s,
        "template_s": 1.0,
        "marker_dist": 70 * s,
        "marker_w": max(4, 8 * s),
        "marker_h": max(10, 18 * s),
        "tri_size": max(6, FORTRESS_TRI_SIZE * s),
        "board_left": board_left,
        "board_top": board_top,
        "green_components": comps,
        "green_score_fit": bool(score_fit),
        "grid_reliable": bool(grid_reliable),
    }


def green_score_for_cell(hsv, cx, cy, rect_w, rect_h):
    h, w = hsv.shape[:2]
    x1, y1, x2, y2 = clamp_rect(cx - rect_w / 2, cy - rect_h / 2, cx + rect_w / 2, cy + rect_h / 2, w, h)
    roi = hsv[y1:y2, x1:x2]
    if roi.size == 0:
        return 0, 0.0

    lower = np.array([GREEN_H_MIN, GREEN_S_MIN, GREEN_V_MIN], dtype=np.uint8)
    upper = np.array([GREEN_H_MAX, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(roi, lower, upper)
    green = int(cv2.countNonZero(mask))
    ratio = green / float(mask.size)
    return green, ratio


def green_score_for_cell_mask(green_mask, cx, cy, rect_w, rect_h):
    h, w = green_mask.shape[:2]
    x1, y1, x2, y2 = clamp_rect(cx - rect_w / 2, cy - rect_h / 2, cx + rect_w / 2, cy + rect_h / 2, w, h)
    roi = green_mask[y1:y2, x1:x2]
    if roi.size == 0:
        return 0, 0.0
    green = int(cv2.countNonZero(roi))
    return green, green / float(roi.size)


def clustered_values(values, tolerance):
    return [cluster["value"] for cluster in cluster_candidates(values, tolerance)]


def score_grid_from_green_mask(
    green_mask,
    origin_x,
    bottom_y,
    cell_px,
    rect_w,
    rect_h,
    grid_cols,
    grid_rows,
    min_green,
    min_ratio,
):
    occupied = 0
    total_green = 0
    for row_idx in range(grid_rows):
        for col_idx in range(grid_cols):
            cx, cy = grid_cell_center(col_idx, row_idx, origin_x, bottom_y, cell_px)
            green, ratio = green_score_for_cell_mask(green_mask, cx, cy, rect_w, rect_h)
            if green >= min_green and ratio >= min_ratio:
                occupied += 1
                total_green += green
    return occupied, total_green


def fit_grid_from_green_scores(
    green_mask,
    comps,
    cell_px,
    expected_x,
    expected_bottom_y,
    grid_cols,
    grid_rows,
    rect_w,
    rect_h,
    min_green,
    min_ratio,
):
    if not comps or not cell_px:
        return expected_x, expected_bottom_y, False

    tolerance = max(6.0, cell_px * 0.045)
    search_x_min = expected_x - 4.0 * cell_px
    search_x_max = expected_x + 4.0 * cell_px
    search_y_min = expected_bottom_y - 4.0 * cell_px
    search_y_max = expected_bottom_y + 4.0 * cell_px

    x_candidates = [float(expected_x)]
    y_candidates = [float(expected_bottom_y)]
    for comp in comps:
        for edge in (comp["x"], comp["x2"]):
            for line_idx in range(grid_cols + 1):
                origin = float(edge) - line_idx * cell_px
                if search_x_min <= origin <= search_x_max:
                    x_candidates.append(origin)

        for edge in (comp["y"], comp["y2"]):
            for line_idx in range(grid_rows + 1):
                bottom = float(edge) + line_idx * cell_px
                if search_y_min <= bottom <= search_y_max:
                    y_candidates.append(bottom)

    xs = clustered_values(x_candidates, tolerance)
    ys = clustered_values(y_candidates, tolerance)
    if not xs or not ys:
        return expected_x, expected_bottom_y, False

    best = None
    for ox in xs:
        for by in ys:
            occupied, total_green = score_grid_from_green_mask(
                green_mask,
                ox,
                by,
                cell_px,
                rect_w,
                rect_h,
                grid_cols,
                grid_rows,
                min_green,
                min_ratio,
            )
            dist = abs(ox - expected_x) + abs(by - expected_bottom_y)
            # Prefer exactly five occupied cells. Extra cells are often UI or
            # grid bleed on fortresses, and missing cells block the capture.
            score = (
                min(occupied, EXPECTED_HEROES) * 1_000_000
                - abs(occupied - EXPECTED_HEROES) * 250_000
                + min(total_green, 200_000)
                - dist * 100
            )
            item = (score, occupied, total_green, -dist, ox, by)
            if best is None or item > best:
                best = item

    if best is None:
        return expected_x, expected_bottom_y, False

    return float(best[4]), float(best[5]), True


def corner_triangle_polys(x1, y1, x2, y2, tri_size):
    t = int(round(tri_size))
    return [
        np.array([[x1, y1], [x1 + t, y1], [x1, y1 + t]], dtype=np.int32),
        np.array([[x2, y1], [x2 - t, y1], [x2, y1 + t]], dtype=np.int32),
        np.array([[x1, y2], [x1 + t, y2], [x1, y2 - t]], dtype=np.int32),
        np.array([[x2, y2], [x2 - t, y2], [x2, y2 - t]], dtype=np.int32),
    ]


def green_corner_score_for_cell(hsv, cx, cy, rect_w, rect_h, tri_size):
    h, w = hsv.shape[:2]
    x1, y1, x2, y2 = clamp_rect(cx - rect_w / 2, cy - rect_h / 2, cx + rect_w / 2, cy + rect_h / 2, w, h)
    lower = np.array([GREEN_H_MIN, GREEN_S_MIN, GREEN_V_MIN], dtype=np.uint8)
    upper = np.array([GREEN_H_MAX, 255, 255], dtype=np.uint8)
    green_mask = cv2.inRange(hsv, lower, upper)
    counts = []
    min_pix = max(5, int(round(10 * (tri_size / FORTRESS_TRI_SIZE) ** 2)))
    for poly in corner_triangle_polys(x1, y1, x2, y2, tri_size):
        tri = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(tri, poly, 255)
        counts.append(int(cv2.countNonZero(cv2.bitwise_and(green_mask, tri))))
    return counts, int(sum(counts)), int(sum(1 for value in counts if value >= min_pix))


def select_fortress_cells(cells):
    if len(cells) <= EXPECTED_HEROES:
        return cells

    def score(cell):
        corner_ok = cell.get("green_corner_ok", 0)
        corner_total = cell.get("green_corner_total", 0)
        green = cell.get("green", 0)
        ratio = cell.get("green_ratio", 0.0)
        return (
            ratio,
            green,
            corner_ok,
            corner_total,
        )

    selected = sorted(cells, key=score, reverse=True)[:EXPECTED_HEROES]
    selected_keys = {cell["grid"] for cell in selected}
    for cell in cells:
        cell["rejected_as_phantom"] = cell["grid"] not in selected_keys
    selected.sort(key=lambda c: c["grid"])
    return selected


def detect_occupied_cells(img, params=None):
    if params is None:
        params = full_grid_params(img)
    if not params.get("grid_reliable", True):
        return []
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    s = params["s"]
    min_green = max(450, int(1800 * s * s))
    min_ratio = 0.055
    grid_rows = int(params.get("grid_rows", GRID_ROWS))
    grid_cols = int(params.get("grid_cols", GRID_COLS))

    cells = []
    for row_idx in range(grid_rows):
        for col_idx in range(grid_cols):
            cx, cy = grid_cell_center(
                col_idx,
                row_idx,
                params["origin_x"],
                params["bottom_y"],
                params["cell_px"],
            )
            green, ratio = green_score_for_cell(hsv, cx, cy, params["debug_w"], params["debug_h"])
            if green >= min_green and ratio >= min_ratio:
                corner_counts, corner_total, corner_ok = green_corner_score_for_cell(
                    hsv,
                    cx,
                    cy,
                    params["debug_w"],
                    params["debug_h"],
                    params.get("tri_size", FORTRESS_TRI_SIZE * s),
                )
                cells.append({
                    "grid": grid_label(col_idx, row_idx),
                    "cx": float(cx),
                    "cy": float(cy),
                    "green": green,
                    "green_ratio": ratio,
                    "green_corner_counts": corner_counts,
                    "green_corner_total": corner_total,
                    "green_corner_ok": corner_ok,
                })

    cells.sort(key=lambda c: (-c["green"], c["grid"]))
    params["raw_occupied_cells"] = len(cells)
    if params.get("mode") == "fortress":
        cells = select_fortress_cells(cells)
    return cells


def match_template_masked(zone_gray, template_gray):
    mask = circular_mask_u8(*template_gray.shape)
    try:
        return cv2.matchTemplate(zone_gray, template_gray, cv2.TM_CCORR_NORMED, mask=mask)
    except cv2.error:
        return None


def crop_patch(img, x, y, w, h):
    hh, ww = img.shape[:2]
    x1, y1, x2, y2 = clamp_rect(x, y, x + w, y + h, ww, hh)
    return img[y1:y2, x1:x2]


def detect_best_hero_in_cell(img, heroes_gray, hero_color_sigs, cell, params):
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    s = params["s"]
    template_s = params.get("template_s", s)

    search_w = params["debug_w"] + 2 * CELL_SEARCH_MARGIN * s
    search_h = params["debug_h"] + 2 * CELL_SEARCH_MARGIN * s
    x1, y1, x2, y2 = clamp_rect(
        cell["cx"] - search_w / 2,
        cell["cy"] - search_h / 2,
        cell["cx"] + search_w / 2,
        cell["cy"] + search_h / 2,
        w,
        h,
    )
    zone_gray = gray[y1:y2, x1:x2]
    if zone_gray.size == 0:
        return None

    candidates = []
    for hero_name, tpl_list in heroes_gray.items():
        for tpl in tpl_list:
            th0, tw0 = tpl.shape[:2]
            tw = max(16, int(round(tw0 * template_s)))
            th = max(16, int(round(th0 * template_s)))
            if tw != tw0 or th != th0:
                tpl_s = cv2.resize(tpl, (tw, th), interpolation=cv2.INTER_AREA)
            else:
                tpl_s = tpl

            zh, zw = zone_gray.shape[:2]
            if zh < th or zw < tw:
                continue

            res = match_template_masked(zone_gray, tpl_s)
            if res is None or res.size == 0:
                continue

            _, maxv, _, maxloc = cv2.minMaxLoc(res)
            gray_score = float(maxv)
            if gray_score < 0.58:
                continue

            mx, my = maxloc
            abs_x = x1 + mx
            abs_y = y1 + my
            patch = crop_patch(img, abs_x, abs_y, tw, th)
            color_score = color_similarity(patch, hero_color_sigs[hero_name])
            combined = gray_score + COLOR_WEIGHT * color_score
            candidates.append({
                "champion": hero_name,
                "gray": gray_score,
                "color": color_score,
                "combined": combined,
                "x": float(abs_x),
                "y": float(abs_y),
                "cx": float(abs_x + tw / 2),
                "cy": float(abs_y + th / 2),
                "w": int(tw),
                "h": int(th),
            })

    if not candidates:
        return None

    candidates.sort(key=lambda c: c["combined"], reverse=True)
    best = candidates[0]
    second = candidates[1] if len(candidates) > 1 else None
    margin = best["combined"] - (second["combined"] if second else 0.0)
    best_alias = canonical_hero_margin_name(best["champion"])
    second_alias = canonical_hero_margin_name(second["champion"]) if second else None
    same_alias_second = bool(second and best_alias == second_alias)
    if best_alias != best["champion"]:
        best["matched_champion"] = best["champion"]
        best["champion"] = best_alias
    best["second"] = second["champion"] if second else None
    best["margin"] = float(margin)
    best["alias_margin_accept"] = bool(same_alias_second and margin < MIN_MARGIN)
    best["accepted"] = (
        best["gray"] >= MIN_GRAY
        and best["color"] >= MIN_COLOR
        and best["combined"] >= MIN_COMBINED
        and (best["margin"] >= MIN_MARGIN or same_alias_second)
    )
    return best


def cell_rect_from_grid(img, params, cell):
    parsed = parse_grid_position(cell.get("grid"))
    cp = float(params["cell_px"])
    h, w = img.shape[:2]
    if parsed is None:
        cx = float(cell["cx"])
        cy = float(cell["cy"])
        return clamp_rect(cx - cp / 2, cy - cp / 2, cx + cp / 2, cy + cp / 2, w, h)

    col, row = parsed
    x1 = float(params["origin_x"]) + col * cp
    x2 = float(params["origin_x"]) + (col + 1) * cp
    y1 = float(params["bottom_y"]) - (row + 1) * cp
    y2 = float(params["bottom_y"]) - row * cp
    return clamp_rect(x1, y1, x2, y2, w, h)


def rank_direction_scores(scores):
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_dir, best_score = ranked[0]
    second_dir, second_score = ranked[1]
    margin = int(best_score - second_score)
    ratio = float(margin / max(1, best_score))
    return best_dir, int(best_score), second_dir, int(second_score), margin, ratio


def cell_edge_score_sets(crop):
    if crop is None or crop.size == 0:
        empty = {direction: 0 for direction in DIRECTION_VECTORS}
        return {
            "raw": empty.copy(),
            "near_green": empty.copy(),
            "mixed": empty.copy(),
            "core": empty.copy(),
            "outward": empty.copy(),
            "adjusted": empty.copy(),
        }

    img = cv2.resize(crop, (100, 100), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gold = cv2.inRange(hsv, np.array([16, 35, 105], dtype=np.uint8), np.array([48, 255, 255], dtype=np.uint8))
    bright = cv2.inRange(hsv, np.array([18, 60, 125], dtype=np.uint8), np.array([42, 255, 255], dtype=np.uint8))
    pale_marker = cv2.inRange(hsv, np.array([18, 15, 130], dtype=np.uint8), np.array([55, 155, 255], dtype=np.uint8))
    cream_marker = cv2.inRange(hsv, np.array([15, 5, 145], dtype=np.uint8), np.array([55, 130, 255], dtype=np.uint8))
    bright_cream_marker = cv2.inRange(hsv, np.array([18, 10, 165], dtype=np.uint8), np.array([50, 115, 255], dtype=np.uint8))
    green = cv2.inRange(hsv, np.array([45, 70, 80], dtype=np.uint8), np.array([95, 255, 255], dtype=np.uint8))
    green_near = cv2.dilate(green, np.ones((9, 9), dtype=np.uint8), iterations=1)
    gold_near_green = cv2.bitwise_and(gold, green_near)
    bright_near_green = cv2.bitwise_and(bright, green_near)
    marker = cv2.bitwise_or(gold, bright)

    bands = {
        "N": np.s_[0:28, 25:75],
        "S": np.s_[72:100, 25:75],
        "E": np.s_[25:75, 72:100],
        "O": np.s_[25:75, 0:28],
    }
    raw_scores = {}
    near_scores = {}
    mixed_scores = {}
    core_scores = {}
    outward_scores = {}
    adjusted_scores = {}
    for direction, region in bands.items():
        raw = int(cv2.countNonZero(gold[region])) + 2 * int(cv2.countNonZero(bright[region]))
        near = int(cv2.countNonZero(gold_near_green[region])) + 2 * int(cv2.countNonZero(bright_near_green[region]))
        core = (
            int(cv2.countNonZero(pale_marker[region]))
            + int(cv2.countNonZero(cream_marker[region]))
            + 2 * int(cv2.countNonZero(bright_cream_marker[region]))
        )
        marker_band = marker[region]
        yy, xx = np.where(marker_band > 0)
        if len(xx) == 0:
            outward = 0
        elif direction == "E":
            bw = marker_band.shape[1]
            outward = int(np.count_nonzero(xx >= bw * 0.55) - np.count_nonzero(xx <= bw * 0.45))
        elif direction == "O":
            bw = marker_band.shape[1]
            outward = int(np.count_nonzero(xx <= bw * 0.45) - np.count_nonzero(xx >= bw * 0.55))
        elif direction == "S":
            bh = marker_band.shape[0]
            outward = int(np.count_nonzero(yy >= bh * 0.55) - np.count_nonzero(yy <= bh * 0.45))
        else:
            bh = marker_band.shape[0]
            outward = int(np.count_nonzero(yy <= bh * 0.45) - np.count_nonzero(yy >= bh * 0.55))

        raw_scores[direction] = raw
        near_scores[direction] = near
        mixed_scores[direction] = int(round(near + 0.25 * raw))
        core_scores[direction] = core
        outward_scores[direction] = outward
        adjusted_scores[direction] = int(round(mixed_scores[direction] + CELL_EDGE_OUTWARD_WEIGHT * outward))

    return {
        "raw": raw_scores,
        "near_green": near_scores,
        "mixed": mixed_scores,
        "core": core_scores,
        "outward": outward_scores,
        "adjusted": adjusted_scores,
    }


def choose_cell_edge_direction(score_sets):
    raw_scores = score_sets["raw"]
    near_scores = score_sets["near_green"]
    mixed_scores = score_sets["mixed"]
    core_scores = score_sets["core"]
    adjusted_scores = score_sets["adjusted"]

    raw_best, raw_score, _, _, raw_margin, raw_ratio = rank_direction_scores(raw_scores)
    mixed_best, mixed_score, _, _, mixed_margin, mixed_ratio = rank_direction_scores(mixed_scores)
    near_best, near_score, _, _, near_margin, near_ratio = rank_direction_scores(near_scores)
    core_best, core_score, _, _, core_margin, core_ratio = rank_direction_scores(core_scores)
    adjusted_best, adjusted_score, _, _, adjusted_margin, adjusted_ratio = rank_direction_scores(adjusted_scores)

    if max(raw_score, mixed_score, near_score, core_score, adjusted_score) < CELL_EDGE_MIN_MARKER_SCORE:
        return "unknown", mixed_scores, max(raw_margin, mixed_margin, near_margin, adjusted_margin), "cell_edge_marker_too_weak", "mixed"

    if core_score >= CELL_EDGE_CORE_MARKER_SCORE and core_ratio >= CELL_EDGE_CORE_RATIO and core_margin >= CELL_EDGE_CORE_MARGIN:
        return core_best, core_scores, core_margin, "cell_edge_core_marker", "core"

    if adjusted_score >= CELL_EDGE_MIN_MARKER_SCORE and adjusted_ratio >= CELL_EDGE_OUTWARD_RATIO and adjusted_margin >= CELL_EDGE_OUTWARD_MARGIN:
        return adjusted_best, adjusted_scores, adjusted_margin, "cell_edge_outward_marker", "adjusted"

    if raw_ratio >= CELL_EDGE_RAW_TRUST_RATIO and raw_margin >= CELL_EDGE_RAW_TRUST_MARGIN:
        return raw_best, raw_scores, raw_margin, "cell_edge_raw_marker", "raw"

    if mixed_ratio >= CELL_EDGE_ARBITER_RATIO and mixed_margin >= CELL_EDGE_ARBITER_MARGIN:
        return mixed_best, mixed_scores, mixed_margin, "cell_edge_green_arbiter", "mixed"

    if near_ratio >= CELL_EDGE_ARBITER_RATIO and near_margin >= CELL_EDGE_ARBITER_MARGIN:
        return near_best, near_scores, near_margin, "cell_edge_green_marker", "near_green"

    return "unknown", mixed_scores, max(raw_margin, mixed_margin, near_margin), "cell_edge_ambiguous", "mixed"


def detect_direction(img, hero, params, cell):
    x1, y1, x2, y2 = cell_rect_from_grid(img, params, cell)
    crop = img[y1:y2, x1:x2]
    score_sets = cell_edge_score_sets(crop)
    marker = detect_cell_arrow(img, (x1, y1, x2, y2))
    best_dir = marker["direction"]
    selected_scores = {direction: int(round(score * 1000)) for direction, score in marker["scores"].items()}
    margin = int(round(marker["margin"] * 1000))
    reason = marker["reason"]
    strategy = "arrow_shape"
    raw_margin = int(rank_direction_scores(score_sets["raw"])[4])
    near_green_margin = int(rank_direction_scores(score_sets["near_green"])[4])
    mixed_margin = int(rank_direction_scores(score_sets["mixed"])[4])
    core_margin = int(rank_direction_scores(score_sets["core"])[4])
    adjusted_margin = int(rank_direction_scores(score_sets["adjusted"])[4])
    scores = dict(selected_scores)
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_score = ranked[0][1]
    second_score = ranked[1][1]

    scores["_chosen"] = best_dir
    scores["_reason"] = reason
    scores["_cell_local_direction"] = True
    scores["_strategy"] = strategy
    scores["_raw"] = score_sets["raw"]
    scores["_near_green"] = score_sets["near_green"]
    scores["_mixed"] = score_sets["mixed"]
    scores["_core"] = score_sets["core"]
    scores["_outward"] = score_sets["outward"]
    scores["_adjusted"] = score_sets["adjusted"]
    scores["_edge_margin"] = int(margin)
    scores["_edge_best_score"] = int(best_score)
    scores["_edge_second_score"] = int(second_score)
    scores["_cell_rect"] = [int(x1), int(y1), int(x2), int(y2)]
    scores["_raw_margin"] = raw_margin
    scores["_near_green_margin"] = near_green_margin
    scores["_mixed_margin"] = mixed_margin
    scores["_core_margin"] = core_margin
    scores["_adjusted_margin"] = adjusted_margin
    scores["_yellow_margin"] = int(margin)
    scores["_yellow_min_margin"] = int(round(ARROW_MIN_MARGIN * 1000))
    scores["_yellow_min_count"] = int(round(ARROW_MIN_SCORE * 1000))
    scores["_arrow_candidates"] = marker["candidates"]
    scores["_candidates"] = []
    return best_dir, scores


def parse_grid_position(position):
    m = re.match(r"^([A-Z])(\d+)$", position or "")
    if not m:
        return None
    row = ord(m.group(1)) - ord("A")
    col = int(m.group(2)) - 1
    return col, row


def neighbor_position(position, direction):
    parsed = parse_grid_position(position)
    if parsed is None:
        return None
    col, row = parsed
    if direction == "N":
        row += 1
    elif direction == "S":
        row -= 1
    elif direction == "E":
        col += 1
    elif direction == "O":
        col -= 1
    if row < 0 or col < 0:
        return None
    return grid_label(col, row)


def best_candidate_by_direction(direction_scores):
    by_dir = {}
    for cand in direction_scores.get("_candidates", []):
        direction = cand.get("direction")
        if direction not in DIRECTION_VECTORS:
            continue
        if direction not in by_dir or cand.get("score", 0.0) > by_dir[direction].get("score", 0.0):
            by_dir[direction] = cand
    return by_dir


def candidate_is_usable(cand):
    if not cand:
        return False
    if not cand.get("rejected"):
        return True
    # A valid marker can sit over the green square edge and be rejected by the
    # background-green guard. Keep it usable only when the triangle itself is
    # still clean; this catches overlaps without reviving noisy false positives.
    return (
        cand.get("score", 0.0) >= 0.72
        and cand.get("hole_score", 0.0) >= 0.62
        and cand.get("outline_score", 0.0) >= 0.65
        and cand.get("bg_green_ratio", 1.0) <= 0.52
    )


def direction_evidence(item):
    scores = item.get("direction_scores", {})
    yellow = {d: int(scores.get(d, 0)) for d in DIRECTION_VECTORS}
    yellow_best = max(yellow.values()) if yellow else 0
    yellow_best = max(1, yellow_best)
    candidates = best_candidate_by_direction(scores)
    usable_scores = [
        cand.get("score", 0.0)
        for cand in candidates.values()
        if candidate_is_usable(cand)
    ]
    best_usable = max(usable_scores) if usable_scores else 1.0

    evidence = {}
    for direction in DIRECTION_VECTORS:
        cand = candidates.get(direction)
        usable = candidate_is_usable(cand)
        cand_score = cand.get("score", 0.0) if cand and usable else 0.0
        local = 0.72 * (yellow[direction] / yellow_best) + 0.28 * (cand_score / max(0.001, best_usable))
        if usable:
            local += 0.08
        elif cand is not None:
            local -= 0.15
        evidence[direction] = {
            "yellow": yellow[direction],
            "yellow_ratio": yellow[direction] / yellow_best,
            "candidate": cand,
            "candidate_usable": usable,
            "candidate_score": cand_score,
            "local": float(local),
        }
    return evidence


def neighbor_has_strong_opposite(neighbor_item, direction, neighbor_direction=None):
    if neighbor_direction is None:
        neighbor_direction = neighbor_item.get("direction", "unknown")
    if neighbor_direction in DIRECTION_VECTORS and neighbor_direction != direction:
        return False

    evidence = direction_evidence(neighbor_item)
    info = evidence.get(direction, {})
    if neighbor_direction == "unknown":
        scores = neighbor_item.get("direction_scores", {})
        yellow = {d: int(scores.get(d, 0)) for d in DIRECTION_VECTORS}
        yellow_rank = sorted(yellow.items(), key=lambda kv: kv[1], reverse=True)
        if not yellow_rank or yellow_rank[0][0] != direction:
            return False
        return (
            info.get("yellow_ratio", 0.0) >= 0.82
            and info.get("candidate_usable", False)
        )
    return (
        info.get("yellow_ratio", 0.0) >= 0.70
        and (
            info.get("candidate_usable", False)
            or info.get("yellow", 0) >= int(neighbor_item.get("direction_scores", {}).get("_yellow_min_count", 45))
        )
    )


def resolve_direction_conflicts(found):
    if all(item.get("direction_scores", {}).get("_cell_local_direction") for item in found):
        return

    by_position = {item["position"]: item for item in found}
    initial_direction_by_position = {
        item["position"]: item.get("direction", "unknown")
        for item in found
    }
    for item in found:
        current = item.get("direction", "unknown")
        scores = item.get("direction_scores", {})
        current_is_dirty = current == "unknown"

        evidence = direction_evidence(item)
        resolved_scores = {}
        contaminated = []
        for direction, info in evidence.items():
            score = info["local"]
            neigh_pos = neighbor_position(item["position"], direction)
            neighbor = by_position.get(neigh_pos)
            if neighbor is not None:
                opposite = OPPOSITE_DIRECTION[direction]
                if neighbor_has_strong_opposite(
                    neighbor,
                    opposite,
                    initial_direction_by_position.get(neigh_pos),
                ):
                    score -= 0.46
                    contaminated.append(direction)
            if info["yellow"] < scores.get("_yellow_min_count", 45) and not info["candidate_usable"]:
                score -= 0.25
            resolved_scores[direction] = score

        current_is_neighbor_contaminated = current in contaminated
        if not current_is_dirty and not current_is_neighbor_contaminated:
            continue

        if current_is_neighbor_contaminated and current in DIRECTION_VECTORS:
            current_info = evidence.get(current, {})
            yellow_best = max(
                int(scores.get(direction, 0))
                for direction in DIRECTION_VECTORS
            )
            strong_margin = max(
                int(scores.get("_yellow_min_margin", 28)) * 2,
                int(round(yellow_best * 0.50)),
            )
            if (
                current_info.get("yellow_ratio", 0.0) >= 0.94
                and int(scores.get("_yellow_margin", 0)) >= strong_margin
            ):
                scores["_resolved_scores"] = {k: round(float(v), 4) for k, v in resolved_scores.items()}
                scores["_contaminated_by_neighbor"] = contaminated
                scores["_reason"] = "yellow_marker_strong_with_neighbor"
                continue

            alt_rank = sorted(
                (
                    (direction, score)
                    for direction, score in resolved_scores.items()
                    if direction != current
                    and direction not in contaminated
                    and evidence[direction]["yellow"] >= scores.get("_yellow_min_count", 45)
                    and evidence[direction]["yellow_ratio"] >= 0.45
                ),
                key=lambda kv: kv[1],
                reverse=True,
            )
            if alt_rank:
                alt_rank_all = sorted(
                    (
                        (direction, score)
                        for direction, score in resolved_scores.items()
                        if direction != current
                        and direction not in contaminated
                    ),
                    key=lambda kv: kv[1],
                    reverse=True,
                )
                best_dir, best_score = alt_rank[0]
                second_score = next(
                    (
                        score
                        for direction, score in alt_rank_all
                        if direction != best_dir
                    ),
                    -999.0,
                )
                current_score = resolved_scores.get(current, -999.0)
                if (
                    best_score - second_score >= 0.16
                    and best_score - current_score >= 0.16
                    and (
                        evidence[best_dir]["candidate_usable"]
                        or evidence[best_dir]["yellow_ratio"] >= 0.62
                    )
                ):
                    item["direction"] = best_dir
                    scores["_chosen"] = best_dir
                    scores["_reason"] = "neighbor_overlap_resolved_strict"
                    scores["_resolved_scores"] = {k: round(float(v), 4) for k, v in resolved_scores.items()}
                    scores["_contaminated_by_neighbor"] = contaminated
                    continue

        item["direction"] = "unknown"
        scores["_chosen"] = "unknown"
        scores["_reason"] = (
            "neighbor_overlap_ambiguous"
            if current_is_neighbor_contaminated
            else "direction_evidence_ambiguous"
        )
        scores["_resolved_scores"] = {k: round(float(v), 4) for k, v in resolved_scores.items()}
        scores["_contaminated_by_neighbor"] = contaminated


def draw_debug(img, params, cells, found):
    dbg = img.copy()

    ox = params["origin_x"]
    by = params["bottom_y"]
    cp = params["cell_px"]
    grid_rows = int(params.get("grid_rows", GRID_ROWS))
    grid_cols = int(params.get("grid_cols", GRID_COLS))

    frame = params.get("fortress_map_frame")
    if frame:
        x1 = int(round(frame["left"]))
        y1 = int(round(frame["top"]))
        x2 = int(round(frame["right"]))
        y2 = int(round(frame["bottom"]))
        cv2.rectangle(dbg, (x1, y1), (x2, y2), (0, 180, 255), 3)
        cv2.putText(
            dbg,
            f"map frame {params.get('grid_anchor_source', '')}",
            (x1, max(20, y1 - 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (0, 180, 255),
            2,
            cv2.LINE_AA,
        )

    for col in range(grid_cols + 1):
        x = int(round(ox + col * cp))
        y1 = int(round(by - grid_rows * cp))
        y2 = int(round(by))
        cv2.line(dbg, (x, y1), (x, y2), (255, 0, 255), 1)

    for row in range(grid_rows + 1):
        y = int(round(by - row * cp))
        x1 = int(round(ox))
        x2 = int(round(ox + grid_cols * cp))
        cv2.line(dbg, (x1, y), (x2, y), (255, 0, 255), 1)

    for cell in cells:
        cx = int(round(cell["cx"]))
        cy = int(round(cell["cy"]))
        rw = int(round(params["debug_w"]))
        rh = int(round(params["debug_h"]))
        cv2.rectangle(dbg, (cx - rw // 2, cy - rh // 2), (cx + rw // 2, cy + rh // 2), (0, 255, 255), 2)
        cv2.putText(dbg, cell["grid"], (cx - rw // 2, cy - rh // 2 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2, cv2.LINE_AA)

    for item in found:
        hero = item["hero"]
        x1 = int(round(hero["x"]))
        y1 = int(round(hero["y"]))
        x2 = int(round(hero["x"] + hero["w"]))
        y2 = int(round(hero["y"] + hero["h"]))
        color = (0, 220, 0) if hero["accepted"] else (0, 0, 255)
        cv2.rectangle(dbg, (x1, y1), (x2, y2), color, 3)
        cx = int(round(hero["cx"]))
        cy = int(round(hero["cy"]))
        axis_len = int(round(max(hero["w"], hero["h"]) * 0.62))
        cv2.line(dbg, (cx - axis_len, cy), (cx + axis_len, cy), (255, 255, 0), 1)
        cv2.line(dbg, (cx, cy - axis_len), (cx, cy + axis_len), (255, 255, 0), 1)
        for cand in item.get("direction_scores", {}).get("_candidates", []):
            bx, by, bw, bh = cand["box"]
            cand_color = (0, 180, 255) if cand["rejected"] else (255, 255, 0)
            cv2.rectangle(dbg, (bx, by), (bx + bw, by + bh), cand_color, 2)
            triangle = cand.get("triangle") or []
            if len(triangle) == 3:
                pts = np.array([[int(round(p[0])), int(round(p[1]))] for p in triangle], dtype=np.int32)
                cv2.polylines(dbg, [pts], True, cand_color, 2)
            if cand.get("apex") and cand.get("base_mid"):
                ax, ay = cand["apex"]
                bxm, bym = cand["base_mid"]
                cv2.arrowedLine(
                    dbg,
                    (int(round(bxm)), int(round(bym))),
                    (int(round(ax)), int(round(ay))),
                    cand_color,
                    2,
                    tipLength=0.35,
                )
        label = f"{hero['champion']}@{item['position']}:{item['direction']} {hero['combined']:.3f}"
        cv2.putText(dbg, label, (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2, cv2.LINE_AA)

    return dbg


def mode_from_filename(path: Path):
    return "fortress" if "fortress" in path.stem.lower() else "tower"


def analyze_image(path: Path, heroes_gray, hero_color_sigs, debug_dir=None):
    img = read_img(path)
    if img is None:
        return {"file": path.name, "path": str(path), "error": "image_read_failed", "reco_ok": False}

    mode = mode_from_filename(path)
    params = full_grid_params(img, mode)
    cells = detect_occupied_cells(img, params)
    found = []
    issues = []

    for cell in cells:
        hero = detect_best_hero_in_cell(img, heroes_gray, hero_color_sigs, cell, params)
        if hero is None:
            issues.append(f"{cell['grid']}:no_hero_match")
            continue
        direction, direction_scores = detect_direction(img, hero, params, cell)
        found.append({
            "position": cell["grid"],
            "cell": cell,
            "direction": direction,
            "direction_scores": direction_scores,
            "hero": hero,
        })
        if not hero["accepted"]:
            issues.append(f"{cell['grid']}:{hero['champion']}:low_confidence")
        if direction == "unknown":
            issues.append(f"{cell['grid']}:{hero['champion']}:direction_unknown")

    resolve_direction_conflicts(found)
    issues = [
        issue for issue in issues
        if not (
            issue.endswith(":direction_unknown")
            and any(
                issue == f"{f['position']}:{f['hero']['champion']}:direction_unknown"
                and f["direction"] != "unknown"
                for f in found
            )
        )
    ]
    for f in found:
        if f["direction"] == "unknown":
            issue = f"{f['position']}:{f['hero']['champion']}:direction_unknown"
            if issue not in issues:
                issues.append(issue)

    accepted = [f for f in found if f["hero"]["accepted"]]
    accepted.sort(key=lambda f: f["position"])
    unknown_dirs = [f for f in accepted if f["direction"] == "unknown"]
    reco_ok = len(accepted) == EXPECTED_HEROES and not unknown_dirs
    if len(cells) != EXPECTED_HEROES:
        issues.append(f"occupied_cells:{len(cells)}/{EXPECTED_HEROES}")
    if len(accepted) != EXPECTED_HEROES:
        issues.append(f"accepted_heroes:{len(accepted)}/{EXPECTED_HEROES}")

    compo = [
        {
            "champion": f["hero"]["champion"],
            "position": f["position"],
            "direction": f["direction"],
            "gray": round(f["hero"]["gray"], 4),
            "color": round(f["hero"]["color"], 4),
            "combined": round(f["hero"]["combined"], 4),
            "margin": round(f["hero"]["margin"], 4),
            "second": f["hero"]["second"],
            "direction_reason": f["direction_scores"].get("_reason"),
            "direction_yellow_scores": {
                d: int(f["direction_scores"].get(d, 0))
                for d in DIRECTION_VECTORS
            },
            "direction_yellow_margin": f["direction_scores"].get("_yellow_margin"),
            "direction_yellow_min_margin": f["direction_scores"].get("_yellow_min_margin"),
            "direction_candidates": f["direction_scores"].get("_candidates", [])[:6],
        }
        for f in accepted
    ]

    def_id = path.stem
    key = None
    if reco_ok:
        key = def_id + "|" + "|".join(f"{c['position']}:{c['champion']}:{c['direction']}" for c in compo)

    debug_path = ""
    if debug_dir is not None:
        debug_dir.mkdir(parents=True, exist_ok=True)
        dbg = draw_debug(img, params, cells, found)
        debug_path = str(debug_dir / f"{path.stem}_debug.png")
        cv2.imwrite(debug_path, dbg)

    return {
        "def": def_id,
        "file": path.name,
        "path": str(path),
        "image_size": {"w": int(img.shape[1]), "h": int(img.shape[0])},
        "grid_params": {
            "mode": params["mode"],
            "origin_x": round(params["origin_x"], 2),
            "bottom_y": round(params["bottom_y"], 2),
            "cell_px": round(params["cell_px"], 2),
            "grid_rows": params["grid_rows"],
            "grid_cols": params["grid_cols"],
            "scale": round(params["s"], 4),
            "template_scale": round(params.get("template_s", params["s"]), 4),
            "board_left": round(params["board_left"], 2),
            "board_top": round(params["board_top"], 2),
            "grid_reliable": params["grid_reliable"],
            "green_fit_reliable": params.get("green_fit_reliable"),
            "green_score_fit": params.get("green_score_fit"),
            "raw_occupied_cells": params.get("raw_occupied_cells"),
            "green_components": params["green_components"],
        },
        "occupied_cells": len(cells),
        "heroes_found": len(accepted),
        "expected_heroes": EXPECTED_HEROES,
        "reco_ok": reco_ok,
        "skip_post": not reco_ok,
        "issues": issues,
        "compo": compo,
        "def_key": key,
        "def_key_sha1": sha1(key) if key else None,
        "debug_path": debug_path,
    }


def min_reco_issue(item):
    if item.get("reco_ok"):
        return None
    if item.get("error"):
        return item.get("error")
    issues = item.get("issues") or []
    return ";".join(str(issue) for issue in issues) if issues else "reco_failed"


def to_min_result(item):
    grid_params = item.get("grid_params") or {}
    mode = grid_params.get("mode") or mode_from_filename(Path(item.get("file", item.get("def", ""))))
    compo = [
        {
            "champion": normalize_champion_id(c.get("champion", "")),
            "position": c.get("position"),
            "direction": c.get("direction"),
        }
        for c in item.get("compo", [])
    ]

    key = None
    if item.get("reco_ok"):
        key = item.get("def", "") + "|" + "|".join(
            f"{c['position']}:{c['champion']}:{c['direction']}"
            for c in compo
        )

    cell_px = grid_params.get("cell_px")
    if cell_px is None:
        cell_px = FORTRESS_BASE_CELL_PX if mode == "fortress" else BASE_CELL_PX

    return {
        "def": item.get("def"),
        "file": item.get("file"),
        "path": item.get("path"),
        "mode": mode,
        "grid_rows": grid_params.get("grid_rows", FORTRESS_GRID_ROWS if mode == "fortress" else GRID_ROWS),
        "left_crop_px": 0,
        "cell_px": int(round(float(cell_px))),
        "heroes_found": item.get("heroes_found", 0),
        "expected_heroes": item.get("expected_heroes", EXPECTED_HEROES),
        "reco_ok": bool(item.get("reco_ok")),
        "skip_post": bool(item.get("skip_post", not item.get("reco_ok"))),
        "reco_issue": min_reco_issue(item),
        "compo": compo,
        "def_key": key,
        "def_key_sha1": sha1(key) if key else None,
        "debug_path": item.get("debug_path", ""),
    }


def print_ready(path: Path, min_cells: int, mode: str):
    img = read_img(path)
    if img is None:
        print(json.dumps({"ready": False, "error": "image_read_failed"}))
        return
    params = full_grid_params(img, mode)
    cells = detect_occupied_cells(img, params)
    print(json.dumps({
        "ready": len(cells) >= min_cells,
        "cells": len(cells),
        "min_cells": min_cells,
        "mode": params["mode"],
        "positions": [c["grid"] for c in cells],
        "grid": {
            "origin_x": round(params["origin_x"], 2),
            "bottom_y": round(params["bottom_y"], 2),
            "cell_px": round(params["cell_px"], 2),
            "grid_rows": params["grid_rows"],
            "grid_cols": params["grid_cols"],
            "scale": round(params["s"], 4),
            "template_scale": round(params.get("template_s", params["s"]), 4),
            "grid_reliable": params["grid_reliable"],
            "green_fit_reliable": params.get("green_fit_reliable"),
            "green_score_fit": params.get("green_score_fit"),
            "raw_occupied_cells": params.get("raw_occupied_cells"),
        },
    }, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ready", help="Return JSON readiness for one full normalized screenshot")
    parser.add_argument("--min-cells", type=int, default=3)
    parser.add_argument("--mode", choices=("tower", "fortress"), default="tower")
    parser.add_argument("--screens-dir")
    parser.add_argument("--output")
    parser.add_argument("--min-output")
    parser.add_argument("--debug-dir")
    args = parser.parse_args()

    if args.ready:
        print_ready(Path(args.ready), args.min_cells, args.mode)
        return

    if not args.screens_dir or not args.output:
        raise SystemExit("--screens-dir and --output are required unless --ready is used")

    screens_dir = Path(args.screens_dir)
    output = Path(args.output)
    min_output = Path(args.min_output) if args.min_output else output.with_name(f"{output.stem}_min{output.suffix}")
    debug_dir = Path(args.debug_dir) if args.debug_dir else screens_dir / "debug"

    heroes_gray, hero_color_sigs = load_hero_templates()
    files = sorted(
        p for p in screens_dir.glob("*.png")
        if p.name.lower().startswith("bastion_")
        and "_team_" in p.name.lower()
        and "_debug" not in p.name.lower()
    )

    results = [analyze_image(p, heroes_gray, hero_color_sigs, debug_dir) for p in files]

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    min_results = [to_min_result(item) for item in results]
    min_output.parent.mkdir(parents=True, exist_ok=True)
    with min_output.open("w", encoding="utf-8") as f:
        json.dump(min_results, f, ensure_ascii=False, indent=2)

    ok = sum(1 for r in results if r.get("reco_ok"))
    print(f"[probe] captures={len(results)} ok={ok}/{len(results)}")
    print(f"[probe] output={output}")
    print(f"[probe] min_output={min_output}")
    print(f"[probe] debug={debug_dir}")


if __name__ == "__main__":
    main()
