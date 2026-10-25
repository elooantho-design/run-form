"""Read the hollow direction pointer, not the portrait's gold colour density."""

from functools import lru_cache

import cv2
import numpy as np


DIRECTIONS = ("E", "N", "O", "S")
MIN_SCORE = 0.72
MIN_MARGIN = 0.08


@lru_cache(maxsize=1)
def pointer_masks():
    masks = []
    for length in (10, 13, 16, 19):
        for height in (18, 22, 26, 30):
            pad = 3
            shape = (height + pad * 2 + 1, length + pad * 2 + 1)
            cy = pad + height / 2
            outer = np.zeros(shape, np.uint8)
            hole = np.zeros(shape, np.uint8)
            cv2.fillConvexPoly(outer, np.array([[pad, pad], [pad, pad + height], [pad + length, round(cy)]], np.int32), 1)
            cv2.fillConvexPoly(hole, np.array([
                [round(pad + length * .10), round(cy - height * .15)],
                [round(pad + length * .10), round(cy + height * .15)],
                [round(pad + length * .55), round(cy)],
            ], np.int32), 1)
            rim = outer - hole
            rim[:, :pad + round(length * .15)] = 0
            outside = cv2.dilate(outer, np.ones((5, 5), np.uint8)) - outer
            outside[:, :pad + round(length * .5)] = 0
            masks.append((rim.astype(np.float32), hole.astype(np.float32), outside.astype(np.float32), pad + length, cy))
    return masks


def masked_mean(signal, mask):
    return np.clip(cv2.matchTemplate(signal, mask, cv2.TM_CCORR) / max(1, float(mask.sum())), 0, 1)


def extract_cell_context(image, rect):
    x1, y1, x2, y2 = map(float, rect)
    if x2 <= x1 or y2 <= y1:
        return None
    # The centre 100x100 pixels represent the cell; retain ten pixels of context.
    xs = np.linspace(x1 - .1 * (x2-x1), x2 + .1 * (x2-x1), 120, endpoint=False, dtype=np.float32)
    ys = np.linspace(y1 - .1 * (y2-y1), y2 + .1 * (y2-y1), 120, endpoint=False, dtype=np.float32)
    xx, yy = np.meshgrid(xs, ys)
    return cv2.remap(image, xx, yy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def inspect_pointer(context):
    if context is None or context.shape[:2] != (120, 120):
        return {"direction": "unknown", "reason": "arrow_invalid_context", "scores": {d: 0.0 for d in DIRECTIONS}, "margin": 0.0, "candidates": []}
    candidates = []
    for turns, direction in enumerate(DIRECTIONS):
        oriented = np.ascontiguousarray(np.rot90(context, -turns))
        hsv = cv2.cvtColor(oriented, cv2.COLOR_BGR2HSV)
        hue, saturation, value = cv2.split(hsv)
        cream = (((hue >= 15) & (hue <= 55) & (saturation <= 180) & (value >= 210)) | ((saturation < 25) & (value >= 220))).astype(np.float32)
        green = ((hue >= 45) & (hue <= 95) & (saturation >= 70) & (value >= 80)).astype(np.float32)
        hollow = ((cream == 0) & (green == 0) & (value < 220)).astype(np.float32)
        best = None
        for rim, hole, outside, tip_x, tip_y in pointer_masks():
            rim_score = masked_mean(cream, rim)
            hole_score = masked_mean(hollow, hole)
            background_score = masked_mean(1.0 - cream, outside)
            yy, xx = np.indices(rim_score.shape)
            tip_distance = xx + tip_x - 60
            tangent_distance = abs(yy + tip_y - 60)
            eligible = (tip_distance >= 43) & (tip_distance <= 55) & (tangent_distance <= 10)
            eligible &= (rim_score >= .55) & (hole_score >= .45) & (background_score >= .55)
            score = .55 * rim_score + .25 * hole_score + .20 * background_score
            score = np.where(eligible, score, -1)
            y, x = np.unravel_index(np.argmax(score), score.shape)
            if score[y, x] < 0:
                continue
            item = {
                "direction": direction, "score": float(score[y, x]),
                "rim": float(rim_score[y, x]), "hole": float(hole_score[y, x]),
                "background": float(background_score[y, x]),
                "tip_distance": float(tip_distance[y, x]), "tangent_distance": float(tangent_distance[y, x]),
            }
            if best is None or item["score"] > best["score"]:
                best = item
        candidates.append(best or {"direction": direction, "score": 0.0})
    candidates.sort(key=lambda item: item["score"], reverse=True)
    margin = candidates[0]["score"] - candidates[1]["score"]
    confident = candidates[0]["score"] >= MIN_SCORE and margin >= MIN_MARGIN
    return {
        "direction": candidates[0]["direction"] if confident else "unknown",
        "reason": "cell_arrow_shape" if confident else "cell_arrow_ambiguous",
        "scores": {item["direction"]: item["score"] for item in candidates},
        "margin": margin, "candidates": candidates,
    }


def detect_cell_arrow(image, rect):
    return inspect_pointer(extract_cell_context(image, rect))
