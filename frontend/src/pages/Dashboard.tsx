import React, { useEffect, useState } from 'react';
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
    meetings: { id: number; timestamp: string | null; contact_name: string | null }[];
  };
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
          <div className="mt-2 text-sm text-gray-600">
            {(expanded.companies ? summary.lists.companies : summary.lists.companies.slice(0, 3)).map(company => (
              <div key={company.name}>
                {company.name} ({company.count})
              </div>
            ))}
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
          <h2 className="text-lg font-semibold">ミーティング数</h2>
          <p className="text-2xl">{summary.counts.meetings}</p>
          <div className="mt-2 text-sm text-gray-600">
            {(expanded.meetings ? summary.lists.meetings : summary.lists.meetings.slice(0, 3)).map(meeting => (
              <div key={meeting.id}>
                {meeting.contact_name || 'Unknown'} ({meeting.timestamp || '-'})
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
    </div>
  );
};

export default Dashboard;
