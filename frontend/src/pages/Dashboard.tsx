import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

type Summary = {
  counts: {
    contacts: number;
    companies: number;
    tags: number;
    meetings: number;
  };
  lists: {
    contacts: { id: number; name: string }[];
    companies: { name: string; count: number }[];
    tags: { name: string; count: number }[];
    meetings: { id: number; contact_name: string | null; company_name?: string | null; overlap: number }[];
  };
};

type CompanyMapPoint = {
  name: string;
  count: number;
  lat: number | null;
  lon: number | null;
  is_self: boolean;
};

type GeoJSONGeometry = {
  type: string;
  coordinates: any;
};

type GeoJSONFeature = {
  type: string;
  geometry: GeoJSONGeometry;
};

type GeoJSONData = {
  type: string;
  features: GeoJSONFeature[];
};

const MAP_WIDTH = 900;
const MAP_HEIGHT = 520;
const MAP_PAD = 16;
const MAP_SCALE_MIN = 0.6;
const MAP_SCALE_MAX = 3.0;

const collectCoords = (coords: any, acc: [number, number][]) => {
  if (!coords) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    acc.push([coords[0], coords[1]]);
    return;
  }
  if (Array.isArray(coords)) {
    coords.forEach(item => collectCoords(item, acc));
  }
};

const computeBounds = (geojson: GeoJSONData) => {
  const coords: [number, number][] = [];
  geojson.features.forEach(feature => {
    collectCoords(feature.geometry.coordinates, coords);
  });
  if (!coords.length) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  coords.forEach(([lon, lat]) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });
  const lonSpan = maxLon - minLon || 1;
  const latSpan = maxLat - minLat || 1;
  const scale = Math.min((MAP_WIDTH - MAP_PAD * 2) / lonSpan, (MAP_HEIGHT - MAP_PAD * 2) / latSpan);
  return { minLon, maxLon, minLat, maxLat, scale };
};

const buildPathFromRings = (
  rings: number[][][],
  project: (lon: number, lat: number) => { x: number; y: number },
) => (
  rings
    .map(ring => ring.map(([lon, lat], index) => {
      const { x, y } = project(lon, lat);
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    }).join(' ') + ' Z')
    .join(' ')
);

const buildGeometryPath = (
  geometry: GeoJSONGeometry,
  project: (lon: number, lat: number) => { x: number; y: number },
) => {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') {
    return buildPathFromRings(geometry.coordinates, project);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((rings: number[][][]) => buildPathFromRings(rings, project)).join(' ');
  }
  return '';
};

