from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import datetime
import asyncio
import hashlib
import json
import math
import os
import re
import socket
import time
import urllib.parse
import urllib.request
import urllib.error
import logging
from concurrent.futures import ThreadPoolExecutor, wait as wait_futures
from ..database import SessionLocal
from .. import models

router = APIRouter(prefix="/stats", tags=["stats"])
logger = logging.getLogger("techcard.geocode")
# uvicornのログ設定（INFO以上をlogs/backend-*.logへ出力）に乗せるため、uvicorn.errorの子ロガーにする
route_logger = logging.getLogger("uvicorn.error").getChild("techcard_route")
_GEOCODE_SEMAPHORE = asyncio.Semaphore(1)
_ADDRESS_GEOCODE_CACHE: dict[tuple[str, str], tuple[float, float]] = {}
_ADDRESS_GEOCODE_INFLIGHT: set[tuple[str, str]] = set()
_MAX_ADDRESS_GEOCODES_PER_REQUEST = 6
_EVENT_TOP_LEVELS = ("Cards", "Expo", "Mixer", "OJT")
_EVENT_TOP_LABELS = {key: f"#{key}" for key in _EVENT_TOP_LEVELS}
_PREFECTURE_PATTERN = re.compile(r"(北海道|東京都|京都府|大阪府|(?:..|...)県)")
_ROAD_ID_PATTERN = re.compile(r"\b[ER]?\d{1,3}\b", re.IGNORECASE)
_JCT_PATTERN = re.compile(r"(?:\bJCT\b|ジャンクション|junction|interchange|分岐|乗換)", re.IGNORECASE)
_IC_PATTERN = re.compile(r"(?:\bIC\b|インター|入口|出口|出入口|interchange|ramp|entry|exit)", re.IGNORECASE)
_IC_JCT_NAME_PATTERN = re.compile(r"(?:\b(?:IC|JCT)\b|インター|ジャンクション)", re.IGNORECASE)
_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_IC_JCT_LOOKUP_CACHE: dict[str, str | None] = {}
_ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"
_OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving"
# 代替ルーティングサービス（FOSSGIS運営の公開OSRM / Valhalla）
_FOSSGIS_OSRM_ROUTE_URL = "https://routing.openstreetmap.de/routed-car/route/v1/driving"
_VALHALLA_ROUTE_URL = "https://valhalla1.openstreetmap.de/route"
# 画面側（fetchCompanyRoute）のタイムアウトより十分短く収めるための時間予算
_ROUTE_PROVIDER_TIMEOUT_S = 8.0
_ROUTE_PROVIDER_BUDGET_S = 9.0
_ROUTE_ENRICH_BUDGET_S = 4.0
_IC_JCT_LOOKUP_TIMEOUT_S = 3.5
# 経路選択ロジックの版。変更時はキャッシュを再計算させる（旧キャッシュで新しい選択が省略されないようにする）
_ROUTE_CACHE_KEY_VERSION = "v3"
_HIGHWAY_NAME_PATTERN = re.compile(r"(自動車道|高速|首都高|Expressway|Motorway)", re.IGNORECASE)
_HIGHWAY_REF_PATTERN = re.compile(r"^(?:E\d{1,3}[A-Z]?|C\d)$")
# 高速道路を含む経路とみなす最小走行距離（出口名などの一致による誤判定を避ける）
_HIGHWAY_MIN_DISTANCE_M = 1000.0
_INTER_PREF_ROUTE_MODES = {"inter_pref_highway", "inter_pref_road"}
_INTRA_PREF_ROUTE_MODES = {"intra_pref_local", "intra_pref_local_fallback"}


def _parse_event_tag_name(raw_name: str | None) -> tuple[str, str] | None:
    if not raw_name:
        return None
    name = raw_name.strip()
    for separator in ("::", "/", "／", ">", "＞"):
        if separator not in name:
            continue
        top_raw, child_raw = name.split(separator, 1)
        top_token = top_raw.replace("#", "").strip().lower()
        child = child_raw.strip()
        if not child:
            continue
        canonical_top = next((item for item in _EVENT_TOP_LEVELS if item.lower() == top_token), None)
        if canonical_top is None:
            continue
        return canonical_top, child
    return None


def _event_key(top_name: str, sub_name: str) -> str:
    return f"{top_name.strip().lower()}::{sub_name.strip().lower()}"


def _normalize_tag_type(value: str | None) -> str:
    if not value:
        return "relation"
    if value in ("tech", "technology"):
        return "tech"
    if value == "event":
        return "event"
    return "relation"


def _canonical_tag_key(tag: models.Tag) -> str | None:
    if not tag.name:
        return None
    tag_type = _normalize_tag_type(tag.type)
    if tag_type == "event":
        parsed = _parse_event_tag_name(tag.name)
        # イベントは「上位/下位」の2段構造のみ集計対象にする。
        # 上位タグ単体や非正規フォーマットはカウントしない。
        if parsed is None:
            return None
        top_name, sub_name = parsed
        return f"event:{_event_key(top_name, sub_name)}"
    return f"{tag_type}:{tag.name.strip().lower()}"


def _collect_tag_keys(*tag_lists: list[models.Tag] | None) -> set[str]:
    keys: set[str] = set()
    for tags in tag_lists:
        for tag in tags or []:
            key = _canonical_tag_key(tag)
            if key:
                keys.add(key)
    return keys


def _extract_prefecture(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"\s+", "", value)
    text = re.sub(r"^〒?\d{3}-?\d{4}", "", text)
    matched = _PREFECTURE_PATTERN.search(text)
    if not matched:
        return None
    return matched.group(1)


def _coord_key(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> str:
    # 版を含めることで、経路選択ロジック変更前のキャッシュを一致させない
    return f"{_ROUTE_CACHE_KEY_VERSION}|{from_lat:.6f},{from_lon:.6f}|{to_lat:.6f},{to_lon:.6f}"


def _has_cached_route_steps(raw_steps: str | None) -> bool:
    if not raw_steps:
        return False
    try:
        parsed = json.loads(raw_steps)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, list) and len(parsed) > 0


def _classify_route_step_kind(
    maneuver_text: str,
    instruction: str,
    road_name: str,
    destinations: str,
) -> str:
    text = " ".join([maneuver_text, instruction, road_name, destinations]).lower()
    if _JCT_PATTERN.search(text):
        return "junction"
    if (
        any(token in text for token in ("on ramp", "merge", "流入", "乗り口", "entry"))
        or ("入口" in text and "出口" not in text)
    ):
        return "enter"
    if any(token in text for token in ("off ramp", "exit", "出口", "流出", "降り口", "下りる")):
        return "exit"
    if _IC_PATTERN.search(text):
        return "road"
    if (
        any(token in text for token in ("高速", "自動車道", "motorway", "expressway", "国道", "県道"))
        or _ROAD_ID_PATTERN.search(text) is not None
    ):
        return "road"
    return "other"


def _build_route_step_label(
    kind: str,
    road_name: str,
    destinations: str,
    instruction: str,
) -> str:
    core = (destinations or "").strip() or (road_name or "").strip() or (instruction or "").strip()
    if kind == "enter":
        return f"乗り口: {core}" if core else "乗り口"
    if kind == "exit":
        return f"降り口: {core}" if core else "降り口"
    if kind == "junction":
        return f"乗換: {core}" if core else "乗換"
    if kind == "road":
        return f"経由: {core}" if core else "経由道路"
    return core or "経由点"


def _normalize_route_steps(raw_steps: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: list[dict[str, object]] = []
    seen_keys: set[str] = set()
    for step in raw_steps:
        lon = step.get("lon")
        lat = step.get("lat")
        if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
            continue
        if not math.isfinite(float(lon)) or not math.isfinite(float(lat)):
            continue
        label = str(step.get("label") or "").strip()
        kind = str(step.get("kind") or "other").strip().lower()
        road = str(step.get("road") or "").strip()
        key = f"{round(float(lon), 5)}:{round(float(lat), 5)}:{kind}:{label}:{road}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(
            {
                "lon": float(lon),
                "lat": float(lat),
                "kind": kind if kind in {"enter", "exit", "junction", "road"} else "other",
                "label": label or "経由点",
                "road": road or None,
                "detail": str(step.get("detail") or "").strip() or None,
            }
        )

    key_steps = [step for step in deduped if step["kind"] in {"enter", "exit", "junction"}]
    road_steps: list[dict[str, object]] = []
    seen_roads: set[str] = set()
    for step in deduped:
        if step["kind"] != "road":
            continue
        road_key = str(step.get("road") or step.get("label") or "").strip().lower()
        if road_key and road_key in seen_roads:
            continue
        if road_key:
            seen_roads.add(road_key)
        road_steps.append(step)

    if key_steps:
        return (key_steps[:14] + road_steps[:6])[:18]
    return road_steps[:10]


def _extract_ic_jct_name_candidate(*values: str | None) -> str | None:
    for value in values:
        # ラベルの表示用接頭辞（「乗り口: 」等）を除いてから名前として扱う（接頭辞の二重付与を防ぐ）
        text = re.sub(r"^(?:(?:乗り口|降り口|乗換|経由)\s*:\s*)+", "", (value or "").strip())
        if not text:
            continue
        if _IC_JCT_NAME_PATTERN.search(text):
            pieces = re.split(r"[／/;>|]", text)
            for piece in pieces:
                candidate = piece.strip()
                if not candidate:
                    continue
                if _IC_JCT_NAME_PATTERN.search(candidate):
                    return candidate
            return text
    return None


def _lookup_nearest_ic_jct_name(lon: float, lat: float, timeout_s: float = 10.0) -> str | None:
    cache_key = f"{lat:.5f},{lon:.5f}"
    if cache_key in _IC_JCT_LOOKUP_CACHE:
        return _IC_JCT_LOOKUP_CACHE[cache_key]

    server_timeout = max(1, int(timeout_s))
    query = f"""
    [out:json][timeout:{server_timeout}];
    (
      node(around:1800,{lat:.6f},{lon:.6f})["highway"="motorway_junction"];
      node(around:1800,{lat:.6f},{lon:.6f})["name"~"(IC|JCT|インター|ジャンクション)",i];
      way(around:1800,{lat:.6f},{lon:.6f})["name"~"(IC|JCT|インター|ジャンクション)",i];
    );
    out center tags;
    """
    request = urllib.request.Request(
        _OVERPASS_URL,
        data=query.encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "text/plain; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": "techcard-routing/1.0",
        },
    )
    nearest_name: str | None = None
    nearest_distance = float("inf")
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            raw = response.read().decode("utf-8")
        payload = json.loads(raw)
        elements = payload.get("elements") or []
        for element in elements:
            if not isinstance(element, dict):
                continue
            tags = element.get("tags") or {}
            if not isinstance(tags, dict):
                continue
            name = str(tags.get("name") or "").strip()
            if not name:
                continue
            if _IC_JCT_NAME_PATTERN.search(name) is None:
                continue
            point_lat = element.get("lat")
            point_lon = element.get("lon")
            if point_lat is None or point_lon is None:
                center = element.get("center") or {}
                if isinstance(center, dict):
                    point_lat = center.get("lat")
                    point_lon = center.get("lon")
            if point_lat is None or point_lon is None:
                continue
            try:
                distance = _haversine_distance_m(lat, lon, float(point_lat), float(point_lon))
            except (TypeError, ValueError):
                continue
            if distance < nearest_distance:
                nearest_distance = distance
                nearest_name = name
    except Exception as exc:
        # タイムアウト・通信エラーはキャッシュしない（同一プロセス内で恒久的に名前が欠けるのを防ぐ）
        route_logger.warning("ic_jct_lookup_failed lat=%.5f lon=%.5f error=%s", lat, lon, str(exc)[:120])
        return None

    _IC_JCT_LOOKUP_CACHE[cache_key] = nearest_name
    return nearest_name


