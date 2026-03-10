import pillow_heif
pillow_heif.register_heif_opener()

from PIL import Image, ImageOps
from typing import List, Dict, Tuple

import cv2
import numpy as np
import easyocr
import logging
import os
import re
import time

logger = logging.getLogger(__name__)

# Load OCR engine once at import time to avoid repeated model initialization.
OCR_READER = easyocr.Reader(["ja", "en"], gpu=False)

def load_image(image_path: str) -> np.ndarray:
    logger.info("Loading image: %s", image_path)
    ext = os.path.splitext(image_path)[1].lower()
    if ext in [".heic", ".heif"]:
        heif_file = pillow_heif.read_heif(image_path)
        img = Image.frombytes(
            heif_file.mode,
            heif_file.size,
            heif_file.data,
            "raw",
        )
    else:
        img = Image.open(image_path)
    img = ImageOps.exif_transpose(img)
    img = img.convert("RGB")
    img_np = np.array(img)
    img_np = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
    h, w = img_np.shape[:2]
    if w > h * 1.5:
        img_np = cv2.rotate(img_np, cv2.ROTATE_90_COUNTERCLOCKWISE)
    logger.info("Image loaded shape: %s", img_np.shape)
    return img_np


def resize_for_ocr(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    max_side = max(h, w)
    if max_side > 2000:
        scale = 2000 / max_side
        img = cv2.resize(img, None, fx=scale, fy=scale)
    return img

def preprocess_for_ocr(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.convertScaleAbs(gray, alpha=1.5, beta=10)
    kernel = np.array(
        [
            [0, -1, 0],
            [-1, 5, -1],
            [0, -1, 0],
        ]
    )
    sharpen = cv2.filter2D(gray, -1, kernel)
    thresh = cv2.adaptiveThreshold(
        sharpen,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11,
        2,
    )
    return thresh

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
    image = load_image(image_path)
    image = resize_for_ocr(image)
    image = preprocess_for_ocr(image)
    results = OCR_READER.readtext(
        image,
        paragraph=True,
        contrast_ths=0.1,
        adjust_contrast=0.7,
    )
    items = _build_items(results)
    items.sort(key=lambda item: (float(item["center_y"]), float(item["center_x"])))
    texts = [str(item["text"]) for item in items]
    raw_text = " ".join(texts).strip()
    return items, raw_text


def ocr_image_array(image: np.ndarray) -> str:
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    print("Image shape:", image.shape)
    image = resize_for_ocr(image)
    image = preprocess_for_ocr(image)
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
    def normalize_email(text: str) -> str:
        if not text or "@" not in text:
            return text
        cleaned = text.replace("＠", "@").replace("．", ".").replace("。", ".")
        cleaned = cleaned.replace(" ", "").strip()
        local, domain = cleaned.split("@", 1)
        domain = domain.replace("..", ".")
        if "." in domain:
            return f"{local}@{domain}"
        lower = domain.lower()
        jp_suffixes = ["cojp", "nejp", "orjp", "acjp", "gojp", "edjp", "lgjp"]
        for suffix in jp_suffixes:
            if lower.endswith(suffix) and len(domain) > len(suffix):
                base = domain[: -len(suffix)]
                return f"{local}@{base}.{suffix[:2]}.{suffix[2:]}"
        generic_suffixes = ["com", "net", "org", "jp", "co", "io"]
        for suffix in generic_suffixes:
            if lower.endswith(suffix) and len(domain) > len(suffix):
                base = domain[: -len(suffix)]
                return f"{local}@{base}.{suffix}"
        return f"{local}@{domain}"

    def find_email(text: str) -> str:
        normalized = text.replace("＠", "@").replace("．", ".").replace("。", ".")
        match = re.search(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", normalized)
        if match:
            return normalize_email(match.group(0))
        match = re.search(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]{2,}", normalized)
        if match:
            candidate = normalize_email(match.group(0))
            if "@" in candidate and "." in candidate.split("@", 1)[1]:
                return candidate
        return ""
    def normalize_company_name(text: str) -> str:
        if not text:
            return text
        normalized = text.replace("\u3000", " ").strip()
        normalized = re.sub(r"\s+", " ", normalized)
        normalized = re.sub(r"株\s*式\s*会\s*社", "株式会社", normalized)
        normalized = re.sub(r"有\s*限\s*会\s*社", "有限会社", normalized)
        normalized = re.sub(r"合\s*同\s*会\s*社", "合同会社", normalized)
        normalized = re.sub(r"\s*(株式会社|有限会社|合同会社|（株）|\\(株\\)|㈱)\s+", r"\1", normalized)
        normalized = re.sub(r"\s+((株式会社|有限会社|合同会社|（株）|\\(株\\)|㈱))\s*", r"\1", normalized)
        return normalized.strip()

    def normalize_person_name(text: str) -> str:
        if not text:
            return text
        normalized = text.replace("\u3000", " ").strip()
        normalized = re.sub(r"\s+", " ", normalized)
        if " " in normalized:
            parts = [part for part in normalized.split(" ") if part]
            return " ".join(parts)
        if re.fullmatch(r"[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+", normalized):
            length = len(normalized)
            if 2 <= length <= 6:
                if length <= 3:
                    split_at = 1
                elif length == 4:
                    split_at = 2
                elif length == 5:
                    split_at = 2
                else:
                    split_at = 3
                return f"{normalized[:split_at]} {normalized[split_at:]}"
        return normalized
    email = find_email(raw_text)

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
        "name": normalize_person_name(name or ""),
        "company": normalize_company_name(company or ""),
        "branch": branch or "",
        "role": role or "",
        "email": email or "",
        "phone": phone or "",
        "mobile": mobile or "",
        "raw_text": raw_text,
    }


def scan_business_card(image_path: str) -> Dict[str, str]:
    """Run OCR on the business card image and extract fields.

    Returns a dict with name, company, email, phone, raw_text.
    """
    start = time.perf_counter()
    logger.info("OCR start: %s", image_path)
    items, raw_text = run_ocr(image_path)
    fields = extract_fields(items, raw_text)
    fields["raw_text"] = raw_text
    logger.info("OCR done: %s (%.2fs)", image_path, time.perf_counter() - start)
    return fields
