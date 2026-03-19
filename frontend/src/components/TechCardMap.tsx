import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Marker, NavigationControl, Popup, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import LedMarker from './LedMarker';
import CompanyCluster from './CompanyCluster';
import { createAbortController, getApiErrorMessage, isAbortError } from '../lib/api';
import {
  CompanyMapPoint,
  CompanyRouteResponse,
  RouteStep,
  fetchCompanyRoute,
} from '../services/statsService';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);
const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const SEARCH_RESULT_LIMIT = 30;

const haversineMeters = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const dLat = (bLat - aLat) * DEG_TO_RAD;
  const dLon = (bLon - aLon) * DEG_TO_RAD;
  const lat1 = aLat * DEG_TO_RAD;
  const lat2 = bLat * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

const formatDistanceLabel = (route: CompanyRouteResponse): string => {
  const distanceKm = Number.isFinite(route.distance_km)
    ? route.distance_km
    : (Number.isFinite(route.distance_m) ? route.distance_m / 1000 : NaN);
  if (!Number.isFinite(distanceKm)) return '-';
  if (distanceKm < 1) {
    const meters = Math.round(distanceKm * 1000);
    return `${meters} m`;
  }
  return `${distanceKm.toFixed(2)} km`;
};

const TechCardMap: React.FC<{ companies: CompanyMapPoint[]; loading?: boolean }> = ({ companies, loading }) => {
  const mapRef = useRef<MapRef | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapLoadedRef = useRef(false);
  const [hovered, setHovered] = useState<CompanyMapPoint | null>(null);
  const [viewState, setViewState] = useState({ longitude: 138, latitude: 37, zoom: 5 });
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [labelOffsets, setLabelOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedRoute, setSelectedRoute] = useState<CompanyRouteResponse | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pendingTargetName, setPendingTargetName] = useState<string | null>(null);
  const [companySearchQuery, setCompanySearchQuery] = useState('');
  const [focusedSearchPointKey, setFocusedSearchPointKey] = useState<string | null>(null);
  const routeRequestAbortRef = useRef<AbortController | null>(null);

  const points = useMemo(() => {
    if (!companies) return [];
    const list: CompanyMapPoint[] = [];
    (companies as any[]).forEach(company => {
      if (company?.locations && Array.isArray(company.locations)) {
        company.locations.forEach((loc: any) => {
          if (isFiniteNumber(loc?.lat) && isFiniteNumber(loc?.lon)) {
            list.push({
              company_id: company.company_id,
              name: company.company_name || company.name,
              count: loc.count ?? company.count ?? 1,
              lat: loc.lat,
              lon: loc.lon,
              is_self: Boolean(company.is_self),
              postal_code: loc.postal_code ?? company.postal_code,
              address: loc.address ?? company.address,
              city: loc.city ?? company.city,
              geocode_progress: company.geocode_progress,
            });
          }
        });
      } else if (isFiniteNumber(company?.lat) && isFiniteNumber(company?.lon)) {
        list.push(company as CompanyMapPoint);
      }
    });
    return list.filter(point => isFiniteNumber(point.lat) && isFiniteNumber(point.lon));
  }, [companies]);

  const markerOffsets = useMemo(() => {
    const thresholdMeters = 70;
    const clustered = new Array(points.length).fill(false);
    const offsets: Record<string, { x: number; y: number }> = {};
    const getKey = (index: number) => `${points[index].company_id}-${index}`;

    for (let i = 0; i < points.length; i += 1) {
      if (clustered[i]) continue;
      const cluster = [i];
      clustered[i] = true;
      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < points.length; j += 1) {
          if (clustered[j]) continue;
          const pointJ = points[j];
          if (!isFiniteNumber(pointJ.lat) || !isFiniteNumber(pointJ.lon)) continue;
          const nearAny = cluster.some(index => {
            const pointI = points[index];
            return haversineMeters(pointI.lat as number, pointI.lon as number, pointJ.lat as number, pointJ.lon as number) <= thresholdMeters;
          });
          if (!nearAny) continue;
          clustered[j] = true;
          cluster.push(j);
          changed = true;
        }
      }

      if (cluster.length <= 1) continue;
      const sorted = cluster.slice().sort((a, b) => {
        const pa = points[a];
        const pb = points[b];
        if (pa.is_self !== pb.is_self) return pa.is_self ? -1 : 1;
        if (pa.company_id !== pb.company_id) return pa.company_id - pb.company_id;
        return (pa.name || '').localeCompare(pb.name || '', 'ja');
      });

      const selfIndex = sorted.findIndex(index => points[index].is_self);
      if (selfIndex >= 0) {
        const selfPointIndex = sorted[selfIndex];
        offsets[getKey(selfPointIndex)] = { x: 0, y: 0 };
      }
      const ringMembers = selfIndex >= 0
        ? sorted.filter(index => !points[index].is_self)
        : sorted;
      const ringCount = ringMembers.length;
      if (ringCount <= 0) continue;
      const radiusPx = Math.min(34, 18 + ringCount * 2.4);
      const startAngle = -(Math.PI / 2);
      ringMembers.forEach((pointIndex, idx) => {
        const angle = startAngle + (Math.PI * 2 * idx) / ringCount;
        offsets[getKey(pointIndex)] = {
          x: Math.round(Math.cos(angle) * radiusPx),
          y: Math.round(Math.sin(angle) * radiusPx),
        };
      });
    }
    return offsets;
  }, [points]);

  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: points.map((point, index) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [point.lon as number, point.lat as number],
        },
        properties: {
          company_id: point.company_id,
          name: point.name,
          address: point.address || point.postal_code || '',
          city: point.city || '',
          index,
        },
      })),
    }),
    [points],
  );

  const cluster = useMemo(() => {
    const instance = new Supercluster({ radius: 60, maxZoom: 16 });
    instance.load(geojson.features as any);
    return instance;
  }, [geojson]);

  const clusters = useMemo(() => {
    if (!bounds) return [];
    return cluster.getClusters(bounds as any, Math.round(viewState.zoom));
  }, [cluster, bounds, viewState.zoom]);
  const routeGeoJson = useMemo(() => {
    if (!selectedRoute?.geometry?.coordinates?.length) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: selectedRoute.geometry,
          properties: {},
        },
      ],
    };
  }, [selectedRoute]);
  const routeDisplaySteps = useMemo(() => {
    const steps = selectedRoute?.route_steps;
    if (!steps || !Array.isArray(steps)) return [];
    const normalized = steps
      .filter(step => isFiniteNumber(step?.lon) && isFiniteNumber(step?.lat) && Boolean(step?.label))
      .slice(0, 40);
    const keySteps = normalized.filter(step => step.kind === 'enter' || step.kind === 'exit' || step.kind === 'junction');
    if (keySteps.length > 0) {
      return keySteps.slice(0, 20);
    }
    return normalized.filter(step => step.kind === 'road').slice(0, 10);
  }, [selectedRoute]);
  const isStraightFallback = selectedRoute?.provider === 'fallback_straight';
  const routeOutlineColor = isStraightFallback ? 'rgba(124, 45, 18, 0.95)' : 'rgba(3, 7, 18, 0.95)';
  const routeLineColor = isStraightFallback ? '#fb923c' : '#22d3ee';
  const routeStepKindLabel = useMemo<Record<RouteStep['kind'], string>>(
    () => ({
      enter: '入口',
      exit: '出口',
      junction: '乗換',
      road: '道路',
      other: '経由',
    }),
    [],
  );

  const searchablePoints = useMemo(() => {
    return points.map((point, index) => {
      const key = `${point.company_id}-${index}`;
      const address = (point.address || point.postal_code || '').trim();
      const city = (point.city || '').trim();
      const searchable = [
        point.name || '',
        address,
        city,
        point.postal_code || '',
      ]
        .join(' ')
        .toLowerCase();
      return {
        key,
        point,
        index,
        address,
        city,
        searchable,
      };
    });
  }, [points]);

  const focusedSearchPoint = useMemo(() => {
    if (!focusedSearchPointKey) return null;
    return searchablePoints.find(item => item.key === focusedSearchPointKey) || null;
  }, [focusedSearchPointKey, searchablePoints]);

  const companySearchResults = useMemo(() => {
    const query = companySearchQuery.trim().toLowerCase();
    if (!query) return [];
    const terms = query.split(/\s+/).filter(Boolean);
    const scored = searchablePoints
      .filter(item => terms.every(term => item.searchable.includes(term)))
      .map(item => {
        const name = (item.point.name || '').toLowerCase();
        let score = 0;
        if (name === query) score += 120;
        else if (name.startsWith(query)) score += 80;
        else if (name.includes(query)) score += 50;
        if (item.address.toLowerCase().includes(query)) score += 40;
        if (item.city.toLowerCase().includes(query)) score += 20;
        return { ...item, score };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.point.company_id !== b.point.company_id) return a.point.company_id - b.point.company_id;
        return (a.address || '').localeCompare(b.address || '', 'ja');
      });
    return scored.slice(0, SEARCH_RESULT_LIMIT);
  }, [companySearchQuery, searchablePoints]);

  const updateBounds = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const mapBounds = map.getBounds();
    setBounds([
      mapBounds.getWest(),
      mapBounds.getSouth(),
      mapBounds.getEast(),
      mapBounds.getNorth(),
    ]);
  }, []);

  const handleMove = useCallback(
    (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => {
      setViewState(evt.viewState);
      updateBounds();
    },
    [updateBounds],
  );

  const handleLoad = useCallback(
    (event: any) => {
      updateBounds();
      const map = event?.target;
      if (!map) return;
      mapLoadedRef.current = true;
      map.on('error', (err: any) => {
        console.error('map error', err?.error || err);
      });
      const ensureRegions = async () => {
        if (map.getSource('regions')) {
          return;
        }
        let regionData: any = null;
        let useRegions = true;
        try {
          const response = await fetch('/japan_regions.geojson', { cache: 'no-cache' });
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || (!contentType.includes('application/json') && !contentType.includes('application/geo+json'))) {
            throw new Error(`regions status=${response.status} type=${contentType}`);
          }
          regionData = await response.json();
        } catch (err) {
          console.warn('region source load failed, fallback to japan.geojson', err);
          useRegions = false;
          try {
            const response = await fetch('/japan.geojson', { cache: 'no-cache' });
            const contentType = response.headers.get('content-type') || '';
            if (response.ok && (contentType.includes('application/json') || contentType.includes('application/geo+json'))) {
              regionData = await response.json();
            } else {
              throw new Error(`japan geojson status=${response.status} type=${contentType}`);
            }
          } catch (fallbackErr) {
            console.warn('japan geojson load failed', fallbackErr);
          }
        }
        if (!regionData) {
          return;
        }
        map.addSource('regions', {
          type: 'geojson',
          data: regionData,
        });
        if (!map.getLayer('region-outline')) {
          map.addLayer({
            id: 'region-outline',
            type: 'line',
            source: 'regions',
            maxzoom: 5,
            paint: {
              'line-width': 2,
              'line-color': useRegions
                ? [
                    'match',
                    ['get', 'region'],
                    'Hokkaido',
                    '#60a5fa',
                    'Tohoku',
                    '#34d399',
                    'Kanto',
                    '#fbbf24',
                    'Chubu',
                    '#f97316',
                    'Kinki',
                    '#f43f5e',
                    'Chugoku',
                    '#a78bfa',
                    'Shikoku',
                    '#22d3ee',
                    'Kyushu',
                    '#84cc16',
                    '#64748b',
                  ]
                : '#64748b',
            },
          });
        }
        if (useRegions && !map.getLayer('region-label')) {
          map.addLayer({
            id: 'region-label',
            type: 'symbol',
            source: 'regions',
            maxzoom: 5,
            layout: {
              'text-field': ['get', 'region'],
              'text-size': 14,
            },
            paint: {
              'text-color': '#facc15',
              'text-halo-color': '#0f172a',
              'text-halo-width': 1.6,
            },
          });
        }
      };

      const ensureBoundaries = async () => {
        const loadGeoJson = async (path: string) => {
          const response = await fetch(path, { cache: 'no-cache' });
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok || (!contentType.includes('application/json') && !contentType.includes('application/geo+json'))) {
            throw new Error(`boundary status=${response.status} type=${contentType}`);
          }
          return await response.json();
        };

        if (!map.getSource('regions-boundary')) {
          try {
            const data = await loadGeoJson('/japan_regions.geojson');
            map.addSource('regions-boundary', { type: 'geojson', data });
          } catch (error) {
            console.warn('regions boundary load failed', error);
          }
        }
        if (!map.getSource('pref-boundary')) {
          try {
            const data = await loadGeoJson('/japan.geojson');
            map.addSource('pref-boundary', { type: 'geojson', data });
          } catch (error) {
            console.warn('prefecture boundary load failed', error);
          }
        }
        if (!map.getSource('city-boundary')) {
          try {
            const data = await loadGeoJson('/japan.geojson');
            map.addSource('city-boundary', { type: 'geojson', data });
          } catch (error) {
            console.warn('municipality boundary load failed', error);
          }
        }

        if (map.getSource('regions-boundary') && !map.getLayer('region-boundary')) {
          map.addLayer({
            id: 'region-boundary',
            type: 'line',
            source: 'regions-boundary',
            maxzoom: 6,
            paint: {
              'line-color': '#334155',
              'line-width': 2,
            },
          });
        }
        if (map.getSource('pref-boundary') && !map.getLayer('pref-boundary')) {
          map.addLayer({
            id: 'pref-boundary',
            type: 'line',
            source: 'pref-boundary',
            minzoom: 6,
            maxzoom: 9,
            paint: {
              'line-color': '#1f2937',
              'line-width': 1.2,
            },
          });
        }
        if (map.getSource('city-boundary') && !map.getLayer('city-boundary')) {
          map.addLayer({
            id: 'city-boundary',
            type: 'line',
            source: 'city-boundary',
            minzoom: 9,
            paint: {
              'line-color': '#111827',
              'line-width': 0.8,
            },
          });
        }
      };

      const onReady = () => {
        ensureRegions();
        ensureBoundaries();
        const layers = map.getStyle()?.layers || [];
        layers.forEach((layer: any) => {
          if (layer.type !== 'symbol' || !layer.id) return;
          if (!layer.layout || layer.layout['text-field'] == null) return;
          const id = layer.id.toLowerCase();
          try {
            if (id.includes('admin-1') || id.includes('state') || id.includes('province')) {
              map.setPaintProperty(layer.id, 'text-color', '#facc15');
              map.setPaintProperty(layer.id, 'text-halo-color', '#0f172a');
              map.setPaintProperty(layer.id, 'text-halo-width', 1.6);
              map.setLayoutProperty(layer.id, 'text-size', 18);
              map.setLayerZoomRange(layer.id, 0, 8);
            } else if (id.includes('admin-2') || id.includes('municipality')) {
              map.setPaintProperty(layer.id, 'text-color', '#93c5fd');
              map.setPaintProperty(layer.id, 'text-halo-color', '#0f172a');
              map.setPaintProperty(layer.id, 'text-halo-width', 1);
              map.setLayoutProperty(layer.id, 'text-size', 11);
              map.setLayerZoomRange(layer.id, 6, 24);
            } else if (
              id.includes('city') ||
              id.includes('town') ||
              id.includes('village') ||
              id.includes('place')
            ) {
              map.setPaintProperty(layer.id, 'text-color', '#93c5fd');
              map.setPaintProperty(layer.id, 'text-halo-color', '#0f172a');
              map.setPaintProperty(layer.id, 'text-halo-width', 1);
              map.setLayoutProperty(layer.id, 'text-size', 10);
            }
          } catch (error) {
            console.warn('label color update failed', layer.id, error);
          }
        });
      };

      if (map.isStyleLoaded()) {
        onReady();
      } else {
        map.once('load', onReady);
      }
    },
    [updateBounds],
  );

  useEffect(() => {
    if (!canvasRef.current) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const observer = new ResizeObserver(() => {
      map.resize();
      updateBounds();
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [updateBounds]);

  useEffect(() => {
    return () => {
      routeRequestAbortRef.current?.abort();
      routeRequestAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!focusedSearchPointKey) return;
    const exists = searchablePoints.some(item => item.key === focusedSearchPointKey);
    if (!exists) {
      setFocusedSearchPointKey(null);
    }
  }, [focusedSearchPointKey, searchablePoints]);

  const clearRouteSelection = useCallback(() => {
    routeRequestAbortRef.current?.abort();
    routeRequestAbortRef.current = null;
    setSelectedRoute(null);
    setRouteError(null);
    setRouteLoading(false);
    setPendingTargetName(null);
  }, []);

  const clearSearchFocus = useCallback(() => {
    setFocusedSearchPointKey(null);
    setHovered(null);
  }, []);

  const focusPointOnMap = useCallback((item: { key: string; point: CompanyMapPoint }) => {
    if (!isFiniteNumber(item.point.lon) || !isFiniteNumber(item.point.lat)) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const targetZoom = Math.min(15, Math.max(map.getZoom(), 13));
    map.easeTo({
      center: [item.point.lon, item.point.lat],
      zoom: targetZoom,
      duration: 650,
    });
    setFocusedSearchPointKey(item.key);
    setHovered(item.point);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      clearRouteSelection();
      clearSearchFocus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearRouteSelection, clearSearchFocus]);

  const resolvePointFromFeature = useCallback((feature: any): CompanyMapPoint | null => {
    const index = Number(feature?.properties?.index);
    if (Number.isFinite(index) && points[index]) {
      return points[index];
    }
    const companyId = Number(feature?.properties?.company_id);
    if (!Number.isNaN(companyId)) {
      return points.find(item => item.company_id === companyId) || null;
    }
    return null;
  }, [points]);

  const fitRouteToMap = useCallback((coordinates: [number, number][]) => {
    if (!coordinates.length) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    coordinates.forEach(([lon, lat]) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    });
    if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
      return;
    }
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 80, duration: 700, maxZoom: 11 },
    );
  }, []);

  const requestCompanyRoute = useCallback((company: CompanyMapPoint) => {
    if (company.is_self) {
      clearRouteSelection();
      setFocusedSearchPointKey(null);
      return;
    }
    setFocusedSearchPointKey(null);
    routeRequestAbortRef.current?.abort();
    const controller = createAbortController();
    routeRequestAbortRef.current = controller;
    setRouteLoading(true);
    setRouteError(null);
    setPendingTargetName(company.name || null);
    fetchCompanyRoute({
      toCompanyId: company.company_id,
      toLat: company.lat,
      toLon: company.lon,
      toAddress: company.address,
      signal: controller.signal,
    })
      .then(response => {
        const route = response.data;
        setSelectedRoute(route);
        if (route.geometry?.coordinates?.length) {
          fitRouteToMap(route.geometry.coordinates);
        }
      })
      .catch(error => {
        if (isAbortError(error)) return;
        setRouteError(getApiErrorMessage(error, 'ルート取得に失敗しました。'));
      })
      .finally(() => {
        if (routeRequestAbortRef.current !== controller) return;
        setRouteLoading(false);
        setPendingTargetName(null);
      });
  }, [clearRouteSelection, fitRouteToMap]);

  const handleHover = useCallback((event: any) => {
    const features = event.features as any[] | undefined;
    if (!features || features.length === 0) {
      setHovered(null);
      return;
    }
    const feature = features[0];
    const point = resolvePointFromFeature(feature);
    setHovered(point || null);
  }, [resolvePointFromFeature]);

  const handleClick = useCallback((event: any) => {
    const features = event.features as any[] | undefined;
    if (!features || features.length === 0) return;
    const feature = features[0];
    const point = resolvePointFromFeature(feature);
    if (point) {
      requestCompanyRoute(point);
    }
  }, [requestCompanyRoute, resolvePointFromFeature]);

  const computeLabelOffsets = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || viewState.zoom < 7 || !bounds) {
      setLabelOffsets({});
      return;
    }
    const [west, south, east, north] = bounds;
    const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const offsets: Record<string, { x: number; y: number }> = {};
    const padding = 6;

    const estimateLabelSize = (point: CompanyMapPoint) => {
      const name = point.name || '';
      const city = point.city || '';
      const nameWidth = name.length * 7 + 18;
      const cityWidth = city.length * 6 + 16;
      const width = Math.min(220, Math.max(60, nameWidth, cityWidth));
      const height = city ? 28 : 16;
      return { width, height };
    };

    points.forEach((point, index) => {
      if (!isFiniteNumber(point.lon) || !isFiniteNumber(point.lat)) return;
      if (point.lon < west || point.lon > east || point.lat < south || point.lat > north) return;
      const key = `${point.company_id}-${index}`;
      const markerOffset = markerOffsets[key] || { x: 0, y: 0 };
      const projected = map.project([point.lon, point.lat]);
      const screen = {
        x: projected.x + markerOffset.x,
        y: projected.y + markerOffset.y,
      };
      const { width, height } = estimateLabelSize(point);
      const baseY = ((index % 3) - 1) * 6;
      const candidates = [
        { x: 14, y: -16 + baseY },
        { x: 14, y: 16 + baseY },
        { x: -width - 14, y: -16 + baseY },
        { x: -width - 14, y: 16 + baseY },
        { x: -width / 2, y: -height - 18 + baseY },
        { x: -width / 2, y: 18 + baseY },
        { x: 20, y: -28 + baseY },
        { x: 20, y: 28 + baseY },
      ];

      const getRect = (candidate: { x: number; y: number }) => {
        const x1 = screen.x + candidate.x;
        const y1 = screen.y + candidate.y;
        return { x1, y1, x2: x1 + width, y2: y1 + height };
      };

      let chosen = candidates[0];
      let rect = getRect(chosen);
      for (const candidate of candidates) {
        const nextRect = getRect(candidate);
        const collision = placed.some(item => !(
          nextRect.x2 < item.x1 - padding ||
          nextRect.x1 > item.x2 + padding ||
          nextRect.y2 < item.y1 - padding ||
          nextRect.y1 > item.y2 + padding
        ));
        if (!collision) {
          chosen = candidate;
          rect = nextRect;
          break;
        }
      }
      offsets[key] = chosen;
      placed.push(rect);
    });

    setLabelOffsets(prev => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(offsets);
      if (prevKeys.length === nextKeys.length) {
        let same = true;
        for (const key of nextKeys) {
          const prevValue = prev[key];
          const nextValue = offsets[key];
          if (!prevValue || !nextValue || prevValue.x !== nextValue.x || prevValue.y !== nextValue.y) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return offsets;
    });
  }, [bounds, markerOffsets, points, viewState.zoom]);

  useEffect(() => {
    computeLabelOffsets();
  }, [computeLabelOffsets]);

  return (
    <div className="techcard-map">
      <div className="techcard-map__canvas" ref={canvasRef}>
        <Map
          ref={mapRef}
          mapLib={maplibregl}
          initialViewState={viewState}
          onLoad={handleLoad}
          onMove={handleMove}
          mapStyle={MAP_STYLE}
          minZoom={4}
          maxZoom={15}
          style={{ width: '100%', height: '100%' }}
          interactiveLayerIds={['companies-circle']}
          onMouseMove={handleHover}
          onClick={handleClick}
        >
        <NavigationControl position="bottom-right" showCompass={false} />
        <Source id="companies" type="geojson" data={geojson}>
          <Layer
            id="companies-circle"
            type="circle"
            minzoom={7}
            paint={{
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                5,
                3,
                10,
                6,
                14,
                10,
              ],
              'circle-color': '#00ffff',
              'circle-blur': 0.8,
              'circle-opacity': 0.85,
            }}
          />
        </Source>
        {routeGeoJson && (
          <Source id="selected-route" type="geojson" data={routeGeoJson}>
            <Layer
              id="selected-route-outline"
              type="line"
              paint={{
                'line-color': routeOutlineColor,
                'line-width': 8,
                'line-opacity': 0.75,
                ...(isStraightFallback ? { 'line-dasharray': [2, 1.5] } : {}),
              }}
            />
            <Layer
              id="selected-route-line"
              type="line"
              paint={{
                'line-color': routeLineColor,
                'line-width': 5,
                'line-opacity': 0.95,
                ...(isStraightFallback ? { 'line-dasharray': [2, 1.5] } : {}),
              }}
            />
          </Source>
        )}
        {viewState.zoom >= 4 && routeDisplaySteps.map((step, index) => (
          <Marker
            key={`route-step-${index}-${step.lon.toFixed(5)}-${step.lat.toFixed(5)}-${step.kind}`}
            longitude={step.lon}
            latitude={step.lat}
            anchor="left"
          >
            <div className={`techcard-route-step techcard-route-step--${step.kind}`}>
              <span className="techcard-route-step__kind">{routeStepKindLabel[step.kind] || '経由'}</span>
              <span className="techcard-route-step__text">{step.label}</span>
            </div>
          </Marker>
        ))}

        {viewState.zoom < 7 &&
          clusters.map((clusterItem: any) => {
            const [longitude, latitude] = clusterItem.geometry.coordinates;
            if (clusterItem.properties.cluster) {
              const pointCount = clusterItem.properties.point_count as number;
              const clusterId = clusterItem.properties.cluster_id as number;
              return (
                <Marker key={`cluster-${clusterId}`} longitude={longitude} latitude={latitude}>
                  <CompanyCluster
                    count={pointCount}
                    onClick={() => {
                      const zoom = Math.min(cluster.getClusterExpansionZoom(clusterId), 16);
                      mapRef.current?.getMap().easeTo({ center: [longitude, latitude], zoom });
                    }}
                  />
                </Marker>
              );
            }
            const singleId = Number(clusterItem.properties?.company_id);
            const singleIndex = Number(clusterItem.properties?.index);
            return (
              <Marker key={`cluster-single-${singleId}`} longitude={longitude} latitude={latitude}>
                <CompanyCluster
                  count={1}
                  onClick={() => {
                    if (Number.isFinite(singleIndex) && points[singleIndex]) {
                      requestCompanyRoute(points[singleIndex]);
                      return;
                    }
                    if (!Number.isNaN(singleId)) {
                      const point = points.find(item => item.company_id === singleId);
                      if (point) {
                        requestCompanyRoute(point);
                      }
                    }
                  }}
                />
              </Marker>
            );
          })}

        {viewState.zoom >= 7 &&
          points.map((company, index) => (
            <Marker
              key={`${company.company_id}-${index}`}
              longitude={company.lon as number}
              latitude={company.lat as number}
              anchor="center"
            >
              <LedMarker
                company={company}
                markerOffset={markerOffsets[`${company.company_id}-${index}`]}
                labelOffset={labelOffsets[`${company.company_id}-${index}`]}
                onMouseEnter={() => setHovered(company)}
                onMouseLeave={() => setHovered(prev => (prev?.company_id === company.company_id ? null : prev))}
                onClick={() => requestCompanyRoute(company)}
              />
            </Marker>
          ))}

        {hovered && hovered.lat != null && hovered.lon != null && (
          <Popup
            longitude={hovered.lon}
            latitude={hovered.lat}
            closeButton={false}
            closeOnClick={false}
            anchor="top"
            offset={16}
          >
            <div className="techcard-popup">
              <div className="techcard-popup__name">{hovered.name}</div>
              <div className="techcard-popup__address">
                {hovered.address || hovered.postal_code || '住所未登録'}
              </div>
            </div>
          </Popup>
        )}
      </Map>
      </div>
      <div className="absolute top-3 right-3 z-20 w-[420px] max-w-[92vw] pointer-events-auto">
        <div className="rounded border border-slate-700 bg-slate-900/85 p-2 shadow-lg">
          <div className="text-xs text-slate-300 mb-1">企業検索（Escでルート/フォーカス解除）</div>
          <input
            type="text"
            value={companySearchQuery}
            onChange={event => setCompanySearchQuery(event.target.value)}
            placeholder="会社名・支店名・住所で検索"
            className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
          />
          {companySearchQuery.trim() && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded border border-slate-700 bg-slate-950/80">
              {companySearchResults.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">一致する企業・住所がありません。</div>
              )}
              {companySearchResults.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => focusPointOnMap(item)}
                  className="w-full border-b border-slate-800 px-3 py-2 text-left hover:bg-slate-800/70 last:border-b-0"
                >
                  <div className="text-sm font-medium text-slate-100">{item.point.name}</div>
                  <div className="text-xs text-slate-400">{item.address || '住所未登録'}</div>
                </button>
              ))}
            </div>
          )}
          {focusedSearchPoint && (
            <div className="mt-2 rounded border border-cyan-800/60 bg-cyan-950/40 px-2 py-1.5 text-xs text-cyan-100">
              フォーカス中: {focusedSearchPoint.point.name}
              <span className="ml-1 text-cyan-300">
                ({focusedSearchPoint.address || '住所未登録'})
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="absolute top-3 left-3 z-20 w-[380px] max-w-[92vw] max-h-[calc(100%-1.5rem)] overflow-y-auto pr-1 space-y-2 pointer-events-none">
        {!loading && points.length === 0 && (
          <div className="rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-base text-slate-200">
            会社の位置情報がまだありません。
          </div>
        )}
        {routeLoading && (
          <div data-testid="map-route-loading" className="rounded border border-sky-800 bg-sky-950/70 px-3 py-2 text-base text-sky-200">
            ルート取得中: 自社 → {pendingTargetName || '選択先'}
          </div>
        )}
        {routeError && (
          <div data-testid="map-route-error" className="rounded border border-rose-800 bg-rose-950/70 px-3 py-2 text-base text-rose-200">
            {routeError}
          </div>
        )}
        {selectedRoute && !routeLoading && !routeError && (
          <div data-testid="map-route-panel" className="rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100">
            <div className="font-semibold text-base text-slate-100">
              {selectedRoute.from_company_name} → {selectedRoute.to_company_name}
            </div>
            <div className="mt-1 text-sm text-slate-200">
              行き先住所: {selectedRoute.to_company_address || '未登録'}
            </div>
            <div data-testid="map-route-distance" className="mt-1 text-sm text-slate-200">
              距離: {formatDistanceLabel(selectedRoute)}
              {selectedRoute.duration_min != null ? ` / 所要: ${selectedRoute.duration_min.toFixed(1)} 分` : ''}
            </div>
            <div className="mt-1 text-sm text-slate-300">
              経路: {selectedRoute.effective_mode === 'intra_pref_local'
                ? '県内（一般道優先）'
                : selectedRoute.effective_mode === 'intra_pref_local_fallback'
                  ? '県内（一般道優先→通常へフォールバック）'
                  : selectedRoute.effective_mode === 'intra_pref_straight_fallback'
                    ? '県内（直線フォールバック）'
                    : selectedRoute.effective_mode === 'inter_pref_straight_fallback'
                      ? '県外（直線フォールバック）'
                      : '県外（一般道+高速）'}
              {selectedRoute.cached ? ' / キャッシュ' : ' / API最新'}
              {selectedRoute.provider ? ` / ${selectedRoute.provider}` : ''}
            </div>
            {routeDisplaySteps.length > 0 && (
              <div data-testid="map-route-steps" className="mt-1 text-xs text-slate-300">
                乗降・乗換・道路表示: {routeDisplaySteps.length} 箇所
              </div>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0 w-6 border-t-2 border-cyan-300" />
                実ルート
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0 w-6 border-t-2 border-dashed border-orange-400" />
                直線フォールバック
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TechCardMap;