def _enrich_route_steps_with_ic_jct_names(
    route_steps: list[dict[str, object]],
    budget_s: float = _ROUTE_ENRICH_BUDGET_S,
) -> tuple[list[dict[str, object]], bool]:
    # IC・JCT名が不明な乗降点だけを並列に補完し、全体を時間予算内に収める。
    # 予算内に終わらなかった地点は名前なしのまま返す（画面側のタイムアウトを優先して防ぐ）。
    pending: dict[int, tuple[float, float]] = {}
    for index, step in enumerate(route_steps):
        if not isinstance(step, dict):
            continue
        kind = str(step.get("kind") or "").strip().lower()
        if kind not in {"enter", "exit", "junction"}:
            continue
        if _extract_ic_jct_name_candidate(
            str(step.get("label") or ""), str(step.get("road") or ""), str(step.get("detail") or "")
        ):
            continue
        if len(pending) >= 8:
            break
        lon = step.get("lon")
        lat = step.get("lat")
        if isinstance(lon, (int, float)) and isinstance(lat, (int, float)):
            if math.isfinite(float(lon)) and math.isfinite(float(lat)):
                pending[index] = (float(lon), float(lat))

    looked_up: dict[int, str | None] = {}
    if pending and budget_s > 0.5:
        lookup_timeout = min(_IC_JCT_LOOKUP_TIMEOUT_S, budget_s)
        executor = ThreadPoolExecutor(max_workers=min(4, len(pending)))
        futures = {
            executor.submit(_lookup_nearest_ic_jct_name, lon, lat, lookup_timeout): index
            for index, (lon, lat) in pending.items()
        }
        done, not_done = wait_futures(list(futures.keys()), timeout=budget_s)
        for future in done:
            try:
                looked_up[futures[future]] = future.result()
            except Exception:
                looked_up[futures[future]] = None
        if not_done:
            route_logger.warning("ic_jct_lookup_budget_exceeded pending=%d budget_s=%.1f", len(not_done), budget_s)
        executor.shutdown(wait=False, cancel_futures=True)

    changed = False
    result: list[dict[str, object]] = []
    for index, step in enumerate(route_steps):
        if not isinstance(step, dict):
            continue
        copied = dict(step)
        kind = str(copied.get("kind") or "").strip().lower()
        if kind not in {"enter", "exit", "junction"}:
            result.append(copied)
            continue
        label = str(copied.get("label") or "").strip()
        road = str(copied.get("road") or "").strip()
        detail = str(copied.get("detail") or "").strip()
        current_name = _extract_ic_jct_name_candidate(label, road, detail) or looked_up.get(index)
        if current_name:
            next_label = _build_route_step_label(kind, current_name, "", "")
            if copied.get("label") != next_label:
                copied["label"] = next_label
                changed = True
            if not copied.get("road"):
                copied["road"] = current_name
                changed = True
        result.append(copied)
    return result, changed


def _extract_ors_route_steps(feature: dict[str, object], coordinates: list[list[float]]) -> list[dict[str, object]]:
    raw_steps: list[dict[str, object]] = []
    properties = feature.get("properties") or {}
    segments = properties.get("segments") or []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        steps = segment.get("steps") or []
        for step in steps:
            if not isinstance(step, dict):
                continue
            way_points = step.get("way_points") or []
            if not isinstance(way_points, list) or not way_points:
                continue
            try:
                point_index = int(way_points[0])
            except (TypeError, ValueError):
                continue
            if point_index < 0 or point_index >= len(coordinates):
                continue
            coord = coordinates[point_index]
            if not isinstance(coord, list) or len(coord) < 2:
                continue
            try:
                lon = float(coord[0])
                lat = float(coord[1])
            except (TypeError, ValueError):
                continue
            instruction = str(step.get("instruction") or "").strip()
            road_name = str(step.get("name") or "").strip()
            maneuver_text = str(step.get("type") or "").strip()
            kind = _classify_route_step_kind(maneuver_text, instruction, road_name, "")
            raw_steps.append(
                {
                    "lon": lon,
                    "lat": lat,
                    "kind": kind,
                    "road": road_name or None,
                    "label": _build_route_step_label(kind, road_name, "", instruction),
                    "detail": instruction or None,
                }
            )
    return _normalize_route_steps(raw_steps)


def _extract_osrm_route_steps(route: dict[str, object]) -> list[dict[str, object]]:
    raw_steps: list[dict[str, object]] = []
    for leg in route.get("legs") or []:
        if not isinstance(leg, dict):
            continue
        for step in leg.get("steps") or []:
            if not isinstance(step, dict):
                continue
            maneuver = step.get("maneuver") or {}
            if not isinstance(maneuver, dict):
                continue
            location = maneuver.get("location") or []
            if not isinstance(location, list) or len(location) < 2:
                continue
            try:
                lon = float(location[0])
                lat = float(location[1])
            except (TypeError, ValueError):
                continue
            name = str(step.get("name") or "").strip()
            ref = str(step.get("ref") or "").strip()
            road_name = " / ".join(part for part in (name, ref) if part).strip()
            destinations = str(step.get("destinations") or "").strip()
            exit_number = maneuver.get("exit")
            if isinstance(exit_number, int) and exit_number > 0:
                destinations = f"{destinations} 出口{exit_number}".strip()
            maneuver_type = str(maneuver.get("type") or "").strip().lower()
            maneuver_modifier = str(maneuver.get("modifier") or "").strip().lower()
            maneuver_text = " ".join(part for part in (maneuver_type, maneuver_modifier) if part)
            kind = _classify_route_step_kind(maneuver_text, "", road_name, destinations)
            raw_steps.append(
                {
                    "lon": lon,
                    "lat": lat,
                    "kind": kind,
                    "road": road_name or None,
                    "label": _build_route_step_label(kind, road_name, destinations, maneuver_text),
                    "detail": maneuver_text or None,
                }
            )
    return _normalize_route_steps(raw_steps)


def _collect_highway_roads(segments: list[tuple[list[str], float]]) -> tuple[list[str], float]:
    # (道路名・路線番号の一覧, 区間距離m) から高速道路区間を抽出し、距離の長い順の道路名と合計距離を返す。
    distance_by_name: dict[str, float] = {}
    highway_distance_m = 0.0
    for names, distance_m in segments:
        cleaned = [
            part.strip()
            for name in names
            if name
            for part in re.split(r"[;；]", name)
            if part.strip()
        ]
        if not cleaned:
            continue
        is_highway = any(
            _HIGHWAY_NAME_PATTERN.search(name) or _HIGHWAY_REF_PATTERN.match(name)
            for name in cleaned
        )
        if not is_highway:
            continue
        highway_distance_m += max(0.0, float(distance_m or 0.0))
        display_names = [name for name in cleaned if _HIGHWAY_NAME_PATTERN.search(name)] or cleaned
        for name in display_names:
            # 英語表記（Expressway等）は日本語名がある場合は省略する
            if re.fullmatch(r"[A-Za-z0-9 .\-()]+", name) and any(
                re.search(r"[^\x00-\x7f]", other) for other in display_names
            ):
                continue
            distance_by_name[name] = distance_by_name.get(name, 0.0) + max(0.0, float(distance_m or 0.0))
    ordered = [name for name, _ in sorted(distance_by_name.items(), key=lambda item: -item[1])]
    if any(re.search(r"[^\x00-\x7f]", name) for name in ordered):
        # 日本語の道路名がある場合、英語名・路線番号のみの表記は表示用一覧から除く
        ordered = [name for name in ordered if re.search(r"[^\x00-\x7f]", name)]
    return ordered[:8], highway_distance_m


def _make_route_candidate(
    provider: str,
    geometry: dict[str, object],
    distance_m: float,
    duration_s: float,
    route_steps: list[dict[str, object]],
    road_segments: list[tuple[list[str], float]],
    *,
    avoid_highways: bool,
) -> dict[str, object]:
    highway_roads, highway_distance_m = _collect_highway_roads(road_segments)
    return {
        "provider": provider,
        "geometry": geometry,
        "distance_m": distance_m,
        "duration_s": duration_s,
        "route_steps": route_steps,
        "highway_roads": highway_roads,
        "highway_distance_m": highway_distance_m,
        "avoid_highways": avoid_highways,
    }


def _route_candidate_has_highway(candidate: dict[str, object]) -> bool:
    return float(candidate.get("highway_distance_m") or 0.0) >= _HIGHWAY_MIN_DISTANCE_M


def _read_json_response(request: urllib.request.Request, label: str, timeout_s: float) -> dict[str, object]:
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        raise RuntimeError(f"{label}_http_{exc.code}:{body[:160]}")
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        raise RuntimeError(f"{label}_network:{exc}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{label}_invalid_json:{exc}")


