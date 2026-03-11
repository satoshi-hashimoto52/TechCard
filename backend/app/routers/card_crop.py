from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import base64
import cv2
import numpy as np

router = APIRouter(prefix="/card", tags=["card"])


class CropPoint(BaseModel):
    x: float
    y: float


class CropRequest(BaseModel):
    image: str
    points: List[CropPoint]


class DetectRequest(BaseModel):
    image: str


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
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    image_area = image.shape[0] * image.shape[1]
    min_area = image_area * 0.1
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype("float32")
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
        height, width = image.shape[:2]
        detected = np.array(
            [
                [0, 0],
                [width - 1, 0],
                [width - 1, height - 1],
                [0, height - 1],
            ],
            dtype="float32",
        )
        source = "fallback"
    else:
        source = "contour"
    rect = _order_points(detected)
    points = [{"x": float(pt[0]), "y": float(pt[1])} for pt in rect]
    return {"points": points, "source": source}
