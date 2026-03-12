import React, { useEffect, useState } from 'react';
import axios from 'axios';

type CompanyGroup = {
  id: number;
  name: string;
  description?: string | null;
  company_ids: number[];
  aliases: string[];
};

type Company = {
  id: number;
  name: string;
  group_id?: number | null;
};

const CompanyGroups: React.FC = () => {
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [assignSelection, setAssignSelection] = useState<Record<number, number | ''>>({});

  const displayCompanyName = (name: string) => {
    const trimmed = name.trim();
    const match = trimmed.match(/^(.*?)(\\s*(支店|営業所|オフィス|Office|Branch)\\b.*)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return trimmed;
  };

  const fetchData = async () => {
    try {
      const [groupRes, companyRes] = await Promise.all([
        axios.get<CompanyGroup[]>('http://localhost:8000/company-groups'),
        axios.get<Company[]>('http://localhost:8000/companies', { params: { limit: 2000 } }),
      ]);
      setGroups(groupRes.data || []);
      setCompanies(companyRes.data || []);
    } catch {
      setError('グループ情報の取得に失敗しました。');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('グループ名を入力してください。');
      return;
    }
    try {
      await axios.post('http://localhost:8000/company-groups', {
        name: trimmed,
        description: description.trim() || null,
      });
      setName('');
      setDescription('');
      setMessage('グループを作成しました。');
      await fetchData();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setError('同名のグループが既に存在します。');
      } else {
        setError('グループ作成に失敗しました。');
      }
    }
  };

  const startEdit = (group: CompanyGroup) => {
    setEditingId(group.id);
    setEditName(group.name);
    setEditDescription(group.description || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditDescription('');
  };

  const saveEdit = async (groupId: number) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('グループ名を入力してください。');
      return;
    }
    try {
      await axios.put(`http://localhost:8000/company-groups/${groupId}`, {
        name: trimmed,
        description: editDescription.trim() || null,
      });
      setMessage('グループを更新しました。');
      cancelEdit();
      await fetchData();
    } catch {
      setError('グループ更新に失敗しました。');
    }
  };

  const handleAssignCompany = async (groupId: number) => {
    const companyId = assignSelection[groupId];
    if (!companyId) return;
    try {
      await axios.put(`http://localhost:8000/companies/${companyId}/group`, { group_id: groupId });
      setMessage('会社を追加しました。');
      setAssignSelection(prev => ({ ...prev, [groupId]: '' }));
      await fetchData();
    } catch {
      setError('会社の追加に失敗しました。');
    }
  };

  const handleRemoveCompany = async (companyId: number) => {
    try {
      await axios.put(`http://localhost:8000/companies/${companyId}/group`, { group_id: null });
      setMessage('会社を削除しました。');
      await fetchData();
    } catch {
      setError('会社の削除に失敗しました。');
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">会社グループ</h1>
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

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-sm font-semibold mb-3">グループ作成</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)_120px]">
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            className="border rounded px-3 py-2"
            placeholder="例: HITACHI Group"
          />
          <input
            type="text"
            value={description}
            onChange={event => setDescription(event.target.value)}
            className="border rounded px-3 py-2"
            placeholder="補足（任意）"
          />
          <button type="submit" className="bg-gray-900 text-white rounded px-4 py-2">
            作成
          </button>
        </form>
      </div>

      <div className="space-y-4">
        {groups.map(group => {
          const groupCompanies = companies.filter(company => company.group_id === group.id);
          const availableCompanies = companies.filter(company => !company.group_id);
          const selected = assignSelection[group.id] ?? '';

          return (
            <div key={group.id} className="bg-white rounded-lg shadow p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  {editingId === group.id ? (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={event => setEditName(event.target.value)}
                        className="border rounded px-3 py-2"
                      />
                      <input
                        type="text"
                        value={editDescription}
                        onChange={event => setEditDescription(event.target.value)}
                        className="border rounded px-3 py-2"
                        placeholder="補足（任意）"
                      />
                    </div>
                  ) : (
                    <>
                      <h3 className="text-lg font-semibold">{group.name}</h3>
                      {group.description && <p className="text-sm text-gray-500">{group.description}</p>}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {editingId === group.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => saveEdit(group.id)}
                        className="px-3 py-1 rounded bg-gray-900 text-white text-sm"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="px-3 py-1 rounded border text-sm"
                      >
                        キャンセル
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(group)}
                      className="px-3 py-1 rounded border text-sm"
                    >
                      編集
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-sm font-semibold mb-2">所属会社</div>
                <ul className="space-y-1">
                  {groupCompanies.length === 0 && (
                    <li className="text-sm text-gray-500">会社が登録されていません。</li>
                  )}
                  {groupCompanies.map(company => (
                    <li key={company.id} className="flex items-center justify-between text-sm">
                      <span>{company.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCompany(company.id)}
                        className="text-xs text-red-600"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <select
                  value={selected}
                  onChange={event =>
                    setAssignSelection(prev => ({
                      ...prev,
                      [group.id]: event.target.value ? Number(event.target.value) : '',
                    }))
                  }
                  className="border rounded px-3 py-2 text-sm"
                >
                  <option value="">会社を追加</option>
                  {availableCompanies.map(company => (
                    <option key={company.id} value={company.id}>
                      {displayCompanyName(company.name)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleAssignCompany(group.id)}
                  className="px-3 py-2 rounded bg-gray-800 text-white text-sm"
                >
                  追加
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CompanyGroups;