def _request_openrouteservice_route(
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    *,
    avoid_highways: bool,
    timeout_s: float = _ROUTE_PROVIDER_TIMEOUT_S,
) -> list[dict[str, object]]:
    api_key = os.getenv("ORS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ors_api_key_missing")
    payload: dict[str, object] = {
        "coordinates": [[from_lon, from_lat], [to_lon, to_lat]],
        "instructions": True,
        # 既定の"recommended"ではなく、自動車の所要時間優先で問い合わせる
        "preference": "fastest",
    }
    if avoid_highways:
        payload["options"] = {"avoid_features": ["highways"]}
    else:
        # 代替経路も候補として受け取る（ORS側の制限で長距離では返らない場合がある）
        payload["alternative_routes"] = {"target_count": 3, "share_factor": 0.6, "weight_factor": 1.6}
    request = urllib.request.Request(
        _ORS_DIRECTIONS_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "techcard-routing/1.0",
        },
    )
    data = _read_json_response(request, "ors", timeout_s)
    features = data.get("features") or []
    if not features:
        raise RuntimeError("ors_no_route")
    candidates: list[dict[str, object]] = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") != "LineString" or not coordinates:
            continue
        summary = (feature.get("properties") or {}).get("summary") or {}
        distance_m = float(summary.get("distance") or 0.0)
        duration_s = float(summary.get("duration") or 0.0)
        if distance_m <= 0:
            continue
        road_segments: list[tuple[list[str], float]] = []
        for segment in (feature.get("properties") or {}).get("segments") or []:
            if not isinstance(segment, dict):
                continue
            for step in segment.get("steps") or []:
                if isinstance(step, dict):
                    road_segments.append(([str(step.get("name") or "")], float(step.get("distance") or 0.0)))
        candidates.append(
            _make_route_candidate(
                "openrouteservice",
                {"type": "LineString", "coordinates": coordinates},
                distance_m,
                duration_s,
                _extract_ors_route_steps(feature, coordinates),
                road_segments,
                avoid_highways=avoid_highways,
            )
        )
    if not candidates:
        raise RuntimeError("ors_geometry_invalid")
    return candidates


def _request_osrm_route(
    base_url: str,
    provider: str,
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    *,
    avoid_highways: bool,
    timeout_s: float = _ROUTE_PROVIDER_TIMEOUT_S,
) -> list[dict[str, object]]:
    coord_path = f"{from_lon:.6f},{from_lat:.6f};{to_lon:.6f},{to_lat:.6f}"
    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "true",
        # OSRMの自動車プロファイルは所要時間で重み付けされる（距離優先の指定はない）。
        # 県外の高速道路優先のため、代替経路も候補として受け取る
        "alternatives": "false" if avoid_highways else "3",
    }
    if avoid_highways:
        params["exclude"] = "motorway"
    url = f"{base_url}/{coord_path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "techcard-routing/1.0",
        },
    )
    data = _read_json_response(request, provider, timeout_s)
    routes = data.get("routes") or []
    if not routes:
        raise RuntimeError(f"{provider}_no_route")
    candidates: list[dict[str, object]] = []
    for route in routes:
        if not isinstance(route, dict):
            continue
        geometry = route.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") != "LineString" or not coordinates:
            continue
        distance_m = float(route.get("distance") or 0.0)
        duration_s = float(route.get("duration") or 0.0)
        if distance_m <= 0:
            continue
        road_segments: list[tuple[list[str], float]] = []
        for leg in route.get("legs") or []:
            if not isinstance(leg, dict):
                continue
            for step in leg.get("steps") or []:
                if not isinstance(step, dict):
                    continue
                refs = [part for part in re.split(r"[;,]", str(step.get("ref") or "")) if part.strip()]
                road_segments.append(([str(step.get("name") or ""), *refs], float(step.get("distance") or 0.0)))
        candidates.append(
            _make_route_candidate(
                provider,
                {"type": "LineString", "coordinates": coordinates},
                distance_m,
                duration_s,
                _extract_osrm_route_steps(route),
                road_segments,
                avoid_highways=avoid_highways,
            )
        )
    if not candidates:
        raise RuntimeError(f"{provider}_geometry_invalid")
    return candidates


def _decode_polyline6(encoded: str) -> list[list[float]]:
    coordinates: list[list[float]] = []
    index = 0
    lat = 0
    lon = 0
    length = len(encoded)
    while index < length:
        values: list[int] = []
        for _ in range(2):
            shift = 0
            result = 0
            while True:
                if index >= length:
                    return coordinates
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            values.append(~(result >> 1) if result & 1 else (result >> 1))
        lat += values[0]
        lon += values[1]
        coordinates.append([lon / 1e6, lat / 1e6])
    return coordinates


def _valhalla_sign_texts(sign: object, key: str) -> list[str]:
    if not isinstance(sign, dict):
        return []
    texts: list[str] = []
    for element in sign.get(key) or []:
        if isinstance(element, dict):
            text = str(element.get("text") or "").strip()
            if text:
                texts.append(text)
    return texts


def _extract_valhalla_route_steps(
    maneuvers: list[dict[str, object]],
    coordinates: list[list[float]],
) -> list[dict[str, object]]:
    raw_steps: list[dict[str, object]] = []
    for maneuver in maneuvers:
        if not isinstance(maneuver, dict):
            continue
        try:
            point_index = int(maneuver.get("begin_shape_index") or 0)
        except (TypeError, ValueError):
            continue
        if point_index < 0 or point_index >= len(coordinates):
            continue
        lon, lat = coordinates[point_index]
        maneuver_type = maneuver.get("type")
        # Valhallaの操作種別: 17-19=ランプ, 20-21=出口, 22-24=分岐, 25/37/38=合流
        if maneuver_type in (17, 18, 19):
            maneuver_text = "on ramp"
        elif maneuver_type in (20, 21):
            maneuver_text = "off ramp"
        elif maneuver_type in (25, 37, 38):
            maneuver_text = "merge"
        else:
            maneuver_text = ""
        street_names = [str(name) for name in (maneuver.get("street_names") or []) if name]
        road_name = " / ".join(street_names[:3])
        sign = maneuver.get("sign")
        exit_names = _valhalla_sign_texts(sign, "exit_name_elements")
        toward = _valhalla_sign_texts(sign, "exit_toward_elements")
        destinations = (exit_names[:1] or toward[:1] or [""])[0]
        instruction = str(maneuver.get("instruction") or "").strip()
        kind = _classify_route_step_kind(maneuver_text, "", road_name, " ".join(exit_names + toward))
        raw_steps.append(
            {
                "lon": lon,
                "lat": lat,
                "kind": kind,
                "road": road_name or None,
                "label": _build_route_step_label(kind, road_name, destinations, instruction),
                "detail": instruction or None,
            }
        )
    return _normalize_route_steps(raw_steps)


def _request_valhalla_route(
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    *,
    avoid_highways: bool,
    timeout_s: float = _ROUTE_PROVIDER_TIMEOUT_S,
) -> list[dict[str, object]]:
    payload: dict[str, object] = {
        "locations": [{"lat": from_lat, "lon": from_lon}, {"lat": to_lat, "lon": to_lon}],
        "costing": "auto",
        "units": "kilometers",
        "language": "ja-JP",
    }
    if avoid_highways:
        # OSRMの公開サーバーはexclude=motorwayに非対応のため、一般道優先はValhallaのuse_highwaysで表現する
        payload["costing_options"] = {"auto": {"use_highways": 0.0, "shortest": False}}
    else:
        # 距離最短（shortest）ではなく所要時間ベースのコストで探索し、代替経路も候補として受け取る
        payload["costing_options"] = {"auto": {"shortest": False}}
        payload["alternates"] = 3
    # urlencodeは空白を「+」にするがValhallaはJSONとして解釈できない（HTTP 400）ため、空白なしJSONを%エンコードする
    query = "json=" + urllib.parse.quote(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), safe="")
    request = urllib.request.Request(
        f"{_VALHALLA_ROUTE_URL}?{query}",
        headers={
            "Accept": "application/json",
            "User-Agent": "techcard-routing/1.0",
        },
    )
    data = _read_json_response(request, "valhalla", timeout_s)
    trips = [data.get("trip")] + [
        item.get("trip") for item in (data.get("alternates") or []) if isinstance(item, dict)
    ]
    candidates: list[dict[str, object]] = []
    for trip in trips:
        if not isinstance(trip, dict) or trip.get("status") not in (0, None):
            continue
        legs = [leg for leg in (trip.get("legs") or []) if isinstance(leg, dict)]
        if not legs:
            continue
        coordinates: list[list[float]] = []
        maneuvers: list[dict[str, object]] = []
        road_segments: list[tuple[list[str], float]] = []
        for leg in legs:
            leg_coordinates = _decode_polyline6(str(leg.get("shape") or ""))
            offset = len(coordinates)
            coordinates.extend(leg_coordinates)
            for maneuver in leg.get("maneuvers") or []:
                if not isinstance(maneuver, dict):
                    continue
                shifted = dict(maneuver)
                try:
                    shifted["begin_shape_index"] = int(maneuver.get("begin_shape_index") or 0) + offset
                except (TypeError, ValueError):
                    pass
                maneuvers.append(shifted)
                road_segments.append(
                    (
                        [str(name) for name in (maneuver.get("street_names") or []) if name],
                        float(maneuver.get("length") or 0.0) * 1000.0,
                    )
                )
        summary = trip.get("summary") or {}
        distance_m = float(summary.get("length") or 0.0) * 1000.0
        duration_s = float(summary.get("time") or 0.0)
        if distance_m <= 0 or len(coordinates) < 2:
            continue
        candidates.append(
            _make_route_candidate(
                "valhalla_fossgis",
                {"type": "LineString", "coordinates": coordinates},
                distance_m,
                duration_s,
                _extract_valhalla_route_steps(maneuvers, coordinates),
                road_segments,
                avoid_highways=avoid_highways,
            )
        )
    if not candidates:
        raise RuntimeError("valhalla_no_route")
    return candidates


def _collect_route_candidates(
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
    *,
    modes: tuple[bool, ...],
    budget_s: float = _ROUTE_PROVIDER_BUDGET_S,
) -> tuple[list[dict[str, object]], list[str]]:
    # 複数の外部サービスへ並列に問い合わせ、時間予算内に返った候補をすべて集める。
    # 1サービスが失敗・遅延しても、他のサービスの候補で経路を決められる。
    jobs: list[tuple[str, object, tuple, dict]] = []
    for avoid_highways in modes:
        suffix = "avoid" if avoid_highways else "normal"
        common = {"avoid_highways": avoid_highways, "timeout_s": _ROUTE_PROVIDER_TIMEOUT_S}
        coords = (from_lat, from_lon, to_lat, to_lon)
        jobs.append((f"openrouteservice:{suffix}", _request_openrouteservice_route, coords, common))
        jobs.append((f"valhalla_fossgis:{suffix}", _request_valhalla_route, coords, common))
        if not avoid_highways:
            # 公開OSRMはexclude=motorwayに非対応（HTTP 400）のため、一般道優先の問い合わせには使わない
            jobs.append((f"osrm_public:{suffix}", _request_osrm_route, (_OSRM_ROUTE_URL, "osrm_public", *coords), common))
            jobs.append(
                (f"osrm_fossgis:{suffix}", _request_osrm_route, (_FOSSGIS_OSRM_ROUTE_URL, "osrm_fossgis", *coords), common)
            )

    candidates: list[dict[str, object]] = []
    errors: list[str] = []
    started = time.monotonic()
    executor = ThreadPoolExecutor(max_workers=len(jobs))
    futures = {executor.submit(fn, *args, **kwargs): label for label, fn, args, kwargs in jobs}
    done, not_done = wait_futures(list(futures.keys()), timeout=budget_s)
    for future in done:
        label = futures[future]
        try:
            candidates.extend(future.result())
        except Exception as exc:
            errors.append(f"{label}={str(exc)[:160]}")
    for future in not_done:
        errors.append(f"{futures[future]}=budget_timeout_{budget_s:.0f}s")
    executor.shutdown(wait=False, cancel_futures=True)
    route_logger.info(
        "route_candidates elapsed=%.1fs candidates=%d errors=%s",
        time.monotonic() - started,
        len(candidates),
        errors,
    )
    if errors:
        route_logger.warning("route_provider_errors %s", " / ".join(errors))
    return candidates, errors


