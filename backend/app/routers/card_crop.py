from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import base64
import cv2
import numpy as np

router = APIRouter(prefix="/card", tags=["card"])
DETECT_MIN_SCORE = 35.0
DETECT_FALLBACK_SCORE = 12.0


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


def _is_valid_card_shape(
    pts: np.ndarray,
    image_area: int,
    image_w: int,
    image_h: int,
    allow_touching_edge: bool = False,
    strict: bool = True,
) -> bool:
    if pts.shape != (4, 2):
        return False
    ordered = _order_points(pts.copy())
    area = float(abs(cv2.contourArea(ordered.astype(np.float32))))
    if area <= 0:
        return False

    area_ratio = area / float(image_area)
    if not (0.01 <= area_ratio <= 0.98):
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
    if strict:
        if not (0.3 <= aspect <= 4.5):
            return False
    else:
        if not (0.2 <= aspect <= 6.5):
            return False

    min_wh = max(70, min(image_w, image_h) * 0.05)
    if width < min_wh or height < min_wh:
        return False

    min_x = float(np.min(ordered[:, 0]))
    max_x = float(np.max(ordered[:, 0]))
    min_y = float(np.min(ordered[:, 1]))
    max_y = float(np.max(ordered[:, 1]))

    # 全体フレームと一致しやすい矩形は除外（誤検出防止）
    edge_margin_x = image_w * 0.02
    edge_margin_y = image_h * 0.02

    if allow_touching_edge:
        return (
            min_x >= 0
            and max_x <= image_w
            and min_y >= 0
            and max_y <= image_h
            and (max_x - min_x) >= 100
            and (max_y - min_y) >= 100
        )

    return (
        min_x > edge_margin_x
        and max_x < image_w - edge_margin_x
        and min_y > edge_margin_y
        and max_y < image_h - edge_margin_y
    )


def _bucket_lines(values: list[float], tolerance: float = 12.0) -> list[float]:
    if not values:
        return []

    values = sorted(values)
    buckets: list[tuple[float, int]] = []

    for v in values:
        placed = False
        for idx, (center, count) in enumerate(buckets):
            if abs(v - center) <= tolerance:
                buckets[idx] = ((center * count + v) / (count + 1), count + 1)
                placed = True
                break
        if not placed:
            buckets.append((v, 1))

    buckets.sort(key=lambda item: item[1], reverse=True)
    return [center for center, _ in buckets[:12]]


def _detect_hough_grid(gray: np.ndarray) -> list[np.ndarray]:
    h, w = gray.shape[:2]
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 40, 120)

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=140,
        minLineLength=max(w, h) * 0.25,
        maxLineGap=20,
    )
    if lines is None:
        return []

    line_groups: list[float] = []
    horizontal: list[float] = []
    vertical: list[float] = []

    for line in lines[:, 0, :]:
        x1, y1, x2, y2 = line
        dx = float(x2 - x1)
        dy = float(y2 - y1)
        angle = abs(np.degrees(np.arctan2(dy, dx)))
        if angle <= 20 or angle >= 160:
            horizontal.append((float(y1) + float(y2)) / 2.0)
        elif 70 <= angle <= 110:
            vertical.append((float(x1) + float(x2)) / 2.0)

    if len(horizontal) < 2 or len(vertical) < 2:
        return []

    h_lines = _bucket_lines(horizontal, 12.0)
    v_lines = _bucket_lines(vertical, 12.0)
    if len(h_lines) < 2 or len(v_lines) < 2:
        return []

    h_lines = sorted(h_lines)
    v_lines = sorted(v_lines)

    candidates: list[np.ndarray] = []
    image_area = w * h
    for y_top in h_lines[:6]:
        for y_bottom in h_lines[-6:]:
            if y_bottom - y_top < 120:
                continue
            for x_left in v_lines[:6]:
                for x_right in v_lines[-6:]:
                    if x_right - x_left < 180:
                        continue
                    pts = np.array(
                        [
                            [x_left, y_top],
                            [x_right, y_top],
                            [x_right, y_bottom],
                            [x_left, y_bottom],
                        ],
                        dtype="float32",
                    )
                    if not _is_valid_card_shape(
                        pts,
                        image_area,
                        w,
                        h,
                        allow_touching_edge=True,
                    ):
                        continue
                    candidates.append(pts)

    return candidates


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


