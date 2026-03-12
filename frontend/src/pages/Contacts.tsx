import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';

interface Contact {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: { id: number; name: string; group_id?: number | null; postal_code?: string | null; address?: string | null };
  tags: { name: string; type?: string }[];
  first_met_at?: string;
  notes?: string;
  postal_code?: string;
  address?: string;
}

interface CompanyGroup {
  id: number;
  name: string;
}

const GROUP_TAG_BLOCKLIST = ['HITACHI', 'YOKOGAWA'];

type SortOption = 'group' | 'prefecture' | 'company' | 'name' | 'tech';

const Contacts: React.FC = () => {
  const location = useLocation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyGroups, setCompanyGroups] = useState<CompanyGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});
  const [sortOption, setSortOption] = useState<SortOption>('group');
  const [companyTechMap, setCompanyTechMap] = useState<Map<number, string[]>>(new Map());

  const prefectures = [
    '北海道',
    '青森県',
    '岩手県',
    '宮城県',
    '秋田県',
    '山形県',
    '福島県',
    '茨城県',
    '栃木県',
    '群馬県',
    '埼玉県',
    '千葉県',
    '東京都',
    '神奈川県',
    '新潟県',
    '富山県',
    '石川県',
    '福井県',
    '山梨県',
    '長野県',
    '岐阜県',
    '静岡県',
    '愛知県',
    '三重県',
    '滋賀県',
    '京都府',
    '大阪府',
    '兵庫県',
    '奈良県',
    '和歌山県',
    '鳥取県',
    '島根県',
    '岡山県',
    '広島県',
    '山口県',
    '徳島県',
    '香川県',
    '愛媛県',
    '高知県',
    '福岡県',
    '佐賀県',
    '長崎県',
    '熊本県',
    '大分県',
    '宮崎県',
    '鹿児島県',
    '沖縄県',
  ];

  const extractPrefecture = (address: string | undefined | null) => {
    if (!address) return '未設定';
    const match = prefectures.find(pref => address.includes(pref));
    return match || '未設定';
  };

  const groupNameMap = useMemo(() => {
    return new Map(companyGroups.map(group => [group.id, group.name]));
  }, [companyGroups]);

  const groupTagSet = useMemo(() => {
    const set = new Set<string>();
    companyGroups.forEach(group => {
      if (group.name) {
        set.add(group.name.trim().toUpperCase());
      }
    });
    GROUP_TAG_BLOCKLIST.forEach(name => set.add(name.toUpperCase()));
    return set;
  }, [companyGroups]);

  const isGroupTagName = useCallback((name: string) => {
    return groupTagSet.has(name.trim().toUpperCase());
  }, [groupTagSet]);

  useEffect(() => {
    Promise.all([
      axios.get('http://localhost:8000/contacts/'),
      axios.get<CompanyGroup[]>('http://localhost:8000/company-groups'),
    ]).then(([contactResponse, groupResponse]) => {
      const nextContacts = contactResponse.data as Contact[];
      setContacts(nextContacts);
      setCompanyGroups(groupResponse.data || []);
      const initialExpandedGroups: Record<string, boolean> = {};
      const initialExpandedCompanies: Record<string, boolean> = {};
      const groupNameMap = new Map(groupResponse.data.map(group => [group.id, group.name]));
      nextContacts.forEach(contact => {
        const groupName = contact.company?.group_id ? groupNameMap.get(contact.company.group_id) || 'Other' : 'Other';
        if (!(groupName in initialExpandedGroups)) {
          initialExpandedGroups[groupName] = false;
        }
        const companyName = contact.company?.name?.trim() || '未設定';
        const companyKey = `${groupName}::${companyName}`;
        if (!(companyKey in initialExpandedCompanies)) {
          initialExpandedCompanies[companyKey] = false;
        }
      });
      const storedGroups = localStorage.getItem('contacts:expandedGroups');
      const storedCompanies = localStorage.getItem('contacts:expandedCompanies');
      if (storedGroups) {
        try {
          const parsed = JSON.parse(storedGroups) as Record<string, boolean>;
          Object.keys(initialExpandedGroups).forEach(key => {
            if (key in parsed) initialExpandedGroups[key] = parsed[key];
          });
        } catch {
          // ignore invalid storage
        }
      }
      if (storedCompanies) {
        try {
          const parsed = JSON.parse(storedCompanies) as Record<string, boolean>;
          Object.keys(initialExpandedCompanies).forEach(key => {
            if (key in parsed) initialExpandedCompanies[key] = parsed[key];
          });
        } catch {
          // ignore invalid storage
        }
      }
      setExpandedGroups(initialExpandedGroups);
      setExpandedCompanies(initialExpandedCompanies);
    });
  }, [location.state]);

  useEffect(() => {
    if (companyTechMap.size > 0) return;
    axios.get('http://localhost:8000/stats/network')
      .then(response => {
        const data = response.data as { nodes: { id: string; label: string }[]; edges: { source: string; target: string; type: string }[] };
        const labelMap = new Map<string, string>(data.nodes.map(node => [node.id, node.label]));
        const map = new Map<number, string[]>();
        data.edges.forEach(edge => {
          if (edge.type !== 'company_tech') return;
          const sourceId = typeof edge.source === 'string' ? edge.source : String(edge.source);
          const targetId = typeof edge.target === 'string' ? edge.target : String(edge.target);
          const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
          const techId = sourceId.startsWith('tech_') ? sourceId : targetId.startsWith('tech_') ? targetId : null;
          if (!companyId || !techId) return;
          const numericId = Number(companyId.replace('company_', ''));
          const techLabel = labelMap.get(techId) || '';
          if (!techLabel || Number.isNaN(numericId)) return;
          const list = map.get(numericId) || [];
          if (!list.includes(techLabel)) list.push(techLabel);
          map.set(numericId, list);
        });
        map.forEach((list, key) => {
          list.sort((a, b) => a.localeCompare(b, 'ja'));
          map.set(key, list);
        });
        setCompanyTechMap(map);
      })
      .catch(() => {
        setCompanyTechMap(new Map());
      });
  }, [companyTechMap]);

  const groupedEntries = useMemo(() => {
    const grouped = new Map<string, Map<string, Contact[]>>();
    contacts.forEach(contact => {
      const groupName = contact.company?.group_id ? groupNameMap.get(contact.company.group_id) || 'Other' : 'Other';
      const companyName = contact.company?.name?.trim() || '未設定';
      if (!grouped.has(groupName)) {
        grouped.set(groupName, new Map());
      }
      const companyMap = grouped.get(groupName) as Map<string, Contact[]>;
      if (!companyMap.has(companyName)) {
        companyMap.set(companyName, []);
      }
      companyMap.get(companyName)?.push(contact);
    });

    const pickMostCommon = (counts: Map<string, number>) => {
      let best = '';
      let bestCount = 0;
      counts.forEach((count, value) => {
        if (count > bestCount) {
          best = value;
          bestCount = count;
          return;
        }
        if (count === bestCount && value && value < best) {
          best = value;
        }
      });
      return best || null;
    };

    const groupEntries = Array.from(grouped.entries()).map(([groupName, companyMap]) => {
      const companies = Array.from(companyMap.entries()).map(([company, items]) => {
        const sortedContacts = [...items].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        const postalCounts = new Map<string, number>();
        const addressCounts = new Map<string, number>();
        items.forEach(item => {
          const postal = (item.postal_code || item.company?.postal_code || '').trim();
          const address = (item.address || item.company?.address || '').trim();
          if (postal) {
            postalCounts.set(postal, (postalCounts.get(postal) || 0) + 1);
          }
          if (address) {
            addressCounts.set(address, (addressCounts.get(address) || 0) + 1);
          }
        });
        const postalCode = pickMostCommon(postalCounts);
        const address = pickMostCommon(addressCounts);
        const prefecture = extractPrefecture(address);
        const companyId = items.find(item => item.company?.id)?.company?.id;
        const techList = companyId ? (companyTechMap.get(companyId) || []) : [];
        const techKey = techList[0] || '';
        const nameKey = sortedContacts[0]?.name || '';
        return {
          company,
          contacts: sortedContacts,
          postal_code: postalCode,
          address,
          prefecture,
          techKey,
          techList,
          nameKey,
        };
      });

      companies.sort((a, b) => {
        if (sortOption === 'prefecture') {
          if (a.prefecture === '未設定') return 1;
          if (b.prefecture === '未設定') return -1;
          const diff = a.prefecture.localeCompare(b.prefecture, 'ja');
          if (diff !== 0) return diff;
        }
        if (sortOption === 'tech') {
          const diff = (a.techKey || '').localeCompare(b.techKey || '', 'ja');
          if (diff !== 0) return diff;
        }
        if (sortOption === 'name') {
          const diff = (a.nameKey || '').localeCompare(b.nameKey || '', 'ja');
          if (diff !== 0) return diff;
        }
        return a.company.localeCompare(b.company, 'ja');
      });

      return { group: groupName, companies };
    });

    groupEntries.sort((a, b) => {
      if (a.group === 'Other') return 1;
      if (b.group === 'Other') return -1;
      return a.group.localeCompare(b.group, 'ja');
    });

    return groupEntries;
  }, [companyTechMap, contacts, extractPrefecture, groupNameMap, sortOption]);

  const persistExpandedGroups = (next: Record<string, boolean>) => {
    localStorage.setItem('contacts:expandedGroups', JSON.stringify(next));
  };

  const persistExpandedCompanies = (next: Record<string, boolean>) => {
    localStorage.setItem('contacts:expandedCompanies', JSON.stringify(next));
  };

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const next = { ...prev, [groupName]: !prev[groupName] };
      persistExpandedGroups(next);
      return next;
    });
  };

  const toggleCompany = (companyKey: string) => {
    setExpandedCompanies(prev => {
      const next = { ...prev, [companyKey]: !prev[companyKey] };
      persistExpandedCompanies(next);
      return next;
    });
  };

  return (
    <div className="p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
        <h1 className="text-2xl font-bold">連絡先</h1>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end md:gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">並び順</label>
            <select
              value={sortOption}
              onChange={event => setSortOption(event.target.value as SortOption)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="group">グループ</option>
              <option value="prefecture">都道府県</option>
              <option value="company">会社</option>
              <option value="name">氏名</option>
              <option value="tech">技術</option>
            </select>
          </div>
          <Link
            to="/contacts/register"
            className="inline-flex items-center justify-center rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 md:self-auto self-end"
          >
            ＋ 新規登録
          </Link>
        </div>
      </div>
      <div className="space-y-4">
        {groupedEntries.map(groupEntry => {
          const expanded = expandedGroups[groupEntry.group] ?? false;
          const contactCount = groupEntry.companies.reduce((sum, company) => sum + company.contacts.length, 0);
          const groupLabel = groupEntry.group === 'Other' ? 'その他' : groupEntry.group;
          return (
            <div key={groupEntry.group} className="bg-white rounded-lg shadow border border-gray-200">
              <button
                type="button"
                onClick={() => toggleGroup(groupEntry.group)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">{expanded ? '▼' : '▶'}</span>
                  <h2 className="text-lg font-semibold">{groupLabel}</h2>
                </div>
                <div className="text-sm text-gray-600">{contactCount}件</div>
              </button>
              {expanded && (
                <div className="border-t border-gray-200 p-4 space-y-6">
                  {groupEntry.companies.map(companyEntry => {
                    const companyKey = `${groupEntry.group}::${companyEntry.company}`;
                    const companyExpanded = expandedCompanies[companyKey] ?? false;
                    return (
                      <div key={companyKey} className="border border-gray-100 rounded-lg">
                        <button
                          type="button"
                          onClick={() => toggleCompany(companyKey)}
                          className="w-full text-left px-4 py-3 flex items-start justify-between hover:bg-gray-50"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-500">{companyExpanded ? '▼' : '▶'}</span>
                              <h3 className="text-base font-semibold">{companyEntry.company}</h3>
                            </div>
                          <div className="mt-2 text-xs text-gray-500 space-y-1">
                            <div className="text-sm font-semibold text-blue-700">
                              技術:{' '}
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                                {companyEntry.techList.length > 0 ? companyEntry.techList.join(' / ') : '-'}
                              </span>
                            </div>
                            <div>連絡先数: {companyEntry.contacts.length}</div>
                          </div>
                          </div>
                        </button>
                        {companyExpanded && (
                          <div className="border-t border-gray-200 p-4">
                            <div className="mb-3 text-xs text-gray-500 space-y-1">
                              <div>〒：{companyEntry.postal_code || '-'}</div>
                              <div>住所：{companyEntry.address || '-'}</div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {companyEntry.contacts.map(contact => (
                                <Link
                                  key={contact.id}
                                  to={`/contacts/${contact.id}`}
                                  onClick={() => {
                                    persistExpandedGroups({ ...expandedGroups, [groupEntry.group]: true });
                                    persistExpandedCompanies({ ...expandedCompanies, [companyKey]: true });
                                  }}
                                  className="bg-white p-4 rounded-lg shadow hover:shadow-lg transition border border-gray-100"
                                >
                                  <h4 className="text-lg font-semibold">
                                    {contact.name}
                                    <span className="ml-2 text-xs font-normal text-gray-500">
                                      初回:{contact.first_met_at ? contact.first_met_at : '-'}
                                    </span>
                                  </h4>
                                  <p className="text-sm font-medium text-emerald-700">{contact.role || '-'}</p>
                                  <p>{contact.email}</p>
                                  <p>{contact.phone}</p>
                                  <div className="mt-2">
                              {contact.tags
                                .filter(tag => !isGroupTagName(tag.name))
                                .map(tag => (
                                  <span key={tag.name} className="bg-blue-100 text-blue-800 px-2 py-1 rounded mr-1">
                                    {tag.name}
                                  </span>
                                ))}
                            </div>
                          </Link>
                        ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Contacts;
