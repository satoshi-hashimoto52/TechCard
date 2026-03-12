import React, { useEffect, useState } from 'react';
import axios from 'axios';
import TechCardMap from '../components/TechCardMap';
import { CompanyMapPoint } from '../components/LedJapanMap';

type EventItem = {
  id: number;
  name: string;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

const MapView: React.FC = () => {
  const [companyMap, setCompanyMap] = useState<CompanyMapPoint[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios
      .get<CompanyMapPoint[]>('http://localhost:8000/stats/company-map')
      .then(res => setCompanyMap(res.data || []))
      .catch(() => setCompanyMap([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    axios
      .get<EventItem[]>('http://localhost:8000/events')
      .then(res => setEvents(res.data || []))
      .catch(() => setEvents([]));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">地図（未使用）</h1>
      <p className="text-sm text-gray-500 mb-4">
        ダッシュボードに地図が統合されたため、このページは現在使用していません。
      </p>
      <div className="bg-white rounded-lg shadow p-4">
        <TechCardMap companies={companyMap} loading={loading} />
      </div>
      <div className="mt-4 bg-white rounded-lg shadow p-4">
        <h2 className="text-sm font-semibold mb-2">イベント場所</h2>
        <div className="text-sm text-gray-600 space-y-1">
          {events.length === 0 && <div>イベントがありません。</div>}
          {events.map(event => (
            <div key={event.id}>
              {event.name}
              {event.location ? ` / ${event.location}` : ' / 場所未登録'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MapView;