def _extract_quad_from_contour(
    contour: np.ndarray,
    image_area: int,
    image_w: int,
    image_h: int,
) -> tuple[np.ndarray, float] | None:
    area = float(cv2.contourArea(contour))
    if area <= 0 or area < image_area * 0.01 or area > image_area * 0.98:
        return None

    perimeter = cv2.arcLength(contour, True)
    if perimeter <= 0:
        return None

    # まず輪郭近似（4点）を探し、次に凸包→4点のみを採用
    for eps_ratio in (0.008, 0.012, 0.018, 0.026, 0.035):
        approx = cv2.approxPolyDP(contour, eps_ratio * perimeter, True)
        if approx is None:
            continue

        pts = approx.reshape(-1, 2).astype("float32")
        if pts.shape[0] == 4:
            candidate = pts
        elif pts.shape[0] > 4:
            hull = cv2.convexHull(pts)
            hull = hull.reshape(-1, 2).astype("float32")
            if hull.shape[0] != 4:
                rect = cv2.minAreaRect(contour)
                box = cv2.boxPoints(rect).astype("float32")
                if _is_valid_card_shape(box, image_area, image_w, image_h, allow_touching_edge=True):
                    return box, _candidate_score(box, image_area)
                continue
            candidate = hull
        else:
            continue

        if not _is_valid_card_shape(candidate, image_area, image_w, image_h, allow_touching_edge=True):
            continue

        score = _candidate_score(candidate, image_area)
        return candidate, score

    # 最終的に minAreaRect も試す（歪みや重なり時の救済）
    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect).astype("float32")
    if not _is_valid_card_shape(box, image_area, image_w, image_h, allow_touching_edge=True):
        return None

    score = _candidate_score(box, image_area)
    if score < DETECT_FALLBACK_SCORE:
        return None

    return box, score


def _extract_quads_from_canny(
    gray: np.ndarray,
    image_area: int,
    image_w: int,
    image_h: int,
) -> list[tuple[np.ndarray, float, str]]:
    candidates: list[tuple[np.ndarray, float, str]] = []
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    cfgs = [
        {"low": 45, "high": 130, "blur": (5, 5), "open": (3, 3), "close": (5, 5), "eps": 0.010, "label": "canny_a"},
        {"low": 30, "high": 100, "blur": (7, 7), "open": (3, 3), "close": (5, 5), "eps": 0.014, "label": "canny_b"},
        {"low": 55, "high": 165, "blur": (3, 3), "open": (5, 5), "close": (7, 7), "eps": 0.012, "label": "canny_c"},
    ]

    for cfg in cfgs:
        blurred = cv2.GaussianBlur(enhanced, cfg["blur"], 0)
        edges = cv2.Canny(blurred, cfg["low"], cfg["high"])

        if cfg["open"] is not None:
            edges = cv2.morphologyEx(
                edges,
                cv2.MORPH_OPEN,
                np.ones(cfg["open"], np.uint8),
            )
        if cfg["close"] is not None:
            edges = cv2.morphologyEx(
                edges,
                cv2.MORPH_CLOSE,
                np.ones(cfg["close"], np.uint8),
            )

        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < image_area * 0.004 or area > image_area * 0.98:
                continue

            perimeter = cv2.arcLength(contour, True)
            if perimeter <= 0:
                continue

            extracted = None
            eps = cfg["eps"]
            for repeat in (eps, eps * 1.4, eps * 2.0):
                approx = cv2.approxPolyDP(contour, repeat * perimeter, True)
                if approx is None:
                    continue

                pts = approx.reshape(-1, 2).astype("float32")
                if pts.shape[0] < 4:
                    continue

                if pts.shape[0] > 4:
                    hull = cv2.convexHull(pts).reshape(-1, 2).astype("float32")
                    if hull.shape[0] < 4:
                        continue
                    pts = hull

                rect = cv2.minAreaRect(pts)
                box = cv2.boxPoints(rect).astype("float32")
                if _is_valid_card_shape(
                    box,
                    image_area,
                    image_w,
                    image_h,
                    allow_touching_edge=True,
                    strict=False,
                ):
                    extracted = box
                    break

            if extracted is None:
                continue

            score = _candidate_score(extracted, image_area)
            if score < DETECT_FALLBACK_SCORE:
                continue
            candidates.append((extracted, score, cfg["label"]))

    # 近接重複を除去（同一領域の上書きを防止）
    dedup: list[tuple[np.ndarray, float, str]] = []
    for pts, score, label in sorted(candidates, key=lambda item: item[1], reverse=True):
        mx = np.mean(pts[:, 0])
        my = np.mean(pts[:, 1])
        duplicated = False
        for existing, _, _ in dedup:
            ex = np.mean(existing[:, 0])
            ey = np.mean(existing[:, 1])
            if abs(ex - mx) <= 12 and abs(ey - my) <= 12:
                duplicated = True
                break
        if not duplicated:
            dedup.append((pts, score, label))

    return dedup


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


