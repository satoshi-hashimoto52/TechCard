import React, { useCallback, useEffect, useRef, useState } from 'react';
import TechCardMap from '../components/TechCardMap';
import { createAbortController, isAbortError } from '../lib/api';
import {
  CompanyDiagnostics,
  CompanyMapPoint,
  Summary,
  fetchCompanyDiagnostics as fetchCompanyDiagnosticsApi,
  fetchCompanyMap as fetchCompanyMapApi,
  fetchSummary as fetchSummaryApi,
} from '../services/statsService';


const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<Summary>({
    counts: {
      contacts: 0,
      companies: 0,
      prefectures: 0,
      tags: 0,
      meetings: 0,
      connectable_contacts: 0,
      connected_contacts: 0,
      connection_rate: 0,
    },
    lists: {
      contacts: [],
      companies: [],
      prefectures: [],
      tags: [],
      meetings: [],
    },
  });
  const [companyMap, setCompanyMap] = useState<CompanyMapPoint[]>([]);
  const [companyMapLoading, setCompanyMapLoading] = useState(false);
  const [companyDiagnostics, setCompanyDiagnostics] = useState<CompanyDiagnostics | null>(null);
  const companyMapAbortRef = useRef<AbortController | null>(null);
  const diagnosticsAbortRef = useRef<AbortController | null>(null);
  const prefectureItems = summary.lists.prefectures || [];
  const totalPrefectureCount = prefectureItems.reduce((sum, item) => sum + item.count, 0) || 1;
  const connectableContacts = Math.max(
    0,
    summary.counts.connectable_contacts ?? summary.counts.contacts - 1,
  );
  const connectedContacts = Math.max(
    0,
    summary.counts.connected_contacts ?? summary.counts.meetings,
  );
  const connectionRateRaw = connectableContacts > 0
    ? (summary.counts.connection_rate ?? (connectedContacts / connectableContacts) * 100)
    : 0;
  const connectionRate = Math.max(0, Math.min(100, connectionRateRaw));
  const connectionRateLabel = Number.isInteger(connectionRate)
    ? `${connectionRate}%`
    : `${connectionRate.toFixed(1)}%`;
  const topLimit = 3;
  const geocodeProgress = companyMap[0]?.geocode_progress;
  const geocodePercent = geocodeProgress
    ? Math.round((geocodeProgress.success / Math.max(1, geocodeProgress.total)) * 100)
    : 0;

  useEffect(() => {
    const controller = createAbortController();
    fetchSummaryApi({ signal: controller.signal })
      .then(response => setSummary(response.data))
      .catch(() => {
        if (controller.signal.aborted) return;
        setSummary({
          counts: {
            contacts: 0,
            companies: 0,
            prefectures: 0,
            tags: 0,
            meetings: 0,
            connectable_contacts: 0,
            connected_contacts: 0,
            connection_rate: 0,
          },
          lists: {
            contacts: [],
            companies: [],
            prefectures: [],
            tags: [],
            meetings: [],
          },
        });
      });
    return () => controller.abort();
  }, []);

  const fetchCompanyMap = useCallback((withRefresh = false) => {
    companyMapAbortRef.current?.abort();
    const controller = createAbortController();
    companyMapAbortRef.current = controller;
    return fetchCompanyMapApi(withRefresh, { signal: controller.signal })
      .then(response => setCompanyMap(response.data))
      .catch(err => {
        if (isAbortError(err)) return;
        console.warn('company-map load failed', err);
        setCompanyMap([]);
      });
  }, []);

  const fetchCompanyDiagnostics = useCallback(() => {
    diagnosticsAbortRef.current?.abort();
    const controller = createAbortController();
    diagnosticsAbortRef.current = controller;
    return fetchCompanyDiagnosticsApi({ signal: controller.signal })
      .then(response => setCompanyDiagnostics(response.data))
      .catch(err => {
        if (isAbortError(err)) return;
        setCompanyDiagnostics(null);
      });
  }, []);

  useEffect(() => {
    fetchCompanyMap();
    const timer = window.setInterval(() => {
      fetchCompanyMap();
    }, 3000);
    return () => {
      window.clearInterval(timer);
      companyMapAbortRef.current?.abort();
      companyMapAbortRef.current = null;
    };
  }, [fetchCompanyMap]);

  useEffect(() => {
    fetchCompanyDiagnostics();
    return () => {
      diagnosticsAbortRef.current?.abort();
      diagnosticsAbortRef.current = null;
    };
  }, [fetchCompanyDiagnostics]);

  const refreshCompanyMap = () => {
    setCompanyMapLoading(true);
    fetchCompanyMap(true)
      .finally(() => setCompanyMapLoading(false));
    fetchCompanyDiagnostics();
  };

  return (
    <div className="p-6 min-h-screen flex flex-col">
      <h1 className="text-2xl font-bold mb-4">ダッシュボード</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">接続率</h2>
          <p className="text-2xl">{connectionRateLabel}</p>
          <div className="mt-2">
            <div className="h-2 rounded bg-gray-200">
              <div
                className="h-2 rounded bg-emerald-500"
                style={{ width: `${connectionRate}%` }}
              />
            </div>
            <div className="mt-2 text-sm text-gray-600">
              接続済み {connectedContacts} / 対象 {connectableContacts}
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 text-sm text-gray-600 space-y-1">
              {summary.lists.companies.slice(0, topLimit).map(company => (
                <div key={company.name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{company.name}</span>
                  <span className="text-xs text-gray-500 whitespace-nowrap">{company.count}件</span>
                </div>
              ))}
              {summary.lists.companies.length === 0 && <div>データがありません。</div>}
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">会社数</h2>
          <p className="text-2xl">{summary.counts.companies}</p>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-sm font-semibold text-gray-700">
              都道府県数: {summary.counts.prefectures ?? 0}
            </div>
            <div className="mt-1 text-sm text-gray-600 space-y-1">
              {prefectureItems.slice(0, topLimit).map(pref => {
                const ratio = Math.round((pref.count / totalPrefectureCount) * 100);
                return (
                  <div key={pref.name} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="truncate w-16 shrink-0">{pref.name}</span>
                    <div className="flex-1 h-2 rounded bg-gray-200">
                      <div
                        className="h-2 rounded bg-sky-500"
                        style={{ width: `${Math.min(100, ratio)}%` }}
                      />
                    </div>
                    <span className="ml-1 text-xs text-gray-500 whitespace-nowrap">
                      {pref.count}件 ({ratio}%)
                    </span>
                  </div>
                );
              })}
              {prefectureItems.length === 0 && (
                <div>データがありません。</div>
              )}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              都道府県バーは都道府県合計を100%として表示
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">タグ数</h2>
          <p className="text-2xl">{summary.counts.tags}</p>
          <div className="mt-2 text-sm text-gray-600 space-y-1">
            {summary.lists.tags.slice(0, topLimit).map(tag => (
              <div key={tag.name}>
                {tag.name} ({tag.count})
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">つながり（タグ）</h2>
          <p className="text-2xl">{summary.counts.meetings}</p>
          <div className="mt-2 text-sm text-gray-600 space-y-1">
            {summary.lists.meetings.slice(0, topLimit).map(meeting => (
              <div key={meeting.id}>
                {meeting.contact_name || '不明'} ({meeting.overlap})
                {meeting.company_name ? ` / ${meeting.company_name}` : ''}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-8 bg-white p-4 rounded-lg shadow flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">会社分布（日本地図）</h2>
          <button
            type="button"
            onClick={refreshCompanyMap}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
            disabled={companyMapLoading}
          >
            {companyMapLoading ? `ジオコーディング進捗 ${geocodePercent}%` : '位置情報を再取得'}
          </button>
        </div>
        <div className="w-full overflow-hidden border rounded bg-slate-950">
          <TechCardMap companies={companyMap} loading={companyMapLoading} />
        </div>
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
