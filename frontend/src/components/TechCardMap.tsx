import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Map, { Marker, NavigationControl, Popup, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import LedMarker from './LedMarker';
import CompanyCluster from './CompanyCluster';
import { CompanyMapPoint } from './LedJapanMap';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

type RouteLine = {
  type: 'LineString';
  coordinates: [number, number][];
};

type CompanyRouteResponse = {
  from_company_id: number;
  from_company_name: string;
  to_company_id: number;
  to_company_name: string;
  to_company_address?: string | null;
  from_prefecture?: string | null;
  to_prefecture?: string | null;
  policy: string;
  effective_mode: string;
  distance_m: number;
  distance_km: number;
  duration_s?: number | null;
  duration_min?: number | null;
  geometry: RouteLine;
  cached: boolean;
  provider: string;
  updated_at?: string | null;
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
        console.log('regions source', map.getSource('regions'));
        console.log('layers', map.getStyle()?.layers);
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
    console.log('companies', companies);
    console.log('points', points);
  }, [companies, points]);

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
      setSelectedRoute(null);
      setRouteError(null);
      setRouteLoading(false);
      setPendingTargetName(null);
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    setPendingTargetName(company.name || null);
    axios
      .get<CompanyRouteResponse>('http://localhost:8000/stats/company-route', {
        params: {
          to_company_id: company.company_id,
          to_lat: company.lat,
          to_lon: company.lon,
          to_address: company.address,
        },
      })
      .then(response => {
        const route = response.data;
        setSelectedRoute(route);
        if (route.geometry?.coordinates?.length) {
          fitRouteToMap(route.geometry.coordinates);
        }
      })
      .catch(error => {
        const detail = error?.response?.data?.detail;
        setRouteError(typeof detail === 'string' ? detail : 'ルート取得に失敗しました。');
      })
      .finally(() => {
        setRouteLoading(false);
        setPendingTargetName(null);
      });
  }, [fitRouteToMap]);

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
      const screen = map.project([point.lon, point.lat]);
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
      offsets[`${point.company_id}-${index}`] = chosen;
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
  }, [bounds, points, viewState.zoom]);

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
                'line-color': 'rgba(3, 7, 18, 0.95)',
                'line-width': 8,
                'line-opacity': 0.75,
              }}
            />
            <Layer
              id="selected-route-line"
              type="line"
              paint={{
                'line-color': '#22d3ee',
                'line-width': 5,
                'line-opacity': 0.95,
              }}
            />
          </Source>
        )}

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
      <div className="absolute top-3 left-3 right-3 z-20 space-y-2 pointer-events-none">
        {!loading && points.length === 0 && (
          <div className="rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-base text-slate-200">
            会社の位置情報がまだありません。
          </div>
        )}
        {routeLoading && (
          <div className="rounded border border-sky-800 bg-sky-950/70 px-3 py-2 text-base text-sky-200">
            ルート取得中: 自社 → {pendingTargetName || '選択先'}
          </div>
        )}
        {routeError && (
          <div className="rounded border border-rose-800 bg-rose-950/70 px-3 py-2 text-base text-rose-200">
            {routeError}
          </div>
        )}
        {selectedRoute && !routeLoading && !routeError && (
          <div className="rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100">
            <div className="font-semibold text-base text-slate-100">
              {selectedRoute.from_company_name} → {selectedRoute.to_company_name}
            </div>
            <div className="mt-1 text-sm text-slate-200">
              行き先住所: {selectedRoute.to_company_address || '未登録'}
            </div>
            <div className="mt-1 text-sm text-slate-200">
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
          </div>
        )}
      </div>
    </div>
  );
};

export default TechCardMap;