def _detect_card_points(image: np.ndarray) -> tuple[np.ndarray | None, str | None]:
    image_h, image_w = image.shape[0], image.shape[1]
    image_area = image_h * image_w
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    contours = _extract_candidates(image)
    if not contours:
        contours = []

    canny_candidates = _extract_quads_from_canny(
        gray=gray,
        image_area=image_area,
        image_w=image_w,
        image_h=image_h,
    )

    min_area = image_area * 0.004
    max_area = image_area * 0.98
    candidates: list[tuple[float, np.ndarray, str]] = []

    for candidate, score, source in canny_candidates:
        if score >= DETECT_MIN_SCORE or source == "canny_c":
            candidates.append((score, candidate, "contour"))

    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < min_area or area > max_area:
            continue

        extracted = _extract_quad_from_contour(contour, image_area, image_w, image_h)
        if extracted is None:
            continue
        score, candidate = extracted[1], extracted[0]
        if score >= DETECT_MIN_SCORE:
            candidates.append((score, candidate, "contour"))
        elif score >= DETECT_FALLBACK_SCORE:
            candidates.append((score, candidate, "contour_low"))

    if candidates:
        candidates.sort(key=lambda item: item[0], reverse=True)
        top_score, top_points, top_source = candidates[0]
        source = "contour" if top_source == "contour" else "contour"
        return top_points, source

    hough_candidates = _detect_hough_grid(gray=gray)
    if hough_candidates:
        best = max(
            (( _candidate_score(candidate, image_area), candidate) for candidate in hough_candidates),
            key=lambda item: item[0],
            default=(None, None),
        )
        if best[0] is not None and best[0] >= 120:
            return best[1], "contour"

    if contours:
        largest = max(contours, key=cv2.contourArea)
        if float(cv2.contourArea(largest)) < min_area:
            return None, None
        rect = cv2.minAreaRect(largest)
        box = cv2.boxPoints(rect).astype("float32")
        score = _candidate_score(box, image_area)
        if _is_valid_card_shape(box, image_area, image_w, image_h, allow_touching_edge=True) and score >= DETECT_FALLBACK_SCORE:
            return box, "fallback"

    return None, None


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
    detected, source = _detect_card_points(image)
    if detected is None or source is None:
        return {"points": None, "source": "fallback", "score": 0.0}
    score = float(_candidate_score(detected, image.shape[0] * image.shape[1]))
    rect = _order_points(detected)
    points = [{"x": float(pt[0]), "y": float(pt[1])} for pt in rect]
    return {"points": points, "source": source, "score": score}