def _select_route_candidate(
    candidates: list[dict[str, object]],
    *,
    prefer_highway: bool,
    prefer_no_highway: bool,
) -> dict[str, object] | None:
    if not candidates:
        return None

    def by_duration(item: dict[str, object]) -> tuple[float, float]:
        # 推定所要時間（秒）が最小のものを採用する。走行距離は所要時間が同じ場合の比較にだけ使う。
        duration = float(item.get("duration_s") or 0.0)
        return (duration if duration > 0 else float("inf"), float(item.get("distance_m") or 0.0))

    if prefer_highway:
        # 県外: 高速道路を含む候補を対象に、走行距離にかかわらず推定所要時間が最短のものを採用する
        highway_candidates = [item for item in candidates if _route_candidate_has_highway(item)]
        if highway_candidates:
            return min(highway_candidates, key=by_duration)
    if prefer_no_highway:
        local_candidates = [item for item in candidates if not _route_candidate_has_highway(item)]
        if local_candidates:
            return min(local_candidates, key=by_duration)
    return min(candidates, key=by_duration)


def _haversine_distance_m(from_lat: float, from_lon: float, to_lat: float, to_lon: float) -> float:
    earth_radius_m = 6371000.0
    lat1 = math.radians(from_lat)
    lon1 = math.radians(from_lon)
    lat2 = math.radians(to_lat)
    lon2 = math.radians(to_lon)
    d_lat = lat2 - lat1
    d_lon = lon2 - lon1
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * (math.sin(d_lon / 2) ** 2)
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(max(1e-12, 1 - a)))
    return earth_radius_m * c


def _fallback_straight_route(
    from_lat: float,
    from_lon: float,
    to_lat: float,
    to_lon: float,
) -> tuple[dict[str, object], float, float | None, list[dict[str, object]]]:
    distance_m = _haversine_distance_m(from_lat, from_lon, to_lat, to_lon)
    geometry = {
        "type": "LineString",
        "coordinates": [[from_lon, from_lat], [to_lon, to_lat]],
    }
    return geometry, distance_m, None, []


def _estimate_display_duration_s(
    distance_m: float,
    duration_s: float | None,
    *,
    effective_mode: str,
    provider: str,
) -> float | None:
    if duration_s is None:
        return None
    if duration_s <= 0:
        return None
    if provider == "fallback_straight":
        return duration_s

    distance_km = max(0.0, distance_m / 1000.0)
    is_intra_pref = effective_mode.startswith("intra_pref")
    if not is_intra_pref:
        # 県外は従来どおり生値を採用（補正なし）
        return duration_s

    # 県内移動は信号待ち・右左折・市街地混雑の影響をより強めに補正
    factor = 1.28
    penalty_min = min(10.0, max(3.0, 3.8 + distance_km * 0.40))

    adjusted = (duration_s * factor) + (penalty_min * 60.0)
    min_bump = 240.0 if distance_km >= 3 else 120.0
    adjusted = max(duration_s + min_bump, adjusted)
    adjusted = min(adjusted, (duration_s * 1.60) + 900.0)
    return adjusted


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    contacts = (
        db.query(models.Contact)
        .order_by(models.Contact.name.asc())
        .all()
    )
    companies = (
        db.query(
            models.Company.name.label("name"),
            func.count(models.Contact.id).label("contact_count"),
        )
        .join(models.Contact, models.Contact.company_id == models.Company.id, isouter=True)
        .group_by(models.Company.id)
        .having(func.count(models.Contact.id) > 0)
        .order_by(func.count(models.Contact.id).desc(), models.Company.name.asc())
        .all()
    )
    tags = (
        db.query(
            models.Tag.name.label("name"),
            func.count(models.contact_tags.c.contact_id).label("contact_count"),
        )
        .join(models.contact_tags, models.contact_tags.c.tag_id == models.Tag.id, isouter=True)
        .group_by(models.Tag.id)
        .having(func.count(models.contact_tags.c.contact_id) > 0)
        .order_by(func.count(models.contact_tags.c.contact_id).desc(), models.Tag.name.asc())
        .all()
    )
    self_contact = (
        db.query(models.Contact)
        .options(
            joinedload(models.Contact.tags),
            joinedload(models.Contact.tech_tags),
            joinedload(models.Contact.company).joinedload(models.Company.tech_tags),
            joinedload(models.Contact.company).joinedload(models.Company.group).joinedload(models.CompanyGroup.tags),
        )
        .filter(models.Contact.is_self.is_(True))
        .first()
    )
    self_person_tag_keys = _collect_tag_keys(
        self_contact.tags if self_contact else None,
        self_contact.tech_tags if self_contact else None,
    )
    self_company_tag_keys = _collect_tag_keys(
        self_contact.company.tech_tags if self_contact and self_contact.company else None,
        self_contact.company.group.tags
        if self_contact and self_contact.company and self_contact.company.group
        else None,
    )

    connection_contacts = (
        db.query(models.Contact)
        .options(
            joinedload(models.Contact.tags),
            joinedload(models.Contact.tech_tags),
            joinedload(models.Contact.company),
            joinedload(models.Contact.company).joinedload(models.Company.tech_tags),
            joinedload(models.Contact.company).joinedload(models.Company.group).joinedload(models.CompanyGroup.tags),
        )
        .all()
    )

    connection_items = []
    for contact in connection_contacts:
        if contact.is_self:
            continue
        contact_person_tag_keys = _collect_tag_keys(contact.tags, contact.tech_tags)
        contact_company_tag_keys = _collect_tag_keys(
            contact.company.tech_tags if contact.company else None,
            contact.company.group.tags if contact.company and contact.company.group else None,
        )
        overlap_keys = set()
        if self_person_tag_keys:
            overlap_keys |= self_person_tag_keys & contact_person_tag_keys
        if self_company_tag_keys:
            overlap_keys |= self_company_tag_keys & contact_person_tag_keys
            overlap_keys |= self_company_tag_keys & contact_company_tag_keys
        overlap = len(overlap_keys)
        if overlap <= 0:
            continue
        connection_items.append(
            {
                "id": contact.id,
                "contact_name": contact.name,
                "company_name": contact.company.name if contact.company else None,
                "overlap": overlap,
            }
        )

    connection_items.sort(
        key=lambda item: (item["overlap"], item["contact_name"] or "", item["id"]),
        reverse=True,
    )

    contact_payload = [{"id": contact.id, "name": contact.name} for contact in contacts]
    company_payload = [{"name": row.name, "count": row.contact_count} for row in companies]
    tag_payload = [{"name": row.name, "count": row.contact_count} for row in tags]
    meeting_payload = connection_items
    prefecture_counts: dict[str, int] = {}
    counted_company_prefectures: set[tuple[str, str]] = set()
    for contact in connection_contacts:
        if not contact.company or not contact.company.name:
            continue
        prefecture = _extract_prefecture(contact.address) or _extract_prefecture(contact.company.address)
        if not prefecture:
            continue
        key = (contact.company.name.strip().lower(), prefecture)
        if key in counted_company_prefectures:
            continue
        counted_company_prefectures.add(key)
        prefecture_counts[prefecture] = prefecture_counts.get(prefecture, 0) + 1
    prefecture_payload = [
        {"name": name, "count": count}
        for name, count in sorted(prefecture_counts.items(), key=lambda item: (-item[1], item[0]))
    ]
    connectable_contacts = sum(1 for contact in contacts if not contact.is_self)
    connected_contacts = len(meeting_payload)
    connection_rate = (
        round((connected_contacts / connectable_contacts) * 100, 1)
        if connectable_contacts > 0
        else 0.0
    )

    return {
        "counts": {
            "contacts": len(contact_payload),
            "companies": len(company_payload),
            "prefectures": len(prefecture_payload),
            "tags": len(tag_payload),
            "meetings": len(meeting_payload),
            "connectable_contacts": connectable_contacts,
            "connected_contacts": connected_contacts,
            "connection_rate": connection_rate,
        },
        "lists": {
            "contacts": contact_payload,
            "companies": company_payload,
            "prefectures": prefecture_payload,
            "tags": tag_payload,
            "meetings": meeting_payload,
        },
    }


