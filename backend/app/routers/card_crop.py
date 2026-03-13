from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import base64
import cv2
import numpy as np

router = APIRouter(prefix="/card", tags=["card"])
DETECT_MIN_SCORE = 80.0


class CropPoint(BaseModel):
    x: float
    y: float


class CropRequest(BaseModel):
    image: str
    points: List[CropPoint]


class DetectRequest(BaseModel):
    image: str


def _order_points(pts: np.ndarray) -> np.ndarray:
    if pts.shape != (4, 2):
        raise ValueError("points must be 4x2")
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # top-left
    rect[2] = pts[np.argmax(s)]  # bottom-right
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # top-right
    rect[3] = pts[np.argmax(diff)]  # bottom-left
    return rect


def _is_valid_card_shape(pts: np.ndarray, image_area: int, image_w: int, image_h: int) -> bool:
    if pts.shape != (4, 2):
        return False
    ordered = _order_points(pts.copy())
    area = float(abs(cv2.contourArea(ordered.astype(np.float32))))
    if area <= 0:
        return False

    area_ratio = area / float(image_area)
    if not (0.02 <= area_ratio <= 0.95):
        return False

    w1 = float(np.linalg.norm(ordered[1] - ordered[0]))
    w2 = float(np.linalg.norm(ordered[2] - ordered[3]))
    h1 = float(np.linalg.norm(ordered[2] - ordered[1]))
    h2 = float(np.linalg.norm(ordered[3] - ordered[0]))
    width = max(w1, w2)
    height = max(h1, h2)
    if width <= 1 or height <= 1:
        return False

    aspect = width / height
    if not (0.3 <= aspect <= 4.5):
        return False

    min_x = float(np.min(ordered[:, 0]))
    max_x = float(np.max(ordered[:, 0]))
    min_y = float(np.min(ordered[:, 1]))
    max_y = float(np.max(ordered[:, 1]))

    # 全体フレームと一致しやすい矩形は除外（誤検出防止）
    edge_margin_x = image_w * 0.02
    edge_margin_y = image_h * 0.02

    return (
        min_x > edge_margin_x
        and max_x < image_w - edge_margin_x
        and min_y > edge_margin_y
        and max_y < image_h - edge_margin_y
    )


def _candidate_score(pts: np.ndarray, image_area: int) -> float:
    ordered = _order_points(pts.copy())
    area = abs(cv2.contourArea(ordered.astype(np.float32)))
    perimeter = cv2.arcLength(ordered.astype(np.float32), True)
    if perimeter <= 0 or area <= 0:
        return 0.0

    area_ratio = area / float(image_area)
    widths = [float(np.linalg.norm(ordered[1] - ordered[0])), float(np.linalg.norm(ordered[2] - ordered[3]))]
    heights = [float(np.linalg.norm(ordered[2] - ordered[1])), float(np.linalg.norm(ordered[3] - ordered[0]))]
    width = max(widths)
    height = max(heights)
    if width <= 0 or height <= 0:
        return 0.0

    # 名刺の縦横比(横1.6 or 縦1/1.6)に寄せる
    aspect = width / height
    target_h = 1.6
    score_h = 1.0 - abs(np.log(aspect / target_h))
    score_v = 1.0 - abs(np.log(aspect / (1 / target_h)))
    shape_score = max(score_h, score_v)
    shape_score = max(0.0, min(1.0, shape_score))

    return 1000.0 * area_ratio + 0.05 * perimeter + 300.0 * shape_score


def _extract_candidates(image: np.ndarray):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    adaptive = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )
    opened = cv2.morphologyEx(adaptive, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    edged = cv2.Canny(opened, 40, 120)
    closed = cv2.morphologyEx(edged, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    return contours


def _decode_image(data_url: str) -> np.ndarray:
    if not data_url:
        raise HTTPException(status_code=400, detail="image is required")
    if "," in data_url:
        _, encoded = data_url.split(",", 1)
    else:
        encoded = data_url
    try:
        raw = base64.b64decode(encoded)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid base64 image") from exc
    array = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="invalid image")
    return img


def _order_points(pts: np.ndarray) -> np.ndarray:
    if pts.shape != (4, 2):
        raise ValueError("points must be 4x2")
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # top-left
    rect[2] = pts[np.argmax(s)]  # bottom-right
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # top-right
    rect[3] = pts[np.argmax(diff)]  # bottom-left
    return rect


def _detect_card_points(image: np.ndarray) -> np.ndarray | None:
    image_h, image_w = image.shape[0], image.shape[1]
    image_area = image_h * image_w
    contours = _extract_candidates(image)
    if not contours:
        return None

    min_area = image_area * 0.02
    max_area = image_area * 0.95
    candidates: list[tuple[float, np.ndarray]] = []

    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < min_area or area > max_area:
            continue

        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue

        found = None
        for eps_ratio in (0.01, 0.02, 0.03, 0.04, 0.05):
            approx = cv2.approxPolyDP(contour, eps_ratio * perimeter, True)
            pts = approx.reshape(-1, 2).astype("float32")
            if pts.shape[0] < 4:
                continue
            if pts.shape[0] > 4:
                hull = cv2.convexHull(pts)
                if len(hull) != 4:
                    continue
                pts = hull.reshape(4, 2).astype("float32")
            if pts.shape != (4, 2):
                continue
            if not _is_valid_card_shape(pts, image_area, image_w, image_h):
                continue
            found = pts
            break

        if found is None:
            continue
        score = _candidate_score(found, image_area)
        if score >= DETECT_MIN_SCORE:
            candidates.append((score, found))

    if candidates:
        candidates.sort(key=lambda item: item[0], reverse=True)
        return candidates[0][1]

    if contours:
        largest = max(contours, key=cv2.contourArea)
        if float(cv2.contourArea(largest)) < min_area:
            return None
        rect = cv2.minAreaRect(largest)
        box = cv2.boxPoints(rect).astype("float32")
        if _is_valid_card_shape(box, image_area, image_w, image_h) and _candidate_score(box, image_area) >= DETECT_MIN_SCORE:
            return box

    return None


@router.post("/crop")
def crop_card(payload: CropRequest):
    if len(payload.points) != 4:
        raise HTTPException(status_code=400, detail="points must be 4 items")

    image = _decode_image(payload.image)

    try:
        pts = np.array([[p.x, p.y] for p in payload.points], dtype="float32")
        rect = _order_points(pts)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid points") from exc

    (tl, tr, br, bl) = rect
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = int(max(width_a, width_b))
    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = int(max(height_a, height_b))

    max_width = max(1, max_width)
    max_height = max(1, max_height)

    dst = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, matrix, (max_width, max_height))

    success, buffer = cv2.imencode(".png", warped)
    if not success:
        raise HTTPException(status_code=500, detail="failed to encode image")
    encoded = base64.b64encode(buffer.tobytes()).decode("utf-8")
    return {"cropped_image": encoded}


@router.post("/detect")
def detect_card(payload: DetectRequest):
    image = _decode_image(payload.image)
    detected = _detect_card_points(image)
    if detected is None:
        return {"points": None, "source": "fallback", "score": 0.0}
    source = "contour"
    score = float(_candidate_score(detected, image.shape[0] * image.shape[1]))
    rect = _order_points(detected)
    points = [{"x": float(pt[0]), "y": float(pt[1])} for pt in rect]
    return {"points": points, "source": source, "score": score}
