import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Map, { Marker, NavigationControl, Popup, MapRef, Source, Layer } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import LedMarker from './LedMarker';
import CompanyCluster from './CompanyCluster';
import GeocodeProgress from './GeocodeProgress';
import { CompanyMapPoint } from './LedJapanMap';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

const TechCardMap: React.FC<{ companies: CompanyMapPoint[]; loading?: boolean }> = ({ companies, loading }) => {
  const mapRef = useRef<MapRef | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const mapLoadedRef = useRef(false);
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<CompanyMapPoint | null>(null);
  const [viewState, setViewState] = useState({ longitude: 138, latitude: 37, zoom: 5 });
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [labelOffsets, setLabelOffsets] = useState<Record<string, { x: number; y: number }>>({});

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
          if (!response.ok || !contentType.includes('application/json')) {
            throw new Error(`regions status=${response.status} type=${contentType}`);
          }
          regionData = await response.json();
        } catch (err) {
          console.warn('region source load failed, fallback to japan.geojson', err);
          useRegions = false;
          try {
            const response = await fetch('/japan.geojson', { cache: 'no-cache' });
            const contentType = response.headers.get('content-type') || '';
            if (response.ok && contentType.includes('application/json')) {
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

      const onReady = () => {
        console.log('regions source', map.getSource('regions'));
        console.log('layers', map.getStyle()?.layers);
        ensureRegions();
        const layers = map.getStyle()?.layers || [];
        layers.forEach((layer: any) => {
          if (layer.type !== 'symbol' || !layer.id) return;
          const id = layer.id.toLowerCase();
          try {
            if (id.includes('admin-1') || id.includes('state') || id.includes('province')) {
              map.setPaintProperty(layer.id, 'text-color', '#facc15');
              map.setPaintProperty(layer.id, 'text-halo-color', '#0f172a');
              map.setPaintProperty(layer.id, 'text-halo-width', 1.6);
              map.setLayoutProperty(layer.id, 'text-size', 18);
            } else if (id.includes('admin-2') || id.includes('municipality')) {
              map.setPaintProperty(layer.id, 'text-color', '#93c5fd');
              map.setPaintProperty(layer.id, 'text-halo-color', '#0f172a');
              map.setPaintProperty(layer.id, 'text-halo-width', 1);
              map.setLayoutProperty(layer.id, 'text-size', 11);
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

  const handleHover = useCallback((event: any) => {
    const features = event.features as any[] | undefined;
    if (!features || features.length === 0) {
      setHovered(null);
      return;
    }
    const feature = features[0];
    const companyId = Number(feature.properties?.company_id);
    const company = companies.find(item => item.company_id === companyId);
    setHovered(company || null);
  }, [companies]);

  const handleClick = useCallback((event: any) => {
    const features = event.features as any[] | undefined;
    if (!features || features.length === 0) return;
    const feature = features[0];
    const companyId = Number(feature.properties?.company_id);
    const company = companies.find(item => item.company_id === companyId);
    if (company) {
      navigate('/contacts', { state: { openCompany: company.name } });
    }
  }, [companies, navigate]);

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
              'circle-radius': 4,
              'circle-color': '#00ffff',
              'circle-blur': 0.8,
              'circle-opacity': 0.85,
            }}
          />
        </Source>

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
            return (
              <Marker key={`cluster-single-${singleId}`} longitude={longitude} latitude={latitude}>
                <CompanyCluster
                  count={1}
                  onClick={() => {
                    if (!Number.isNaN(singleId)) {
                      const company = companies.find(item => item.company_id === singleId);
                      if (company) {
                        navigate('/contacts', { state: { openCompany: company.name } });
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
                onClick={() => navigate('/contacts', { state: { openCompany: company.name } })}
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
      <GeocodeProgress companies={companies} />
      {loading && <p className="mt-2 text-sm text-gray-400">位置情報を再取得中...</p>}
      {!loading && points.length === 0 && (
        <p className="mt-2 text-sm text-gray-400">会社の位置情報がまだありません。</p>
      )}
    </div>
  );
};

export default TechCardMap;