@router.get("/company-route")
def get_company_route(
    to_company_id: int = Query(..., ge=1),
    to_lat: float | None = Query(default=None),
    to_lon: float | None = Query(default=None),
    to_address: str | None = Query(default=None),
    refresh: bool = Query(False),
    db: Session = Depends(get_db),
):
    self_contact = (
        db.query(models.Contact)
        .options(joinedload(models.Contact.company))
        .filter(models.Contact.is_self.is_(True))
        .filter(models.Contact.company_id.isnot(None))
        .first()
    )
    if self_contact is None or self_contact.company is None:
        raise HTTPException(status_code=404, detail="自分の所属会社が見つかりません。")

    from_company = self_contact.company
    to_company = db.query(models.Company).filter(models.Company.id == to_company_id).first()
    if to_company is None:
        raise HTTPException(status_code=404, detail="対象会社が見つかりません。")
    if from_company.id == to_company.id:
        raise HTTPException(status_code=400, detail="自社へのルートは不要です。")

    if from_company.latitude is None or from_company.longitude is None:
        raise HTTPException(status_code=400, detail="自社の座標が未設定です。")
    has_target_lat = to_lat is not None
    has_target_lon = to_lon is not None
    if has_target_lat != has_target_lon:
        raise HTTPException(status_code=400, detail="to_lat と to_lon は両方指定してください。")
    if has_target_lat and has_target_lon:
        if not math.isfinite(float(to_lat)) or not math.isfinite(float(to_lon)):
            raise HTTPException(status_code=400, detail="to_lat / to_lon が不正です。")
        target_lat = float(to_lat)
        target_lon = float(to_lon)
    else:
        if to_company.latitude is None or to_company.longitude is None:
            raise HTTPException(status_code=400, detail="対象会社の座標が未設定です。")
        target_lat = float(to_company.latitude)
        target_lon = float(to_company.longitude)

    from_lat = float(from_company.latitude)
    from_lon = float(from_company.longitude)
    coord_key = _coord_key(from_lat, from_lon, target_lat, target_lon)
    target_address = (to_address or to_company.address or "").strip() or None

    from_prefecture = _extract_prefecture(from_company.address)
    to_prefecture = _extract_prefecture(target_address)
    same_prefecture = bool(from_prefecture and to_prefecture and from_prefecture == to_prefecture)
    policy = "intra_pref_local" if same_prefecture else "inter_pref_mixed"

    cache = (
        db.query(models.CompanyRouteCache)
        .filter(models.CompanyRouteCache.from_company_id == from_company.id)
        .filter(models.CompanyRouteCache.to_company_id == to_company.id)
        .filter(models.CompanyRouteCache.policy == policy)
        .first()
    )
    cached_steps_available = _has_cached_route_steps(cache.steps_json) if cache is not None else False
    valid_cached_modes = _INTRA_PREF_ROUTE_MODES if same_prefecture else _INTER_PREF_ROUTE_MODES
    if (
        cache is not None
        and not refresh
        and cache.coord_key == coord_key
        and cached_steps_available
        and (cache.provider or "") != "fallback_straight"
        # 旧ロジックで作られたキャッシュ（例: 県外のinter_pref_mixed）は使わず、新しい経路選択で再計算する
        and (cache.effective_mode or "") in valid_cached_modes
    ):
        try:
            geometry = json.loads(cache.geometry_json)
        except json.JSONDecodeError:
            geometry = None
        route_steps: list[dict[str, object]] = []
        try:
            cached_steps = json.loads(cache.steps_json) if cache.steps_json else []
            if isinstance(cached_steps, list):
                route_steps = cached_steps
        except json.JSONDecodeError:
            route_steps = []
        route_steps, enriched = _enrich_route_steps_with_ic_jct_names(route_steps)
        if enriched:
            cache.steps_json = json.dumps(route_steps, ensure_ascii=False)
            cache.updated_at = datetime.utcnow()
            db.add(cache)
            db.commit()
        if geometry:
            raw_duration_s = cache.duration_s
            effective_mode = cache.effective_mode or policy
            display_duration_s = _estimate_display_duration_s(
                cache.distance_m,
                raw_duration_s,
                effective_mode=effective_mode,
                provider=cache.provider or "openrouteservice",
            )
            # キャッシュには道路別距離を保持していないため、経路ステップの道路名から高速道路名を復元する
            # （計算時と同じ整形を通すため、出現順を保つよう各ステップに逓減する仮の距離を与える）
            step_road_names: list[tuple[list[str], float]] = []
            for order, step in enumerate(route_steps):
                if not isinstance(step, dict):
                    continue
                names = [
                    name
                    for name in re.split(r"\s*[/,、]\s*", str(step.get("road") or ""))
                    if name and _IC_JCT_NAME_PATTERN.search(name) is None and not re.search(r"(入口|出口)$", name)
                ]
                if names:
                    step_road_names.append((names, float(len(route_steps) - order)))
            cached_highway_roads, _ = _collect_highway_roads(step_road_names)
            return {
                "from_company_id": from_company.id,
                "from_company_name": from_company.name,
                "to_company_id": to_company.id,
                "to_company_name": to_company.name,
                "to_company_address": target_address,
                "from_prefecture": from_prefecture,
                "to_prefecture": to_prefecture,
                "policy": policy,
                "effective_mode": effective_mode,
                "distance_m": cache.distance_m,
                "distance_km": round(cache.distance_m / 1000, 2),
                "duration_s_raw": raw_duration_s,
                "duration_min_raw": round((raw_duration_s or 0.0) / 60, 1) if raw_duration_s else None,
                "duration_s": display_duration_s,
                "duration_min": round(display_duration_s / 60, 1) if display_duration_s else None,
                "geometry": geometry,
                "route_steps": route_steps,
                "highway_roads": cached_highway_roads[:8],
                "has_highway": effective_mode == "inter_pref_highway" or bool(cached_highway_roads),
                "fallback_reason": None,
                "cached": True,
                "provider": cache.provider or "openrouteservice",
                "updated_at": cache.updated_at.isoformat() if cache.updated_at else None,
            }

    # 県内は一般道優先（高速回避）の候補を優先し、取れなければ通常ルートへ。
    # 2段階を直列にすると時間予算を超えるため、両方を同時に問い合わせる。
    modes: tuple[bool, ...] = (True, False) if same_prefecture else (False,)
    candidates, provider_errors = _collect_route_candidates(
        from_lat,
        from_lon,
        target_lat,
        target_lon,
        modes=modes,
    )
    # 比較した候補（距離・推定所要時間・高速道路）をログに残し、採用理由を後から確認できるようにする
    for candidate in sorted(candidates, key=lambda item: float(item.get("duration_s") or 0.0)):
        route_logger.info(
            "route_candidate to_company_id=%s provider=%s avoid=%s distance_km=%.1f duration_s=%.0f highway_km=%.1f highway=%s",
            to_company.id,
            candidate.get("provider"),
            bool(candidate.get("avoid_highways")),
            float(candidate.get("distance_m") or 0.0) / 1000,
            float(candidate.get("duration_s") or 0.0),
            float(candidate.get("highway_distance_m") or 0.0) / 1000,
            list(candidate.get("highway_roads") or [])[:4],  # type: ignore[arg-type]
        )
    selected: dict[str, object] | None
    if same_prefecture:
        selected = _select_route_candidate(
            [item for item in candidates if item.get("avoid_highways")],
            prefer_highway=False,
            prefer_no_highway=True,
        )
        effective_mode = "intra_pref_local"
        if selected is None:
            selected = _select_route_candidate(
                [item for item in candidates if not item.get("avoid_highways")],
                prefer_highway=False,
                prefer_no_highway=False,
            )
            effective_mode = "intra_pref_local_fallback"
    else:
        selected = _select_route_candidate(candidates, prefer_highway=True, prefer_no_highway=False)
        effective_mode = "inter_pref_highway" if selected and _route_candidate_has_highway(selected) else "inter_pref_road"

    fallback_reason: str | None = None
    highway_roads: list[str] = []
    if selected is not None:
        provider = str(selected["provider"])
        geometry = selected["geometry"]  # type: ignore[assignment]
        distance_m = float(selected["distance_m"])
        duration_s = float(selected["duration_s"]) if selected.get("duration_s") else None
        route_steps = list(selected["route_steps"])  # type: ignore[arg-type]
        highway_roads = list(selected.get("highway_roads") or [])  # type: ignore[arg-type]
        route_logger.info(
            "route_selected to_company_id=%s mode=%s provider=%s distance_km=%.1f duration_min=%.1f highway=%s candidates=%d",
            to_company.id,
            effective_mode,
            provider,
            distance_m / 1000,
            (duration_s or 0.0) / 60,
            highway_roads[:4],
            len(candidates),
        )
    else:
        geometry, distance_m, duration_s, route_steps = _fallback_straight_route(
            from_lat,
            from_lon,
            target_lat,
            target_lon,
        )
        effective_mode = "intra_pref_straight_fallback" if same_prefecture else "inter_pref_straight_fallback"
        provider = "fallback_straight"
        fallback_reason = " / ".join(provider_errors) if provider_errors else "route_provider_failed"
        route_logger.warning(
            "route_straight_fallback to_company_id=%s reason=%s",
            to_company.id,
            fallback_reason,
        )

    route_steps, _ = _enrich_route_steps_with_ic_jct_names(route_steps)

    if cache is None:
        cache = models.CompanyRouteCache(
            from_company_id=from_company.id,
            to_company_id=to_company.id,
            policy=policy,
        )
    cache.coord_key = coord_key
    cache.provider = provider
    cache.effective_mode = effective_mode
    cache.distance_m = distance_m
    cache.duration_s = duration_s
    cache.geometry_json = json.dumps(geometry, ensure_ascii=False)
    cache.steps_json = json.dumps(route_steps, ensure_ascii=False)
    cache.updated_at = datetime.utcnow()
    db.add(cache)
    db.commit()

    display_duration_s = _estimate_display_duration_s(
        distance_m,
        duration_s,
        effective_mode=effective_mode,
        provider=provider,
    )

    return {
        "from_company_id": from_company.id,
        "from_company_name": from_company.name,
        "to_company_id": to_company.id,
        "to_company_name": to_company.name,
        "to_company_address": target_address,
        "from_prefecture": from_prefecture,
        "to_prefecture": to_prefecture,
        "policy": policy,
        "effective_mode": effective_mode,
        "distance_m": distance_m,
        "distance_km": round(distance_m / 1000, 2),
        "duration_s_raw": duration_s,
        "duration_min_raw": round(duration_s / 60, 1) if duration_s else None,
        "duration_s": display_duration_s,
        "duration_min": round(display_duration_s / 60, 1) if display_duration_s else None,
        "geometry": geometry,
        "route_steps": route_steps,
        "highway_roads": highway_roads,
        "has_highway": bool(selected is not None and _route_candidate_has_highway(selected)),
        "fallback_reason": fallback_reason,
        "cached": False,
        "provider": provider,
        "updated_at": cache.updated_at.isoformat() if cache.updated_at else None,
    }


