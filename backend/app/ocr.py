from typing import Dict, List, Tuple
import logging
import os
import re
import tempfile
import time
import cv2
import easyocr
import numpy as np

logger = logging.getLogger(__name__)

# Load OCR engine once at import time to avoid repeated model initialization.
OCR_READER = easyocr.Reader(["ja", "en"], gpu=False)

def preprocess_image(image_path: str) -> str:
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Failed to load image: {image_path}")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    if width > 1200:
        scale = 1200 / width
        gray = cv2.resize(gray, (int(width * scale), int(height * scale)))

    gray = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)

    fd, temp_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    cv2.imwrite(temp_path, gray)
    return temp_path


def _build_items(results) -> List[Dict[str, float | str]]:
    items: List[Dict[str, float | str]] = []
    if not isinstance(results, list):
        return items
    for entry in results:
        if not entry or len(entry) < 2:
            continue
        bbox, text = entry[0], entry[1]
        if not bbox or not text:
            continue
        xs = [point[0] for point in bbox if len(point) > 0]
        ys = [point[1] for point in bbox if len(point) > 1]
        if not xs or not ys:
            continue
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        items.append(
            {
                "text": text,
                "center_x": (min_x + max_x) / 2,
                "center_y": (min_y + max_y) / 2,
                "box_height": max_y - min_y,
                "box_width": max_x - min_x,
            }
        )
    return items


def run_ocr(image_path: str) -> Tuple[List[Dict[str, float | str]], str]:
    image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    results = OCR_READER.readtext(image)
    items = _build_items(results)
    items.sort(key=lambda item: (float(item["center_y"]), float(item["center_x"])))
    texts = [str(item["text"]) for item in items]
    raw_text = " ".join(texts).strip()
    return items, raw_text


def ocr_image_array(image: np.ndarray) -> str:
    results = OCR_READER.readtext(image)
    entries: List[Tuple[str, float, float]] = []
    for bbox, text, _confidence in results:
        xs = [point[0] for point in bbox]
        ys = [point[1] for point in bbox]
        entries.append((text, min(xs), min(ys)))
    entries.sort(key=lambda item: (item[2], item[1]))
    texts = [item[0] for item in entries]
    return " ".join(texts).strip()


def extract_fields(items: List[Dict[str, float | str]], raw_text: str) -> Dict[str, str]:
    email_match = re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", raw_text)
    email = email_match.group(0) if email_match else ""

    phone_candidates = re.findall(r"(?:\+?81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}", raw_text)
    phone = ""
    mobile = ""
    for candidate in phone_candidates:
        normalized = candidate.replace(" ", "").replace("-", "")
        if normalized.startswith("070") or normalized.startswith("080") or normalized.startswith("090") or normalized.startswith("+8170") or normalized.startswith("+8180") or normalized.startswith("+8190"):
            if not mobile:
                mobile = candidate
        elif not phone:
            phone = candidate

    company_keywords = ["株式会社", "有限会社", "Inc", "Ltd", "LLC", "Co.", "Corp"]
    japanese_regex = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")
    digit_regex = re.compile(r"\d")

    if items:
        max_height = max(float(item["box_height"]) for item in items)
        max_y = max(float(item["center_y"]) for item in items)
    else:
        max_height = 1.0
        max_y = 1.0

    name = ""
    company = ""
    branch = ""
    role = ""

    name_candidates: List[Tuple[float, Dict[str, float | str]]] = []
    company_candidates: List[Tuple[float, Dict[str, float | str]]] = []

    for item in items:
        text = str(item["text"]).strip()
        if not text:
            continue
        if email and email in text:
            continue
        if phone and phone in text:
            continue
        if mobile and mobile in text:
            continue

        center_y = float(item["center_y"])
        height = float(item["box_height"])
        near_center_score = 1.0 - abs(center_y - max_y * 0.55) / max_y if max_y else 0
        height_score = height / max_height if max_height else 0

        if any(keyword in text for keyword in company_keywords):
            company_candidates.append((height_score + (1.0 - center_y / max_y), item))
        elif center_y < max_y * 0.35:
            company_candidates.append((height_score * 0.6, item))

        if japanese_regex.search(text) and not digit_regex.search(text):
            name_candidates.append((height_score + near_center_score, item))

    if name_candidates:
        name_item = sorted(name_candidates, key=lambda entry: entry[0], reverse=True)[0][1]
        name = str(name_item["text"]).strip()

    if company_candidates:
        company_item = sorted(company_candidates, key=lambda entry: entry[0], reverse=True)[0][1]
        company = str(company_item["text"]).strip()

    branch_keywords = ["支店", "支社", "営業所", "本社", "オフィス", "Office", "Branch"]
    branch_pattern = re.compile(r"([\w\u3040-\u30ff\u3400-\u9fff]+(?:支店|支社|営業所|本社|オフィス))")
    branch_en_pattern = re.compile(r"([A-Za-z0-9&.\- ]+\b(?:Office|Branch))")

    for item in items:
        text = str(item["text"]).strip()
        if not text:
            continue
        if any(keyword in text for keyword in branch_keywords):
            branch = text
            break

    if company and branch and branch in company:
        if company == branch:
            match = branch_pattern.search(company) or branch_en_pattern.search(company)
            if match:
                branch = match.group(1).strip()
                company = company.replace(branch, "").strip()
        else:
            parts = company.split(branch, 1)
            company = parts[0].strip()
    elif company and not branch:
        match = branch_pattern.search(company) or branch_en_pattern.search(company)
        if match:
            branch = match.group(1).strip()
            company = company.replace(branch, "").strip()

    if name:
        name_center_y = None
        name_height = None
        for item in items:
            if str(item["text"]).strip() == name:
                name_center_y = float(item["center_y"])
                name_height = float(item["box_height"])
                break
        if name_center_y is not None and name_height is not None:
            above_items = [
                item
                for item in items
                if float(item["center_y"]) < name_center_y
                and float(item["box_height"]) < name_height * 0.9
            ]
            if above_items:
                above_items.sort(key=lambda item: float(item["center_y"]), reverse=True)
                role = str(above_items[0]["text"]).strip()

    return {
        "name": name,
        "company": company,
        "branch": branch,
        "role": role,
        "email": email,
        "phone": phone,
        "mobile": mobile,
        "raw_text": raw_text,
    }


def scan_business_card(image_path: str) -> Dict[str, str]:
    """Run OCR on the business card image and extract fields.

    Returns a dict with name, company, email, phone, raw_text.
    """
    # Perform OCR
    start = time.perf_counter()
    logger.info("OCR start: %s", image_path)
    processed_path = preprocess_image(image_path)
    try:
        lines, raw_text = run_ocr(processed_path)
        logger.info("OCR done: %s (%.2fs)", image_path, time.perf_counter() - start)
        return extract_fields(lines, raw_text)
    finally:
        if processed_path != image_path:
            try:
                os.remove(processed_path)
            except OSError:
                pass
