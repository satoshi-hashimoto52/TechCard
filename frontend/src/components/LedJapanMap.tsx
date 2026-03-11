import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Map, { Marker, Popup, NavigationControl, MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { geoBounds } from 'd3-geo';
import 'maplibre-gl/dist/maplibre-gl.css';

export type CompanyMapPoint = {
  company_id: number;
  name: string;
  count: number;
  lat: number | null;
  lon: number | null;
  is_self: boolean;
  postal_code?: string | null;
  address?: string | null;
  city?: string | null;
  geocode_progress?: {
    success: number;
    total: number;
  };
};

type LedJapanMapProps = {
  points: CompanyMapPoint[];
  loading?: boolean;
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const LedJapanMap: React.FC<LedJapanMapProps> = ({ points, loading }) => {
  const navigate = useNavigate();
  const mapRef = useRef<MapRef | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState<CompanyMapPoint | null>(null);
  const [geojson, setGeojson] = useState<any | null>(null);
  const logRef = useRef({ geoLoaded: false, dotCount: -1, companyCount: -1, validCount: -1 });

  const visiblePoints = useMemo(
    () => points.filter(point => point.lat != null && point.lon != null),
    [points],
  );

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson')
      .then(response => response.json())
      .then(data => {
        setGeojson(data);
        if (!logRef.current.geoLoaded) {
          logRef.current.geoLoaded = true;
          console.info('geojson loaded');
        }
      })
      .catch(() => {
        console.error('geojson load failed');
        setGeojson(null);
      });
  }, []);

  const drawDots = useCallback(() => {
    const map = mapRef.current?.getMap();
    const canvas = canvasRef.current;
    if (!map || !canvas || !geojson) return;
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const zoom = map.getZoom();
    const spacing = Math.max(4, Math.min(8, 8 - (zoom - 4) * 0.4));
    const radius = 2;

    const bounds = geoBounds(geojson);
    const minLon = Math.max(123, bounds[0][0]);
    const minLat = Math.max(24, bounds[0][1]);
    const maxLon = Math.min(146, bounds[1][0]);
    const maxLat = Math.min(46, bounds[1][1]);
    const step = 0.25;

    ctx.save();
    ctx.beginPath();
    const drawPolygon = (coords: number[][]) => {
      coords.forEach((coord, index) => {
        const projected = map.project({ lng: coord[0], lat: coord[1] });
        if (index === 0) {
          ctx.moveTo(projected.x, projected.y);
        } else {
          ctx.lineTo(projected.x, projected.y);
        }
      });
      ctx.closePath();
    };
    geojson.features.forEach((feature: any) => {
      const geometry = feature.geometry;
      if (!geometry) return;
      if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach((ring: number[][]) => drawPolygon(ring));
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((polygon: number[][][]) => {
          polygon.forEach((ring: number[][]) => drawPolygon(ring));
        });
      }
    });
    ctx.clip();

    ctx.fillStyle = '#0a1a2a';
    ctx.shadowColor = 'rgba(10, 26, 42, 0.6)';
    ctx.shadowBlur = 3;

    let dotCount = 0;
    for (let lat = minLat; lat <= maxLat; lat += step) {
      for (let lon = minLon; lon <= maxLon; lon += step) {
        const projected = map.project({ lng: lon, lat });
        if (projected.x < 0 || projected.x > rect.width || projected.y < 0 || projected.y > rect.height) {
          continue;
        }
        ctx.beginPath();
        ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
        ctx.fill();
        dotCount += 1;
      }
    }
    ctx.restore();

    const companyCount = points.length;
    const validCount = visiblePoints.length;
    const log = logRef.current;
    if (log.dotCount !== dotCount || log.companyCount !== companyCount || log.validCount !== validCount) {
      log.dotCount = dotCount;
      log.companyCount = companyCount;
      log.validCount = validCount;
      console.info('dot count', dotCount);
      console.info('company count', companyCount);
      console.info('valid coordinate count', validCount);
    }
    if (dotCount === 0) {
      console.error('LED map generation failed');
    }
  }, [geojson, points, visiblePoints]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      drawDots();
    });
  }, [drawDots]);

  useEffect(() => {
    scheduleDraw();
  }, [scheduleDraw, geojson, points]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const handler = () => scheduleDraw();
    map.on('move', handler);
    map.on('zoom', handler);
    map.on('resize', handler);
    map.on('moveend', handler);
    map.on('load', handler);
    return () => {
      map.off('move', handler);
      map.off('zoom', handler);
      map.off('resize', handler);
      map.off('moveend', handler);
      map.off('load', handler);
    };
  }, [scheduleDraw]);

  return (
    <div className="led-japan-map">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 138.0,
          latitude: 37.5,
          zoom: 5,
        }}
        mapStyle={MAP_STYLE}
        mapLib={maplibregl}
        minZoom={4}
        maxZoom={15}
        style={{ width: '100%', height: 520 }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        {visiblePoints.map(point => (
          <Marker
            key={point.company_id}
            longitude={point.lon as number}
            latitude={point.lat as number}
            anchor="center"
          >
            <button
              type="button"
              className={`led-company-marker ${point.is_self ? 'led-company-marker--self' : ''}`}
              onMouseEnter={() => setHovered(point)}
              onMouseLeave={() => setHovered(prev => (prev?.company_id === point.company_id ? null : prev))}
              onFocus={() => setHovered(point)}
              onBlur={() => setHovered(prev => (prev?.company_id === point.company_id ? null : prev))}
              onClick={() => navigate('/contacts', { state: { openCompany: point.name } })}
            >
              <span className="led-company-marker__led">
                <span className="led-company-marker__pulse" />
              </span>
              <span className="led-company-marker__label">
                <span className="led-company-marker__name">{point.name}</span>
                <span className="led-company-marker__city">{point.city || ''}</span>
              </span>
            </button>
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
            <div className="led-company-popup">
              <div className="led-company-popup__name">{hovered.name}</div>
              <div className="led-company-popup__address">
                {hovered.address || hovered.postal_code || '住所未登録'}
              </div>
            </div>
          </Popup>
        )}
      </Map>
      <canvas ref={canvasRef} className="led-japan-map__dots" />
      {loading && <p className="mt-2 text-sm text-gray-400">位置情報を再取得中...</p>}
      {!loading && visiblePoints.length === 0 && (
        <p className="mt-2 text-sm text-gray-400">会社の位置情報がまだありません。</p>
      )}
      <p className="mt-2 text-xs text-gray-500">※会社住所（郵便番号/住所）を元に自動配置しています。</p>
    </div>
  );
};

export default LedJapanMap;