@router.get("/network")
def get_network(
    technology: str | None = Query(default=None),
    company: str | None = Query(default=None),
    person: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    contacts = (
        db.query(models.Contact)
        .options(
            joinedload(models.Contact.company).joinedload(models.Company.group).joinedload(models.CompanyGroup.tags),
            joinedload(models.Contact.company).joinedload(models.Company.tech_tags),
            joinedload(models.Contact.tags),
            joinedload(models.Contact.tech_tags),
            joinedload(models.Contact.business_cards),
        )
        .all()
    )

    tag_rows = db.query(models.Tag).all()
    tag_by_id = {tag.id: tag for tag in tag_rows}

    nodes: list[dict[str, object]] = []
    edges: list[dict[str, object]] = []
    node_ids: set[str] = set()
    edge_keys: set[tuple[str, str, str]] = set()

    def add_node(payload: dict[str, object]) -> None:
        node_id = payload["id"]
        if node_id in node_ids:
            return
        nodes.append(payload)
        node_ids.add(node_id)

    def add_edge(source: str, target: str, edge_type: str) -> None:
        key = (source, target, edge_type)
        if key in edge_keys:
            return
        edges.append({"source": source, "target": target, "type": edge_type})
        edge_keys.add(key)

    def normalize_tag_type(value: str | None) -> str:
        if not value:
            return "relation"
        if value in ("tech", "technology"):
            return "tech"
        if value == "event":
            return "event"
        return "relation"

    tech_filter = technology.strip().lower() if technology else None
    company_filter = company.strip().lower() if company else None
    person_filter = person.strip().lower() if person else None

    if tech_filter:
        contacts = [
            contact
            for contact in contacts
            if any(
                tag.name and tech_filter in tag.name.lower()
                for tag in (contact.tech_tags or [])
                if normalize_tag_type(tag.type) == "tech"
            )
            or any(
                tag.name and tech_filter in tag.name.lower()
                for tag in (contact.tags or [])
                if normalize_tag_type(tag.type) == "tech"
            )
        ]
    if company_filter:
        contacts = [
            contact
            for contact in contacts
            if contact.company and contact.company.name and company_filter in contact.company.name.lower()
        ]
    if person_filter:
        contacts = [
            contact
            for contact in contacts
            if contact.name and person_filter in contact.name.lower()
        ]

    contact_id_set = {contact.id for contact in contacts}

    # Company + Group nodes
    companies = {contact.company for contact in contacts if contact.company}
    company_contact_counts: dict[int, int] = {}
    for contact in contacts:
        if contact.company_id is None:
            continue
        company_contact_counts[contact.company_id] = company_contact_counts.get(contact.company_id, 0) + 1

    group_company_ids: dict[int, set[int]] = {}
    group_by_id: dict[int, models.CompanyGroup] = {}

    for company in companies:
        if company.group_id is not None:
            group_company_ids.setdefault(company.group_id, set()).add(company.id)
        if company.group is not None:
            group_by_id[company.group.id] = company.group
        add_node(
            {
                "id": f"company_{company.id}",
                "type": "company",
                "label": company.name or "",
                "size": company_contact_counts.get(company.id, 1),
                "postal_code": company.postal_code,
                "address": company.address,
                "group_id": f"group_{company.group_id}" if company.group_id else None,
            }
        )
        if company.group:
            add_node(
                {
                    "id": f"group_{company.group.id}",
                    "type": "group",
                    "label": company.group.name or "",
                    "size": len(company.group.companies or []),
                }
            )
            add_edge(f"company_{company.id}", f"group_{company.group.id}", "company_group")

    # Contact nodes + edges
    for contact in contacts:
        contact_id = f"contact_{contact.id}"
        add_node(
            {
                "id": contact_id,
                "type": "contact",
                "label": contact.name or "",
                "size": len(contact.business_cards or []) or 1,
                "company_node_id": f"company_{contact.company_id}" if contact.company_id else None,
                "role": contact.role,
                "email": contact.email,
                "phone": contact.phone,
                "mobile": contact.mobile,
                "notes": contact.notes,
                "is_self": contact.is_self,
            }
        )
        if contact.company_id is not None:
            add_edge(contact_id, f"company_{contact.company_id}", "employment")

    # Event hierarchy (#Cards / #Expo / #Mixer / #OJT)
    self_contact = next((contact for contact in contacts if contact.is_self), None)
    self_contact_node_id = f"contact_{self_contact.id}" if self_contact else None
    self_company_node_id = (
        f"company_{self_contact.company_id}"
        if self_contact is not None and self_contact.company_id is not None
        else None
    )

    top_counts: dict[str, int] = {}
    sub_counts: dict[str, int] = {}
    event_meta_by_key: dict[str, tuple[str, str]] = {}
    contact_event_keys: dict[int, set[str]] = {}
    company_event_keys: dict[int, set[str]] = {}
    company_event_key_sources: dict[tuple[int, str], str] = {}
    company_direct_event_keys: dict[int, set[str]] = {}
    group_event_keys: dict[int, set[str]] = {}

    for contact in contacts:
        keys: set[str] = set()
        for tag in contact.tags or []:
            if normalize_tag_type(tag.type) != "event":
                continue
            parsed = _parse_event_tag_name(tag.name)
            if parsed is None:
                continue
            top_name, sub_name = parsed
            key = _event_key(top_name, sub_name)
            event_meta_by_key[key] = (top_name, sub_name)
            keys.add(key)
        if keys:
            contact_event_keys[contact.id] = keys

    for company in companies:
        keys: set[str] = set()
        for tag in company.tech_tags or []:
            if normalize_tag_type(tag.type) != "event":
                continue
            parsed = _parse_event_tag_name(tag.name)
            if parsed is None:
                continue
            top_name, sub_name = parsed
            key = _event_key(top_name, sub_name)
            event_meta_by_key[key] = (top_name, sub_name)
            keys.add(key)
        if keys:
            company_direct_event_keys[company.id] = keys

    for group_id, group in group_by_id.items():
        keys: set[str] = set()
        for tag in group.tags or []:
            if normalize_tag_type(tag.type) != "event":
                continue
            parsed = _parse_event_tag_name(tag.name)
            if parsed is None:
                continue
            top_name, sub_name = parsed
            key = _event_key(top_name, sub_name)
            event_meta_by_key[key] = (top_name, sub_name)
            keys.add(key)
        if keys:
            group_event_keys[group_id] = keys

    for company in companies:
        keys: set[str] = set()
        direct_keys = company_direct_event_keys.get(company.id, set())
        for key in direct_keys:
            keys.add(key)
            company_event_key_sources[(company.id, key)] = "company"
        if company.group_id is not None:
            for key in group_event_keys.get(company.group_id, set()):
                if key in keys:
                    continue
                keys.add(key)
                company_event_key_sources[(company.id, key)] = "group"
        if keys:
            company_event_keys[company.id] = keys

    self_person_event_keys = (
        contact_event_keys.get(self_contact.id, set())
        if self_contact is not None
        else set()
    )
    self_company_event_keys = (
        company_event_keys.get(self_contact.company_id or -1, set())
        if self_contact is not None and self_contact.company_id is not None
        else set()
    )

    def ensure_event_top_node(top_name: str, source_scope: str) -> str:
        scope = "company" if source_scope == "company" else "person"
        top_id = f"event_top_{scope}_{top_name.lower()}"
        if top_id not in node_ids:
            add_node(
                {
                    "id": top_id,
                    "type": "event",
                    "label": _EVENT_TOP_LABELS.get(top_name, top_name),
                    "size": 1,
                }
            )
        return top_id

    def ensure_event_sub_node(event_key: str, sub_name: str) -> str:
        digest = hashlib.md5(event_key.encode("utf-8")).hexdigest()[:12]
        sub_id = f"event_sub_{digest}"
        if sub_id not in node_ids:
            add_node(
                {
                    "id": sub_id,
                    "type": "event",
                    "label": sub_name,
                    "size": 1,
                }
            )
        return sub_id

    # 個人参加: 自分(個人) -> Event上位 -> Event下位 -> 相手個人
    if self_contact_node_id and self_person_event_keys:
        for contact in contacts:
            if self_contact is not None and contact.id == self_contact.id:
                continue
            matched = sorted(contact_event_keys.get(contact.id, set()) & self_person_event_keys)
            for event_key in matched:
                meta = event_meta_by_key.get(event_key)
                if meta is None:
                    continue
                top_name, sub_name = meta
                top_id = ensure_event_top_node(top_name, "person")
                sub_id = ensure_event_sub_node(event_key, sub_name)
                add_edge(self_contact_node_id, top_id, "event_attendance")
                add_edge(top_id, sub_id, "relation_event")
                add_edge(sub_id, f"contact_{contact.id}", "event_attendance")
                top_counts[top_id] = top_counts.get(top_id, 0) + 1
                sub_counts[sub_id] = sub_counts.get(sub_id, 0) + 1

    # 会社参加: 自分の会社 -> Event上位 -> Event下位 -> 相手個人 or 相手会社（タグ保持側）
    if self_company_node_id and self_company_event_keys:
        for contact in contacts:
            if self_contact is not None and contact.id == self_contact.id:
                continue
            matched = sorted(contact_event_keys.get(contact.id, set()) & self_company_event_keys)
            for event_key in matched:
                meta = event_meta_by_key.get(event_key)
                if meta is None:
                    continue
                top_name, sub_name = meta
                top_id = ensure_event_top_node(top_name, "company")
                sub_id = ensure_event_sub_node(event_key, sub_name)
                add_edge(self_company_node_id, top_id, "company_event")
                add_edge(top_id, sub_id, "relation_event")
                add_edge(sub_id, f"contact_{contact.id}", "event_attendance")
                top_counts[top_id] = top_counts.get(top_id, 0) + 1
                sub_counts[sub_id] = sub_counts.get(sub_id, 0) + 1

        for company in companies:
            if self_contact is not None and company.id == self_contact.company_id:
                continue
            matched = sorted(company_event_keys.get(company.id, set()) & self_company_event_keys)
            for event_key in matched:
                meta = event_meta_by_key.get(event_key)
                if meta is None:
                    continue
                top_name, sub_name = meta
                top_id = ensure_event_top_node(top_name, "company")
                sub_id = ensure_event_sub_node(event_key, sub_name)
                add_edge(self_company_node_id, top_id, "company_event")
                add_edge(top_id, sub_id, "relation_event")
                source_scope = company_event_key_sources.get((company.id, event_key), "company")
                if source_scope == "group" and company.group_id is not None:
                    add_edge(sub_id, f"group_{company.group_id}", "company_event")
                else:
                    add_edge(sub_id, f"company_{company.id}", "company_event")
                top_counts[top_id] = top_counts.get(top_id, 0) + 1
                sub_counts[sub_id] = sub_counts.get(sub_id, 0) + 1

    if top_counts or sub_counts:
        for node in nodes:
            node_id = node.get("id")
            if not isinstance(node_id, str):
                continue
            if node_id in top_counts:
                node["size"] = max(top_counts[node_id], 1)
            if node_id in sub_counts:
                node["size"] = max(sub_counts[node_id], 1)

    # Tags
    relation_tag_counts: dict[int, int] = {}
    company_relation_tag_company_counts: dict[int, set[int]] = {}
    company_relation_tag_group_counts: dict[int, set[int]] = {}
    contact_tech_tag_counts: dict[int, int] = {}
    company_tech_tag_company_counts: dict[int, set[int]] = {}
    company_tech_tag_group_counts: dict[int, set[int]] = {}
    company_direct_tech_tag_ids: dict[int, set[int]] = {}
    company_direct_relation_tag_ids: dict[int, set[int]] = {}

    for company in companies:
        for tag in company.tech_tags or []:
            tag_type = normalize_tag_type(tag.type)
            if tag_type == "tech":
                company_direct_tech_tag_ids.setdefault(company.id, set()).add(tag.id)
                company_tech_tag_company_counts.setdefault(tag.id, set()).add(company.id)
            elif tag_type == "relation":
                company_direct_relation_tag_ids.setdefault(company.id, set()).add(tag.id)
                company_relation_tag_company_counts.setdefault(tag.id, set()).add(company.id)

    for group_id, group in group_by_id.items():
        member_company_ids = group_company_ids.get(group_id, set())
        if not member_company_ids:
            continue
        for tag in group.tags or []:
            tag_type = normalize_tag_type(tag.type)
            if tag_type == "tech":
                has_company_without_tag = any(
                    tag.id not in company_direct_tech_tag_ids.get(company_id, set())
                    for company_id in member_company_ids
                )
                if has_company_without_tag:
                    company_tech_tag_group_counts.setdefault(tag.id, set()).add(group_id)
            elif tag_type == "relation":
                has_company_without_tag = any(
                    tag.id not in company_direct_relation_tag_ids.get(company_id, set())
                    for company_id in member_company_ids
                )
                if has_company_without_tag:
                    company_relation_tag_group_counts.setdefault(tag.id, set()).add(group_id)

    for contact in contacts:
        for tag in contact.tags or []:
            tag_type = normalize_tag_type(tag.type)
            if tag_type == "relation":
                relation_tag_counts[tag.id] = relation_tag_counts.get(tag.id, 0) + 1
                add_node(
                    {
                        "id": f"relation_{tag.id}",
                        "type": "relation",
                        "label": tag.name or "",
                        "size": relation_tag_counts[tag.id],
                    }
                )
                add_edge(f"contact_{contact.id}", f"relation_{tag.id}", "relation")
            elif tag_type == "tech":
                contact_tech_tag_counts[tag.id] = contact_tech_tag_counts.get(tag.id, 0) + 1
                add_edge(f"contact_{contact.id}", f"tech_contact_{tag.id}", "contact_tech")

        for tag in contact.tech_tags or []:
            tag_type = normalize_tag_type(tag.type)
            if tag_type != "tech":
                continue
            contact_tech_tag_counts[tag.id] = contact_tech_tag_counts.get(tag.id, 0) + 1
            add_edge(f"contact_{contact.id}", f"tech_contact_{tag.id}", "contact_tech")

    all_company_relation_tag_ids = set(company_relation_tag_company_counts.keys()) | set(company_relation_tag_group_counts.keys())
    for tag_id in all_company_relation_tag_ids:
        tag = tag_by_id.get(tag_id)
        label = tag.name if tag else ""
        company_ids = company_relation_tag_company_counts.get(tag_id, set())
        group_ids = company_relation_tag_group_counts.get(tag_id, set())
        add_node(
            {
                "id": f"relation_{tag_id}",
                "type": "relation",
                "label": label if label else "関係タグ",
                "size": max(relation_tag_counts.get(tag_id, 0), len(company_ids), len(group_ids), 1),
            }
        )
        for company_id in company_ids:
            add_edge(f"company_{company_id}", f"relation_{tag_id}", "company_relation")
        for group_id in group_ids:
            add_edge(f"group_{group_id}", f"relation_{tag_id}", "company_relation")

    all_contact_tech_tag_ids = set(contact_tech_tag_counts.keys())
    all_company_tech_tag_ids = set(company_tech_tag_company_counts.keys()) | set(company_tech_tag_group_counts.keys())

    for tag_id in all_contact_tech_tag_ids:
        tag = tag_by_id.get(tag_id)
        label = tag.name if tag else ""
        contact_label = label if label else "技術タグ"
        add_node(
            {
                "id": f"tech_contact_{tag_id}",
                "type": "tech",
                "label": contact_label,
                "size": max(contact_tech_tag_counts.get(tag_id, 0), 1),
            }
        )

    for tag_id in all_company_tech_tag_ids:
        company_ids = company_tech_tag_company_counts.get(tag_id, set())
        group_ids = company_tech_tag_group_counts.get(tag_id, set())
        tag = tag_by_id.get(tag_id)
        label = tag.name if tag else ""
        company_label = label if label else "技術タグ"
        add_node(
            {
                "id": f"tech_company_{tag_id}",
                "type": "tech",
                "label": company_label,
                "size": max(len(company_ids), len(group_ids), 1),
            }
        )
        for company_id in company_ids:
            add_edge(f"company_{company_id}", f"tech_company_{tag_id}", "company_tech")
        for group_id in group_ids:
            add_edge(f"group_{group_id}", f"tech_company_{tag_id}", "group_tech")

    for tag_id in all_contact_tech_tag_ids & all_company_tech_tag_ids:
        add_edge(f"tech_company_{tag_id}", f"tech_contact_{tag_id}", "tech_bridge")

    return {"nodes": nodes, "edges": edges}


def _request_json(url: str, headers: dict[str, str], timeout: int = 10, retries: int = 3, label: str = ""):
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            reason = "timeout" if isinstance(exc, socket.timeout) or "timed out" in str(exc).lower() else "error"
            logger.warning("[geocode %s %s] %s", label or "request", reason, exc)
            if attempt >= retries:
                return None
            time.sleep(1.1)
    return None


def _zipcloud_lookup(postal_code: str):
    cleaned = re.sub(r"[^0-9]", "", postal_code or "")
    if len(cleaned) != 7:
        return None
    url = f"https://zipcloud.ibsnet.co.jp/api/search?zipcode={cleaned}"
    data = _request_json(
        url,
        headers={"User-Agent": "techcard-geocoder/1.0 (contact@techcard.local)"},
        timeout=10,
        retries=3,
        label="zipcloud",
    )
    if not data:
        return None
    if data.get("status") != 200:
        logger.warning("[geocode zipcloud error] %s", data.get("message") or "status not 200")
        return None
    results = data.get("results") or []
    if not results:
        return None
    top = results[0]
    logger.info(
        "[zipcloud result] %s %s%s%s",
        cleaned,
        top.get("address1", ""),
        top.get("address2", ""),
        top.get("address3", ""),
    )
    return top


def _build_address_from_zipcloud(result: dict) -> str:
    return f"{result.get('address1','')}{result.get('address2','')}{result.get('address3','')}".strip()


def _normalize_postal(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def _normalize_address(value: str) -> str:
    if not value:
        return ""
    cleaned = value.replace("　", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"\s*\d+\s*(F|Ｆ|階|フロア)\b.*$", "", cleaned)
    building_match = re.search(
        r"^(.*?)(\s*(ビル|タワー|別館|号館|本館|支店|営業所|工場|センター|研究所|プラザ|ビルディング|棟|館).*)$",
        cleaned,
    )
    if building_match:
        cleaned = building_match.group(1).strip()
    return cleaned


def _normalize_address_to_lot_base(value: str) -> str:
    normalized = _normalize_address(value)
    if not normalized:
        return ""
    # 1843-6 -> 1843
    lot_base = re.sub(r"([0-9]+)[-ー−‐－][0-9]+.*$", r"\1", normalized)
    # 5317番地 / 5317番12号 -> 5317
    lot_base = re.sub(r"([0-9]+)番地?[0-9]*(?:号)?$", r"\1", lot_base)
    lot_base = re.sub(r"\s+", " ", lot_base).strip()
    return lot_base


def _geocode_nominatim(query: str):
    if not query:
        return None
    logger.info("[nominatim query] %s", query)
    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "json",
            "limit": 1,
            "countrycodes": "jp",
            "accept-language": "ja",
            "addressdetails": 1,
        }
    )
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    data = _request_json(
        url,
        headers={"User-Agent": "techcard-geocoder/1.0 (contact@techcard.local)"},
        timeout=10,
        retries=3,
        label="nominatim",
    )
    if not data:
        return None
    top = data[0] if isinstance(data, list) and data else None
    if not top:
        return None
    try:
        lat = float(top.get("lat"))
        lon = float(top.get("lon"))
    except (TypeError, ValueError):
        return None
    if lat == 0 or lon == 0:
        return None
    logger.info("[nominatim success] %s lat=%s lon=%s", query, lat, lon)
    return lat, lon


