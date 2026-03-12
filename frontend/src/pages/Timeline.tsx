import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type EventItem = {
  id: number;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  year?: number | null;
};

type EventDetail = {
  id: number;
  participants: { id: number; name: string; company_name?: string | null }[];
};

const Timeline: React.FC = () => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, EventDetail>>({});

  useEffect(() => {
    axios.get<EventItem[]>('http://localhost:8000/events')
      .then(res => setEvents(res.data || []))
      .catch(() => setEvents([]));
  }, []);

  const eventsByYear = useMemo(() => {
    const map = new Map<number, EventItem[]>();
    events.forEach(event => {
      const yearValue = event.year || (event.start_date ? new Date(event.start_date).getFullYear() : new Date().getFullYear());
      if (!map.has(yearValue)) {
        map.set(yearValue, []);
      }
      map.get(yearValue)?.push(event);
    });
    Array.from(map.values()).forEach(list => {
      list.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    });
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [events]);

  const toggleEvent = async (eventId: number) => {
    if (expandedId === eventId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(eventId);
    if (!details[eventId]) {
      try {
        const res = await axios.get<EventDetail>(`http://localhost:8000/events/${eventId}`);
        setDetails(prev => ({ ...prev, [eventId]: res.data }));
      } catch {
        setDetails(prev => ({ ...prev, [eventId]: { id: eventId, participants: [] } }));
      }
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">タイムライン</h1>
      <div className="space-y-6">
        {eventsByYear.map(([year, items]) => (
          <div key={year} className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-semibold mb-3">{year}</h2>
            <div className="space-y-2">
              {items.map(event => (
                <div key={event.id} className="border rounded p-3">
                  <button
                    type="button"
                    onClick={() => toggleEvent(event.id)}
                    className="w-full text-left flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{event.name}</div>
                      <div className="text-xs text-gray-500">
                        {event.start_date || '-'}{event.end_date ? ` 〜 ${event.end_date}` : ''}
                        {event.location ? ` / ${event.location}` : ''}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">{expandedId === event.id ? '▲' : '▼'}</span>
                  </button>
                  {expandedId === event.id && (
                    <div className="mt-3 text-sm text-gray-700">
                      {(details[event.id]?.participants || []).length === 0 && '参加者がいません。'}
                      {(details[event.id]?.participants || []).length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {details[event.id].participants.map(participant => (
                            <span key={participant.id} className="px-2 py-1 rounded bg-gray-100">
                              {participant.name}
                              {participant.company_name ? ` (${participant.company_name})` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {eventsByYear.length === 0 && <div className="text-sm text-gray-500">イベントがありません。</div>}
      </div>
    </div>
  );
};

export default Timeline;