const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<Summary>({
    counts: {
      contacts: 0,
      companies: 0,
      tags: 0,
      meetings: 0,
    },
    lists: {
      contacts: [],
      companies: [],
      tags: [],
      meetings: [],
    },
  });
  const [expanded, setExpanded] = useState({
    contacts: false,
    companies: false,
    tags: false,
    meetings: false,
  });
  const [companyMap, setCompanyMap] = useState<CompanyMapPoint[]>([]);
  const [geojson, setGeojson] = useState<GeoJSONData | null>(null);
  const [companyMapLoading, setCompanyMapLoading] = useState(false);
  const [mapScale, setMapScale] = useState(1);
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const totalContacts = summary.counts.contacts || 1;

  useEffect(() => {
    axios.get<Summary>('http://localhost:8000/stats/summary')
      .then(response => setSummary(response.data))
      .catch(() => {
        setSummary({
          counts: {
            contacts: 0,
            companies: 0,
            tags: 0,
            meetings: 0,
          },
          lists: {
            contacts: [],
            companies: [],
            tags: [],
            meetings: [],
          },
        });
      });
  }, []);

  useEffect(() => {
    axios.get<CompanyMapPoint[]>('http://localhost:8000/stats/company-map')
      .then(response => setCompanyMap(response.data))
      .catch(() => setCompanyMap([]));
  }, []);

  const refreshCompanyMap = () => {
    setCompanyMapLoading(true);
    axios.get<CompanyMapPoint[]>('http://localhost:8000/stats/company-map?refresh=1')
      .then(response => setCompanyMap(response.data))
      .catch(() => setCompanyMap([]))
      .finally(() => setCompanyMapLoading(false));
  };

  useEffect(() => {
    fetch('/japan.geojson')
      .then(response => response.json())
      .then(data => setGeojson(data))
      .catch(() => setGeojson(null));
  }, []);

  const mapConfig = React.useMemo(() => {
    if (!geojson) return null;
    const bounds = computeBounds(geojson);
    if (!bounds) return null;
    const project = (lon: number, lat: number) => ({
      x: MAP_PAD + (lon - bounds.minLon) * bounds.scale,
      y: MAP_PAD + (bounds.maxLat - lat) * bounds.scale,
    });
    const paths = geojson.features
      .map(feature => buildGeometryPath(feature.geometry, project))
      .filter(Boolean);
    return { project, paths };
  }, [geojson]);

  const visiblePoints = companyMap.filter(point => point.lat != null && point.lon != null);
  const selfPoint = visiblePoints.find(point => point.is_self) || null;

  const zoomBy = (factor: number) => {
    setMapScale(prev => Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, prev * factor)));
  };

  const resetMapView = () => {
    setMapScale(1);
    setMapOffset({ x: 0, y: 0 });
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    zoomBy(factor);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
    isPanningRef.current = true;
    lastPointRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !lastPointRef.current) return;
    const dx = event.clientX - lastPointRef.current.x;
    const dy = event.clientY - lastPointRef.current.y;
    setMapOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastPointRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.currentTarget as HTMLDivElement).releasePointerCapture?.(event.pointerId);
    isPanningRef.current = false;
    lastPointRef.current = null;
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">ダッシュボード</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">連絡先数</h2>
          <p className="text-2xl">{summary.counts.contacts}</p>
          <div className="mt-2 text-sm text-gray-600">
            {(expanded.contacts ? summary.lists.contacts : summary.lists.contacts.slice(0, 3)).map(contact => (
              <div key={contact.id}>{contact.name}</div>
            ))}
            {summary.lists.contacts.length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(prev => ({ ...prev, contacts: !prev.contacts }))}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800"
              >
                {expanded.contacts ? '閉じる' : '全て表示'}
              </button>
            )}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">会社数</h2>
          <p className="text-2xl">{summary.counts.companies}</p>
          <div className="mt-2 space-y-2">
            {(expanded.companies ? summary.lists.companies : summary.lists.companies.slice(0, 5)).map(company => {
              const ratio = Math.round((company.count / totalContacts) * 100);
              return (
                <div key={company.name}>
                  <div className="flex items-center justify-between text-sm text-gray-700">
                    <span className="truncate">{company.name}</span>
                    <span className="ml-2 text-xs text-gray-500 whitespace-nowrap">
                      {company.count}件 ({ratio}%)
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-gray-200">
                    <div
                      className="h-2 rounded bg-emerald-500"
                      style={{ width: `${Math.min(100, ratio)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {summary.lists.companies.length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(prev => ({ ...prev, companies: !prev.companies }))}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800"
              >
                {expanded.companies ? '閉じる' : '全て表示'}
              </button>
            )}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">タグ数</h2>
          <p className="text-2xl">{summary.counts.tags}</p>
          <div className="mt-2 text-sm text-gray-600">
            {(expanded.tags ? summary.lists.tags : summary.lists.tags.slice(0, 3)).map(tag => (
              <div key={tag.name}>
                {tag.name} ({tag.count})
              </div>
            ))}
            {summary.lists.tags.length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(prev => ({ ...prev, tags: !prev.tags }))}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800"
              >
                {expanded.tags ? '閉じる' : '全て表示'}
              </button>
            )}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">Connections(Tag)</h2>
          <p className="text-2xl">{summary.counts.meetings}</p>
          <div className="mt-2 text-sm text-gray-600">
            {(expanded.meetings ? summary.lists.meetings : summary.lists.meetings.slice(0, 3)).map(meeting => (
              <div key={meeting.id}>
                {meeting.contact_name || 'Unknown'} ({meeting.overlap})
                {meeting.company_name ? ` / ${meeting.company_name}` : ''}
              </div>
            ))}
            {summary.lists.meetings.length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(prev => ({ ...prev, meetings: !prev.meetings }))}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800"
              >
                {expanded.meetings ? '閉じる' : '全て表示'}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-8 bg-white p-4 rounded-lg shadow">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">会社分布（日本地図）</h2>
          <button
            type="button"
            onClick={refreshCompanyMap}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
            disabled={companyMapLoading}
          >
            {companyMapLoading ? '再取得中...' : '位置情報を再取得'}
          </button>
        </div>
        {!mapConfig && (
          <p className="text-sm text-gray-500">地図データを読み込み中...</p>
        )}
        {mapConfig && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => zoomBy(1.2)}
                className="text-xs text-gray-600 border rounded px-2 py-1 hover:bg-gray-100"
              >
                拡大
              </button>
              <button
                type="button"
                onClick={() => zoomBy(0.85)}
                className="text-xs text-gray-600 border rounded px-2 py-1 hover:bg-gray-100"
              >
                縮小
              </button>
              <button
                type="button"
                onClick={resetMapView}
                className="text-xs text-gray-600 border rounded px-2 py-1 hover:bg-gray-100"
              >
                リセット
              </button>
              <span className="text-xs text-gray-400">ホイール/ドラッグで操作</span>
            </div>
            <div
              className="w-full overflow-hidden border rounded"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              style={{ touchAction: 'none', cursor: isPanningRef.current ? 'grabbing' : 'grab' }}
            >
              <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="w-full h-auto">
                <g transform={`translate(${mapOffset.x} ${mapOffset.y}) scale(${mapScale})`}>
                  <g>
                    {mapConfig.paths.map((d, index) => (
                      <path key={`jp-${index}`} d={d} fill="#f8fafc" stroke="#cbd5f5" strokeWidth="0.7" />
                    ))}
                  </g>
                  {selfPoint && visiblePoints.filter(point => !point.is_self).map(point => {
                    const start = mapConfig.project(selfPoint.lon as number, selfPoint.lat as number);
                    const end = mapConfig.project(point.lon as number, point.lat as number);
                    return (
                      <line
                        key={`line-${point.name}`}
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        stroke="#f87171"
                        strokeOpacity="0.35"
                        strokeWidth="1"
                      />
                    );
                  })}
                  {visiblePoints.map(point => {
                    const { x, y } = mapConfig.project(point.lon as number, point.lat as number);
                    const radius = Math.min(12, Math.max(4, 3 + Math.sqrt(point.count)));
                    const fill = point.is_self ? '#ef4444' : '#2563eb';
                    const labelOffset = radius + 4;
                    return (
                      <g key={`pt-${point.name}`}>
                        <circle cx={x} cy={y} r={point.is_self ? radius + 2 : radius} fill={fill} opacity="0.85">
                          <title>{`${point.name} (${point.count})`}</title>
                        </circle>
                        <text
                          x={x + labelOffset}
                          y={y - labelOffset}
                          fontSize={10}
                          fill="#0f172a"
                          stroke="#ffffff"
                          strokeWidth={2}
                          paintOrder="stroke"
                          dominantBaseline="middle"
                        >
                          {point.name}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
            {visiblePoints.length === 0 && (
              <p className="mt-2 text-sm text-gray-500">会社の位置情報がまだありません。</p>
            )}
            <p className="mt-2 text-xs text-gray-500">※会社住所（郵便番号/住所）を元に自動配置しています。</p>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