def _extract_city(address: str) -> str:
    if not address:
        return ""
    match = re.search(r"(東京都|北海道|(?:京都|大阪)府|.{2}県)([^0-9\\s]{1,12}?(市|区|町|村))", address)
    if match:
        return match.group(2)
    return ""


def _geocode_gsi(address: str):
    if not address:
        return None
    logger.info("[gsi query] %s", address)
    url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(address)
    data = _request_json(
        url,
        headers={"User-Agent": "techcard-geocoder/1.0 (contact@techcard.local)"},
        timeout=10,
        retries=3,
        label="gsi",
    )
    if not data:
        return None
    try:
        lon, lat = data[0]["geometry"]["coordinates"]
        if lat == 0 or lon == 0:
            return None
        logger.info("[gsi success] %s lat=%s lon=%s", address, lat, lon)
        return lat, lon
    except Exception:
        return None


def _select_best_address(addresses: dict[tuple[str, str], int] | None):
    if not addresses:
        return "", ""
    scored = []
    for (postal_code, address), count in addresses.items():
        addr_text = (address or "").strip()
        postal_text = (postal_code or "").strip()
        length_score = len(addr_text.replace(" ", "").replace("　", ""))
        info_score = length_score + (100 if postal_text else 0)
        scored.append((info_score, count, length_score, postal_text, addr_text))
    scored.sort(reverse=True)
    _, _, _, postal, address = scored[0]
    return postal, address


def _geocode_company(address: str, postal_code: str):
    normalized_address = _normalize_address(address)
    lot_base_address = _normalize_address_to_lot_base(address)
    zip_address = ""
    if postal_code:
        zip_result = _zipcloud_lookup(postal_code)
        if zip_result:
            zip_address = _build_address_from_zipcloud(zip_result)

    gsi_queries: list[str] = []

    def append_query(query: str):
        normalized_query = _normalize_address(query)
        if not normalized_query:
            return
        if normalized_query in gsi_queries:
            return
        gsi_queries.append(normalized_query)

    # 番地付き住所を最優先し、同一点化しやすい郵便番号のみ検索は最後に回す
    if normalized_address:
        append_query(normalized_address)
    if lot_base_address and lot_base_address != normalized_address:
        append_query(lot_base_address)
    if zip_address and normalized_address:
        append_query(f"{zip_address} {normalized_address}")
    if zip_address and lot_base_address and lot_base_address != normalized_address:
        append_query(f"{zip_address} {lot_base_address}")
    if zip_address:
        append_query(zip_address)

    for query in gsi_queries:
        latlon = _geocode_gsi(query)
        if latlon:
            return latlon, query, zip_address

    if normalized_address:
        latlon = _geocode_nominatim(normalized_address)
        if latlon:
            return latlon, normalized_address, zip_address
    if address and address != normalized_address:
        latlon = _geocode_nominatim(address)
        if latlon:
            return latlon, address, zip_address

    return None, "", zip_address


async def _async_geocode(address: str, postal_code: str):
    async with _GEOCODE_SEMAPHORE:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _geocode_company, address, postal_code)
        await asyncio.sleep(1.1)
        return result


async def _geocode_and_cache(address_key: tuple[str, str], address: str, postal_code: str):
    try:
        result, used_address, zip_address = await _async_geocode(address, postal_code)
        if result:
            lat, lon = result
            _ADDRESS_GEOCODE_CACHE[address_key] = (lat, lon)
            logger.info("[geocode cache] %s lat=%s lon=%s", address or zip_address or "", lat, lon)
        else:
            failed_address = used_address or address or zip_address or ""
            logger.warning("[geocode failed] address=%s postal=%s", failed_address, postal_code)
    finally:
        _ADDRESS_GEOCODE_INFLIGHT.discard(address_key)


