import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
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
};

type CompanyMapProps = {
  points: CompanyMapPoint[];
  loading?: boolean;
};

const MAP_STYLE = 'https://demotiles.maplibre.org/style.json';

const CompanyMap: React.FC<CompanyMapProps> = ({ points, loading }) => {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<CompanyMapPoint | null>(null);

  const visiblePoints = useMemo(
    () => points.filter(point => point.lat != null && point.lon != null),
    [points],
  );

  return (
    <div className="company-map">
      <Map
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
              className={`company-led-marker ${point.is_self ? 'company-led-marker--self' : ''}`}
              onMouseEnter={() => setHovered(point)}
              onMouseLeave={() => setHovered(prev => (prev?.company_id === point.company_id ? null : prev))}
              onFocus={() => setHovered(point)}
              onBlur={() => setHovered(prev => (prev?.company_id === point.company_id ? null : prev))}
              onClick={() => navigate('/contacts', { state: { openCompany: point.name } })}
            >
              <span className="company-led-wrapper">
                <span className="company-led-core" />
                <span className="company-led-pulse" />
              </span>
              <span className="company-led-label">
                <span className="company-led-label__name">{point.name}</span>
                <span className="company-led-label__city">{point.city || ''}</span>
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
            offset={12}
          >
            <div className="company-led-popup">
              <div className="company-led-popup__name">{hovered.name}</div>
              <div className="company-led-popup__address">
                {hovered.address || hovered.postal_code || '住所未登録'}
              </div>
            </div>
          </Popup>
        )}
      </Map>
      {loading && (
        <p className="mt-2 text-sm text-gray-500">位置情報を再取得中...</p>
      )}
      {!loading && visiblePoints.length === 0 && (
        <p className="mt-2 text-sm text-gray-500">会社の位置情報がまだありません。</p>
      )}
      <p className="mt-2 text-xs text-gray-500">※会社住所（郵便番号/住所）を元に自動配置しています。</p>
    </div>
  );
};

export default CompanyMap;
