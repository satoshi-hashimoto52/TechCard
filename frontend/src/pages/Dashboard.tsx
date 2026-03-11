import React, { useEffect, useState } from 'react';
import axios from 'axios';
import LedJapanMap, { CompanyMapPoint } from '../components/LedJapanMap';
import GeocodeProgress from '../components/GeocodeProgress';

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

type CompanyDiagnostics = {
  missing_addresses: { company_id: number; name: string }[];
  invalidated_coords: { company_id: number; name: string; reason: string }[];
  short_addresses: { company_id: number; name: string }[];
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
  const [companyMapLoading, setCompanyMapLoading] = useState(false);
  const [companyDiagnostics, setCompanyDiagnostics] = useState<CompanyDiagnostics | null>(null);
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

  useEffect(() => {
    axios.get<CompanyDiagnostics>('http://localhost:8000/stats/company-map/diagnostics')
      .then(response => setCompanyDiagnostics(response.data))
      .catch(() => setCompanyDiagnostics(null));
  }, []);

  const refreshCompanyMap = () => {
    setCompanyMapLoading(true);
    axios.get<CompanyMapPoint[]>('http://localhost:8000/stats/company-map?refresh=1')
      .then(response => setCompanyMap(response.data))
      .catch(() => setCompanyMap([]))
      .finally(() => setCompanyMapLoading(false));
    axios.get<CompanyDiagnostics>('http://localhost:8000/stats/company-map/diagnostics')
      .then(response => setCompanyDiagnostics(response.data))
      .catch(() => setCompanyDiagnostics(null));
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
        <div className="w-full overflow-hidden border rounded bg-slate-950">
          <LedJapanMap points={companyMap} loading={companyMapLoading} />
        </div>
        <GeocodeProgress companies={companyMap} />
        {companyDiagnostics && (
          <div className="mt-4 space-y-3 text-sm text-gray-600">
            {companyDiagnostics.invalidated_coords.length > 0 && (
              <div>
                <p className="font-semibold text-gray-700">誤座標（無効化）</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {companyDiagnostics.invalidated_coords.map(item => (
                    <span key={item.company_id} className="px-2 py-1 rounded bg-rose-50 text-rose-700">
                      {item.name}（{item.reason}）
                    </span>
                  ))}
                </div>
              </div>
            )}
            {companyDiagnostics.short_addresses.length > 0 && (
              <div>
                <p className="font-semibold text-gray-700">住所が短すぎる（市区町村未満）</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {companyDiagnostics.short_addresses.map(item => (
                    <span key={item.company_id} className="px-2 py-1 rounded bg-slate-100 text-slate-700">
                      {item.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {companyDiagnostics.missing_addresses.length > 0 && (
              <div>
                <p className="font-semibold text-gray-700">住所未登録の会社</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {companyDiagnostics.missing_addresses.map(item => (
                    <span key={item.company_id} className="px-2 py-1 rounded bg-amber-50 text-amber-700">
                      {item.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