@router.get("/company-map")
async def get_company_map(refresh: bool = Query(False), db: Session = Depends(get_db)):
    contacts = (
        db.query(models.Contact)
        .options(joinedload(models.Contact.company))
        .all()
    )
    self_contact = next((c for c in contacts if c.is_self and c.company_id), None)
    self_company_id = self_contact.company_id if self_contact else None

    company_entries = {}
    address_groups: dict[tuple[str, str], dict] = {}
    for contact in contacts:
        if not contact.company:
            continue
        entry = company_entries.setdefault(
            contact.company.id,
            {
                "company": contact.company,
                "count": 0,
                "addresses": {},
            },
        )
        entry["count"] += 1
        postal = (contact.postal_code or "").strip()
        raw_address = (contact.address or "").strip()
        # 地図表示の集約は「番地まで」を有効値とし、階層表記やビル名差分は同一扱いにする
        normalized_address = _normalize_address(raw_address)
        address = normalized_address or raw_address
        address_key = (postal, address)
        if address_key != ("", ""):
            entry["addresses"][address_key] = entry["addresses"].get(address_key, 0) + 1
            group = address_groups.setdefault(
                address_key,
                {"postal_code": postal, "address": address, "companies": set()},
            )
            group["companies"].add(contact.company.id)

    company_count = len(company_entries)
    geocode_success = 0
    geocode_fail = 0
    company_items = []

    for entry in company_entries.values():
        company = entry["company"]
        count = entry["count"]
        addresses = entry["addresses"]
        needs_commit = False

        selected_postal = (company.postal_code or "").strip()
        selected_address = (company.address or "").strip()
        if addresses:
            best_postal, best_address = _select_best_address(addresses)
            if best_postal or best_address:
                selected_postal = best_postal or selected_postal
                selected_address = best_address or selected_address
            if (
                (best_postal and best_postal != (company.postal_code or "").strip())
                or (best_address and best_address != (company.address or "").strip())
                or (refresh and (best_postal or best_address))
            ):
                if selected_postal:
                    company.postal_code = selected_postal
                if selected_address:
                    company.address = selected_address
                needs_commit = True

        geocoded_at = company.geocoded_at
        if isinstance(geocoded_at, str):
            try:
                geocoded_at = datetime.fromisoformat(geocoded_at)
            except ValueError:
                geocoded_at = None
        should_retry = False
        if refresh:
            should_retry = True
        if company.latitude is None or company.longitude is None:
            if refresh:
                should_retry = True
            if company.id == self_company_id:
                should_retry = True
            elif geocoded_at is None:
                should_retry = True
            elif (datetime.utcnow() - geocoded_at).days >= 7:
                should_retry = True

        company_items.append(
            {
                "company": company,
                "count": count,
                "selected_postal": selected_postal,
                "selected_address": selected_address,
                "needs_commit": needs_commit,
                "should_retry": should_retry,
                "task_index": None,
            }
        )

    tasks = []
    for item in company_items:
        if not item["should_retry"]:
            continue
        company = item["company"]
        if refresh:
            company.latitude = None
            company.longitude = None
        address = item["selected_address"]
        postal_code = item["selected_postal"]
        if not address and not postal_code:
            item["task_index"] = None
            continue
        tasks.append(_async_geocode(address, postal_code))
        item["task_index"] = len(tasks) - 1

    async_results = []
    if tasks:
        async_results = await asyncio.gather(*tasks)

    for item in company_items:
        company = item["company"]
        count = item["count"]
        selected_postal = item["selected_postal"]
        selected_address = item["selected_address"]
        needs_commit = item["needs_commit"]
        used_address = ""
        zip_address = ""
        result = None

        if item["should_retry"]:
            task_index = item["task_index"]
            if task_index is not None:
                result, used_address, zip_address = async_results[task_index]
            if result:
                lat, lon = result
                company.latitude = lat
                company.longitude = lon
                company.geocoded_at = datetime.utcnow()
                company.geocode_note = None
                needs_commit = True
                geocode_success += 1
                logger.info(
                    "[geocode success] %s lat=%s lon=%s query=%s",
                    company.name,
                    lat,
                    lon,
                    used_address or "",
                )
            else:
                if refresh or company.latitude is None or company.longitude is None:
                    company.latitude = None
                    company.longitude = None
                company.geocoded_at = datetime.utcnow()
                company.geocode_note = "geocode_failed"
                needs_commit = True
                geocode_fail += 1
                failed_address = used_address or selected_address or zip_address or ""
                logger.warning(
                    "[geocode failed] %s address=%s postal=%s",
                    company.name,
                    failed_address,
                    selected_postal,
                )

            if zip_address and not company.address:
                company.address = zip_address
                needs_commit = True
            if selected_postal and not company.postal_code:
                company.postal_code = selected_postal
                needs_commit = True

        if needs_commit:
            db.add(company)
            db.commit()

    if refresh:
        for address_key in address_groups.keys():
            _ADDRESS_GEOCODE_CACHE.pop(address_key, None)
            _ADDRESS_GEOCODE_INFLIGHT.discard(address_key)

    address_results: dict[tuple[str, str], tuple[float, float]] = {}
    for item in company_items:
        company = item["company"]
        cached_postal = (company.postal_code or "").strip()
        cached_address = (company.address or "").strip()
        if cached_postal or cached_address:
            if company.latitude is not None and company.longitude is not None:
                address_results[(cached_postal, cached_address)] = (company.latitude, company.longitude)

    address_results.update(_ADDRESS_GEOCODE_CACHE)

    missing_keys = [
        key
        for key in address_groups.keys()
        if key != ("", "") and key not in address_results and key not in _ADDRESS_GEOCODE_INFLIGHT
    ]
    keys_to_process = missing_keys[:_MAX_ADDRESS_GEOCODES_PER_REQUEST]

    if refresh and keys_to_process:
        for address_key in keys_to_process:
            postal, address = address_key
            _ADDRESS_GEOCODE_INFLIGHT.add(address_key)
            result, used_address, zip_address = await _async_geocode(address, postal)
            _ADDRESS_GEOCODE_INFLIGHT.discard(address_key)
            if result:
                lat, lon = result
                address_results[address_key] = (lat, lon)
                _ADDRESS_GEOCODE_CACHE[address_key] = (lat, lon)
                geocode_success += 1
            else:
                geocode_fail += 1
                failed_address = used_address or address or zip_address or ""
                logger.warning(
                    "[geocode failed] address=%s postal=%s",
                    failed_address,
                    postal,
                )
    else:
        for address_key in keys_to_process:
            postal, address = address_key
            if address_key in _ADDRESS_GEOCODE_INFLIGHT:
                continue
            _ADDRESS_GEOCODE_INFLIGHT.add(address_key)
            asyncio.create_task(_geocode_and_cache(address_key, address, postal))

    results = []
    locations_by_company: dict[int, list[dict]] = {}
    for entry in company_entries.values():
        company = entry["company"]
        for (postal, address), address_count in entry["addresses"].items():
            latlon = address_results.get((postal, address))
            if not latlon:
                continue
            lat, lon = latlon
            display_address = address or postal or ""
            city = _extract_city(display_address)
            locations_by_company.setdefault(company.id, []).append(
                {
                    "lat": lat,
                    "lon": lon,
                    "address": display_address,
                    "postal_code": postal,
                    "city": city,
                    "count": address_count,
                }
            )

    for item in company_items:
        company = item["company"]
        count = item["count"]
        selected_postal = item["selected_postal"]
        selected_address = item["selected_address"]
        display_address = (company.address or selected_address).strip()
        if not display_address and selected_postal:
            display_address = selected_postal
        city = _extract_city(display_address)
        if not city and selected_address:
            city = _extract_city(selected_address)
        payload = {
            "company_id": company.id,
            "company_name": company.name,
            "name": company.name,
            "count": count,
            "lat": company.latitude,
            "lon": company.longitude,
            "is_self": company.id == self_company_id,
            "postal_code": company.postal_code,
            "address": display_address,
            "city": city,
        }
        locations = locations_by_company.get(company.id) or []
        if locations:
            payload["locations"] = locations
        results.append(payload)

    address_total = sum(1 for key in address_groups.keys() if key != ("", ""))
    address_success = sum(1 for key in address_groups.keys() if key in address_results)
    progress_total = address_total if address_total > 0 else company_count
    progress_success = address_success if address_total > 0 else sum(
        1 for item in company_items if item["company"].latitude is not None and item["company"].longitude is not None
    )
    for item in results:
        item["geocode_progress"] = {"success": progress_success, "total": progress_total}

    logger.info(
        "[geocode summary] company=%s success=%s fail=%s",
        company_count,
        geocode_success,
        geocode_fail,
    )
    return results


@router.get("/company-map/diagnostics")
def get_company_map_diagnostics(db: Session = Depends(get_db)):
    contacts = (
        db.query(models.Contact)
        .options(joinedload(models.Contact.company))
        .all()
    )
    company_entries = {}
    for contact in contacts:
        if not contact.company:
            continue
        entry = company_entries.setdefault(
            contact.company.id,
            {
                "company": contact.company,
                "addresses": {},
            },
        )
        address_key = (
            (contact.postal_code or "").strip(),
            (contact.address or "").strip(),
        )
        if address_key != ("", ""):
            entry["addresses"][address_key] = entry["addresses"].get(address_key, 0) + 1

    missing = []
    invalidated = []
    short_address = []
    for entry in company_entries.values():
        company = entry["company"]
        best_postal, best_address = _select_best_address(entry["addresses"])
        postal = best_postal or (company.postal_code or "").strip()
        address = best_address or (company.address or "").strip()
        if not postal and not address:
            missing.append({"company_id": company.id, "name": company.name})
            continue
        if address and not _extract_city(address):
            short_address.append({"company_id": company.id, "name": company.name})
        if company.latitude is None and company.longitude is None and company.geocoded_at is not None:
            note = (company.geocode_note or "").strip()
            if note == "prefecture_mismatch":
                reason = "都道府県不一致"
            elif note == "postal_pref_mismatch":
                reason = "郵便番号と都道府県不一致"
            elif note == "geocode_failed":
                reason = "ジオコーディング失敗"
            else:
                reason = "不明"
            invalidated.append({"company_id": company.id, "name": company.name, "reason": reason})

    missing.sort(key=lambda item: item["name"])
    invalidated.sort(key=lambda item: item["name"])
    short_address.sort(key=lambda item: item["name"])
    return {
        "missing_addresses": missing,
        "invalidated_coords": invalidated,
        "short_addresses": short_address,
    }
