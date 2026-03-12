import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

type CompanyDetailData = {
  id: number;
  name: string;
  group_id?: number | null;
  group_name?: string | null;
  tech_tags: string[];
  contacts: { id: number; name: string }[];
};

type CompanyGroup = {
  id: number;
  name: string;
};

type GroupSuggestion = {
  id: number;
  name: string;
};

const CompanyDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState<CompanyDetailData | null>(null);
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchDetail = async (companyId: string) => {
    try {
      const [detailRes, groupRes] = await Promise.all([
        axios.get<CompanyDetailData>(`http://localhost:8000/companies/${companyId}/detail`),
        axios.get<CompanyGroup[]>('http://localhost:8000/company-groups'),
      ]);
      setCompany(detailRes.data);
      setGroups(groupRes.data || []);
      setError(null);
    } catch {
      setError('会社情報の取得に失敗しました。');
    }
  };

  useEffect(() => {
    if (!id) return;
    fetchDetail(id);
  }, [id]);

  useEffect(() => {
    if (!company?.name) return;
    axios
      .get<GroupSuggestion[]>('http://localhost:8000/company-groups/suggest', { params: { name: company.name } })
      .then(res => setSuggestions(res.data || []))
      .catch(() => setSuggestions([]));
  }, [company?.name]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [groups]);

  const handleGroupChange = async (nextGroupId: number | null) => {
    if (!company || !id) return;
    if (isUpdating) return;
    setIsUpdating(true);
    setError(null);
    setMessage(null);
    try {
      await axios.put(`http://localhost:8000/companies/${id}/group`, { group_id: nextGroupId });
      setMessage('グループを更新しました。');
      await fetchDetail(id);
    } catch {
      setError('グループ更新に失敗しました。');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!id) {
    return <div className="p-6">会社IDが見つかりません。</div>;
  }

  if (!company) {
    return <div className="p-6">読み込み中...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">会社詳細</h1>
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

      <div className="bg-white rounded-lg shadow p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">{company.name}</h2>
        </div>

        <div>
          <label className="text-sm font-semibold">グループ</label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={company.group_id ?? ''}
              onChange={event => handleGroupChange(event.target.value ? Number(event.target.value) : null)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="">未設定</option>
              {sortedGroups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            {isUpdating && <span className="text-xs text-gray-500">更新中...</span>}
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 text-xs text-gray-500 flex flex-wrap items-center gap-2">
              <span>推測候補:</span>
              {suggestions.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleGroupChange(item.id)}
                  className="px-2 py-1 rounded border text-xs text-gray-700"
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-semibold">Tech</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {company.tech_tags.length === 0 && <span className="text-sm text-gray-500">未登録</span>}
            {company.tech_tags.map(tag => (
              <span key={tag} className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-semibold">連絡先</label>
          <div className="mt-2 space-y-1">
            {company.contacts.length === 0 && <div className="text-sm text-gray-500">連絡先がありません。</div>}
            {company.contacts.map(contact => (
              <button
                key={contact.id}
                type="button"
                onClick={() => navigate(`/contacts/${contact.id}`)}
                className="block text-left text-sm text-blue-600"
              >
                {contact.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyDetail;
