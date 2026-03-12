import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

type EventDetailData = {
  id: number;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  year?: number | null;
  participants: { id: number; name: string; company_name?: string | null }[];
  companies: { id: number; name: string }[];
};

type ContactOption = {
  id: number;
  name: string;
  company?: { name?: string | null } | null;
};

const EventDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetailData | null>(null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchEvent = async (eventId: string) => {
    try {
      const response = await axios.get<EventDetailData>(`http://localhost:8000/events/${eventId}`);
      setEvent(response.data);
      setError(null);
    } catch {
      setError('イベント情報の取得に失敗しました。');
    }
  };

  useEffect(() => {
    if (!id) return;
    fetchEvent(id);
  }, [id]);

  useEffect(() => {
    axios
      .get<ContactOption[]>('http://localhost:8000/contacts', { params: { limit: 2000 } })
      .then(response => setContacts(response.data || []))
      .catch(() => setContacts([]));
  }, []);

  const participantIds = useMemo(() => new Set((event?.participants || []).map(item => item.id)), [event]);

  const filteredContacts = useMemo(() => {
    const value = search.trim().toLowerCase();
    return contacts.filter(contact => {
      if (participantIds.has(contact.id)) return false;
      if (!value) return true;
      const companyName = contact.company?.name || '';
      return contact.name.toLowerCase().includes(value) || companyName.toLowerCase().includes(value);
    });
  }, [contacts, search, participantIds]);

  const toggleContact = (contactId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const handleAddParticipants = async () => {
    if (!id || selectedIds.size === 0) return;
    setMessage(null);
    setError(null);
    try {
      await axios.post(`http://localhost:8000/events/${id}/participants`, Array.from(selectedIds));
      setMessage('参加者を追加しました。');
      setSelectedIds(new Set());
      await fetchEvent(id);
    } catch {
      setError('参加者追加に失敗しました。');
    }
  };

  const handleRemoveParticipant = async (contactId: number) => {
    if (!id) return;
    setMessage(null);
    setError(null);
    try {
      await axios.delete(`http://localhost:8000/events/${id}/participants/${contactId}`);
      setMessage('参加者を削除しました。');
      await fetchEvent(id);
    } catch {
      setError('参加者削除に失敗しました。');
    }
  };

  if (!id) {
    return <div className="p-6">イベントIDが見つかりません。</div>;
  }

  if (!event) {
    return <div className="p-6">読み込み中...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">イベント詳細</h1>
        <button type="button" onClick={() => navigate(-1)} className="text-sm text-gray-600">
          戻る
        </button>
      </div>

      {message && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{event.name}</h2>
          <div className="text-sm text-gray-600">
            {event.start_date || event.end_date ? (
              <span>
                {event.start_date || '-'} 〜 {event.end_date || '-'}
              </span>
            ) : (
              <span>日程未登録</span>
            )}
          </div>
          {event.location && <div className="text-sm text-gray-600">場所: {event.location}</div>}
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6">
          <div>
            <h3 className="text-sm font-semibold mb-2">参加者</h3>
            <div className="border rounded p-3 max-h-[360px] overflow-y-auto">
              {event.participants.length === 0 && (
                <div className="text-sm text-gray-500">参加者が登録されていません。</div>
              )}
              {event.participants.map(participant => (
                <div key={participant.id} className="flex items-center justify-between text-sm border-b last:border-b-0 py-2">
                  <div>
                    <div className="font-medium">{participant.name}</div>
                    {participant.company_name && (
                      <div className="text-xs text-gray-500">{participant.company_name}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipant(participant.id)}
                    className="text-xs text-red-600"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">会社</h3>
              <div className="text-sm text-gray-600">
                {event.companies.length === 0 && '登録なし'}
                {event.companies.length > 0 && event.companies.map(company => company.name).join(' / ')}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">参加者を追加</h3>
            <input
              type="text"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-full border rounded px-3 py-2 text-sm mb-2"
              placeholder="氏名・会社で検索"
            />
            <div className="border rounded max-h-[360px] overflow-y-auto">
              {filteredContacts.map(contact => (
                <label key={contact.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(contact.id)}
                    onChange={() => toggleContact(contact.id)}
                  />
                  <span className="font-medium">{contact.name}</span>
                  {contact.company?.name && (
                    <span className="text-xs text-gray-500">({contact.company.name})</span>
                  )}
                </label>
              ))}
              {filteredContacts.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-500">追加可能な連絡先がありません。</div>
              )}
            </div>
            <button
              type="button"
              onClick={handleAddParticipants}
              className="mt-3 w-full bg-gray-900 text-white py-2 rounded"
            >
              選択した参加者を追加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventDetail;
