import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type ContactOption = {
  id: number;
  name: string;
  company?: { name?: string | null } | null;
};

const EventRegister: React.FC = () => {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [location, setLocation] = useState('');
  const [year, setYear] = useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    axios
      .get<ContactOption[]>('http://localhost:8000/contacts', { params: { limit: 1000 } })
      .then(response => setContacts(response.data || []))
      .catch(() => setContacts([]));
  }, []);

  const filteredContacts = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return contacts;
    return contacts.filter(contact => {
      const companyName = contact.company?.name || '';
      return (
        contact.name?.toLowerCase().includes(value) ||
        companyName.toLowerCase().includes(value)
      );
    });
  }, [contacts, search]);

  const toggleContact = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    setMessage(null);
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('イベント名を入力してください。');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        name: trimmedName,
        start_date: startDate || null,
        end_date: endDate || null,
        location: location.trim() || null,
        year: year ? Number(year) : null,
        contact_ids: Array.from(selectedIds),
      };
      await axios.post('http://localhost:8000/events', payload);
      setMessage('イベントを登録しました。');
      setName('');
      setStartDate('');
      setEndDate('');
      setLocation('');
      setYear('');
      setSelectedIds(new Set());
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError('同名のイベントが既に存在します。');
      } else {
        setError('イベント登録に失敗しました。');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">イベント登録</h1>
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
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">イベント名</label>
              <input
                type="text"
                value={name}
                onChange={event => setName(event.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="例: IIFES 2024"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">開催期間</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={event => setStartDate(event.target.value)}
                  className="border rounded px-3 py-2"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={event => setEndDate(event.target.value)}
                  className="border rounded px-3 py-2"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">場所</label>
              <input
                type="text"
                value={location}
                onChange={event => setLocation(event.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="例: 東京ビッグサイト"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">開催年</label>
              <input
                type="number"
                value={year}
                onChange={event => setYear(event.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="2024"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gray-900 text-white py-2 rounded disabled:opacity-50"
            >
              {isSubmitting ? '登録中...' : 'イベントを登録'}
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">参加者（連絡先）</h2>
              <span className="text-xs text-gray-500">選択: {selectedIds.size}</span>
            </div>
            <input
              type="text"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="氏名・会社で検索"
            />
            <div className="border rounded max-h-[420px] overflow-y-auto">
              {filteredContacts.map(contact => (
                <label
                  key={contact.id}
                  className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-sm"
                >
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
                <div className="px-3 py-4 text-sm text-gray-500">該当する連絡先がありません。</div>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EventRegister;
