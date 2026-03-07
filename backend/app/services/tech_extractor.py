from __future__ import annotations

from typing import List
import re


TECH_KEYWORDS: list[str] = [
    "Python",
    "FastAPI",
    "Django",
    "Flask",
    "Docker",
    "Kubernetes",
    "React",
    "Node.js",
    "TypeScript",
    "TensorFlow",
    "PyTorch",
    "YOLO",
    "OpenCV",
    "AWS",
    "GCP",
    "Azure",
    "PostgreSQL",
    "MongoDB",
    "Redis",
    "Kafka",
]

ROLE_TECH_MAP: dict[str, list[str]] = {
    "backend": ["Backend", "API", "Server"],
    "frontend": ["Frontend", "React", "UI"],
    "fullstack": ["Fullstack", "API", "Frontend"],
    "devops": ["DevOps", "Docker", "Kubernetes"],
    "data": ["Data", "Machine Learning"],
    "ai": ["AI", "Machine Learning"],
    "ml": ["Machine Learning"],
    "research": ["AI", "Research"],
    "cloud": ["Cloud", "AWS"],
    "mobile": ["Mobile", "iOS", "Android"],
}


def extract_technologies(text: str) -> List[str]:
    if not text:
        return []

    haystack = text.lower()
    found: list[str] = []
    seen = set()

    for keyword in TECH_KEYWORDS:
        pattern = re.escape(keyword.lower())
        if re.search(pattern, haystack):
            key = keyword.lower()
            if key in seen:
                continue
            seen.add(key)
            found.append(keyword)

    for role, tags in ROLE_TECH_MAP.items():
        if role in haystack:
            for tag in tags:
                key = tag.lower()
                if key in seen:
                    continue
                seen.add(key)
                found.append(tag)

    return found
