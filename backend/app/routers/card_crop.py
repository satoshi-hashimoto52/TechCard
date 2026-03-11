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
