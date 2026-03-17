import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';

interface Contact {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: {
    id: number;
    name: string;
    group_id?: number | null;
    postal_code?: string | null;
    address?: string | null;
    tech_tags?: { name: string; type?: string }[];
  };
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

type TagOption = {
  id: number;
  name: string;
  type?: string;
};

const GROUP_TAG_BLOCKLIST = ['HITACHI', 'YOKOGAWA'];
const EVENT_TOP_LEVELS = ['Cards', 'Expo', 'Mixer', 'OJT'] as const;
const EVENT_TAG_SEPARATOR = ' / ';
const TAG_NAME_COLLATOR = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

const normalizeTagType = (value?: string) => {
  if (!value || value === 'technology') return 'tech';
  return value;
};

const sortTagsByNaturalOrder = (items: TagOption[]) =>
  [...items].sort((a, b) => TAG_NAME_COLLATOR.compare(a.name || '', b.name || ''));

const parseEventTagName = (rawName: string) => {
  const name = (rawName || '').trim();
  const separators = ['::', EVENT_TAG_SEPARATOR, '/', '／', '>', '＞'];
  for (const separator of separators) {
    if (!name.includes(separator)) continue;
    const [rawTop, rawChild] = name.split(separator, 2);
    const topToken = rawTop.replace(/^#/, '').trim().toLowerCase();
    const child = (rawChild || '').trim();
    if (!child) continue;
    const top = EVENT_TOP_LEVELS.find(item => item.toLowerCase() === topToken);
    if (!top) continue;
    return { top, child };
  }
  return null;
};

const buildEventTagName = (top: (typeof EVENT_TOP_LEVELS)[number], childRaw: string) => {
  const child = (childRaw || '').trim();
  if (!child) return null;
  return `#${top}${EVENT_TAG_SEPARATOR}${child}`;
};

const formatEventTagLabel = (rawName: string) => {
  const parsed = parseEventTagName(rawName);
  if (!parsed) return rawName;
  return `#${parsed.top} / ${parsed.child}`;
};

type SortOption = 'group' | 'prefecture' | 'company' | 'name' | 'tech';

const Contacts: React.FC = () => {
  const location = useLocation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyGroups, setCompanyGroups] = useState<CompanyGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});
  const [sortOption, setSortOption] = useState<SortOption>('group');
  const [companyTechMap, setCompanyTechMap] = useState<Map<number, string[]>>(new Map());
  const [availableTags, setAvailableTags] = useState<TagOption[]>([]);
  const [tagEditorTarget, setTagEditorTarget] = useState<{ scope: 'company' | 'group'; id: number; name: string } | null>(null);
  const [tagEditorDraft, setTagEditorDraft] = useState<string[]>([]);
  const [tagEditorTypes, setTagEditorTypes] = useState<Record<string, string>>({});
  const [tagEditorSelectedTag, setTagEditorSelectedTag] = useState('');
  const [tagEditorCustomTag, setTagEditorCustomTag] = useState('');
  const [tagEditorCustomType, setTagEditorCustomType] = useState<'tech' | 'event' | 'relation'>('tech');
  const [tagEditorEventTop, setTagEditorEventTop] = useState<(typeof EVENT_TOP_LEVELS)[number]>('Cards');
  const [tagEditorLoading, setTagEditorLoading] = useState(false);
  const [tagEditorSaving, setTagEditorSaving] = useState(false);
  const [tagEditorError, setTagEditorError] = useState<string | null>(null);

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
      axios.get('http://localhost:8000/contacts/', { params: { limit: 5000 } }),
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
    axios.get<TagOption[]>('http://localhost:8000/tags')
      .then(response => {
        setAvailableTags(
          sortTagsByNaturalOrder((response.data || [])
            .filter(tag => Boolean(tag.name))
            .map(tag => ({ ...tag, type: normalizeTagType(tag.type) })),
          ),
        );
      })
      .catch(() => setAvailableTags([]));
  }, []);

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
    const grouped = new Map<string, { groupId: number | null; companies: Map<string, Contact[]> }>();
    contacts.forEach(contact => {
      const groupId = contact.company?.group_id ?? null;
      const groupName = groupId ? groupNameMap.get(groupId) || 'Other' : 'Other';
      const companyName = contact.company?.name?.trim() || '未設定';
      if (!grouped.has(groupName)) {
        grouped.set(groupName, { groupId, companies: new Map() });
      }
      const groupBucket = grouped.get(groupName) as { groupId: number | null; companies: Map<string, Contact[]> };
      if (!groupBucket.groupId && groupId) {
        groupBucket.groupId = groupId;
      }
      const companyMap = groupBucket.companies;
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

    const groupEntries = Array.from(grouped.entries()).map(([groupName, groupBucket]) => {
      const companies = Array.from(groupBucket.companies.entries()).map(([company, items]) => {
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
        const companyTagMap = new Map<string, string | undefined>();
        items.forEach(item => {
          (item.company?.tech_tags || []).forEach(tag => {
            const name = (tag.name || '').trim();
            if (!name) return;
            companyTagMap.set(name, normalizeTagType(tag.type));
          });
        });
        const companyTags = Array.from(companyTagMap.entries())
          .map(([name, type]) => ({ name, type }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        const techKey = techList[0] || '';
        const nameKey = sortedContacts[0]?.name || '';
        return {
          companyId: companyId ?? null,
          company,
          contacts: sortedContacts,
          postal_code: postalCode,
          address,
          prefecture,
          techKey,
          techList,
          companyTags,
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

      return { group: groupName, groupId: groupBucket.groupId, companies };
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

  const openTagEditor = async (scope: 'company' | 'group', id: number, name: string) => {
    setTagEditorTarget({ scope, id, name });
    setTagEditorDraft([]);
    setTagEditorTypes({});
    setTagEditorSelectedTag('');
    setTagEditorCustomTag('');
    setTagEditorCustomType('tech');
    setTagEditorEventTop('Cards');
    setTagEditorError(null);
    setTagEditorLoading(true);
    try {
      const url = scope === 'company'
        ? `http://localhost:8000/companies/${id}/tags`
        : `http://localhost:8000/company-groups/${id}/tags`;
      const response = await axios.get<TagOption[]>(url);
      const tags = (response.data || [])
        .filter(tag => Boolean(tag.name))
        .map(tag => {
          const type = normalizeTagType(tag.type);
          const name = type === 'event' ? formatEventTagLabel(tag.name) : tag.name;
          return { ...tag, name, type };
        });
      const sortedTags = sortTagsByNaturalOrder(tags);
      setTagEditorDraft(sortedTags.map(tag => tag.name));
      const nextTypes: Record<string, string> = {};
      sortedTags.forEach(tag => {
        if (tag.name) nextTypes[tag.name] = normalizeTagType(tag.type);
      });
      setTagEditorTypes(nextTypes);
    } catch {
      setTagEditorError('タグの取得に失敗しました。');
    } finally {
      setTagEditorLoading(false);
    }
  };

  const closeTagEditor = () => {
    setTagEditorTarget(null);
    setTagEditorDraft([]);
    setTagEditorTypes({});
    setTagEditorSelectedTag('');
    setTagEditorCustomTag('');
    setTagEditorCustomType('tech');
    setTagEditorEventTop('Cards');
    setTagEditorError(null);
    setTagEditorLoading(false);
    setTagEditorSaving(false);
  };

  const addEditorTag = (name: string, fallbackType: string) => {
    const normalizedType = normalizeTagType(fallbackType);
    const normalized = normalizedType === 'event' ? formatEventTagLabel(name).trim() : name.trim();
    if (!normalized) return;
    if (tagEditorDraft.includes(normalized)) return;
    setTagEditorDraft(prev => [...prev, normalized]);
    setTagEditorTypes(prev => ({ ...prev, [normalized]: prev[normalized] || normalizedType }));
  };

  const removeEditorTag = (name: string) => {
    setTagEditorDraft(prev => prev.filter(item => item !== name));
    setTagEditorTypes(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const saveTagEditor = async () => {
    if (!tagEditorTarget) return;
    setTagEditorSaving(true);
    setTagEditorError(null);
    try {
      const payload = {
        tag_items: tagEditorDraft.map(name => {
          const known = availableTags.find(tag => tag.name === name);
          const type = normalizeTagType(tagEditorTypes[name] || known?.type || 'tech');
          return { name, type };
        }),
      };
      const url = tagEditorTarget.scope === 'company'
        ? `http://localhost:8000/companies/${tagEditorTarget.id}/tags`
        : `http://localhost:8000/company-groups/${tagEditorTarget.id}/tags`;
      const response = await axios.put<TagOption[]>(url, payload);
      const savedTags = (response.data || [])
        .filter(tag => Boolean(tag.name))
        .map(tag => ({
          id: tag.id,
          name: tag.name,
          type: normalizeTagType(tag.type),
        }));

      setAvailableTags(prev => {
        const nextByName = new Map<string, TagOption>();
        prev.forEach(tag => {
          const key = (tag.name || '').trim().toLowerCase();
          if (!key) return;
          nextByName.set(key, { ...tag, type: normalizeTagType(tag.type) });
        });
        savedTags.forEach((tag, index) => {
          const key = (tag.name || '').trim().toLowerCase();
          if (!key) return;
          const existing = nextByName.get(key);
          nextByName.set(key, {
            id: existing?.id ?? tag.id ?? Date.now() + index,
            name: tag.name,
            type: normalizeTagType(tag.type),
          });
        });
        return sortTagsByNaturalOrder(Array.from(nextByName.values()));
      });

      if (tagEditorTarget.scope === 'company') {
        const companyId = tagEditorTarget.id;
        const normalizedCompanyTags = savedTags.map(tag => ({ name: tag.name, type: normalizeTagType(tag.type) }));
        setContacts(prev => prev.map(contact => {
          if (contact.company?.id !== companyId) return contact;
          return {
            ...contact,
            company: {
              ...contact.company,
              tech_tags: normalizedCompanyTags,
            },
          };
        }));
        const techTags = savedTags
          .filter(tag => normalizeTagType(tag.type) === 'tech')
          .map(tag => tag.name)
          .sort((a, b) => a.localeCompare(b, 'ja'));
        setCompanyTechMap(prev => {
          const next = new Map(prev);
          next.set(companyId, techTags);
          return next;
        });
      }

      closeTagEditor();
    } catch {
      setTagEditorError('タグの保存に失敗しました。');
    } finally {
      setTagEditorSaving(false);
    }
  };

  const renderTagEditor = () => {
    if (!tagEditorTarget) return null;
    return (
      <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-blue-800">
            {tagEditorTarget.scope === 'company' ? '会社タグ編集' : 'グループタグ編集'}: {tagEditorTarget.name}
          </div>
          <button
            type="button"
            onClick={closeTagEditor}
            className="text-xs rounded border border-gray-300 bg-white px-2 py-1"
          >
            閉じる
          </button>
        </div>
        {tagEditorError && <div className="text-sm text-red-600">{tagEditorError}</div>}
        {tagEditorLoading ? (
          <div className="text-sm text-gray-600">読み込み中...</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {tagEditorDraft.length === 0 && <span className="text-sm text-gray-500">タグ未設定</span>}
              {tagEditorDraft.map(tag => (
                <span key={tag} className="inline-flex items-center gap-2 rounded bg-white px-2 py-1 text-sm border border-blue-200">
                  {tagEditorTypes[tag] === 'event' ? formatEventTagLabel(tag) : tag}
                  <button type="button" onClick={() => removeEditorTag(tag)} className="text-blue-700 hover:text-blue-900">×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={tagEditorSelectedTag}
                onChange={event => setTagEditorSelectedTag(event.target.value)}
                className="border rounded px-2 py-1 text-sm min-w-[180px]"
              >
                <option value="">既存タグを選択</option>
                {availableTags.map(tag => (
                  <option key={tag.id} value={tag.name}>
                    {normalizeTagType(tag.type) === 'event' ? formatEventTagLabel(tag.name) : tag.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const selected = tagEditorSelectedTag.trim();
                  if (!selected) return;
                  const target = availableTags.find(tag => tag.name === selected);
                  addEditorTag(selected, normalizeTagType(target?.type));
                  setTagEditorSelectedTag('');
                }}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
              >
                追加
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={tagEditorCustomType}
                onChange={event => setTagEditorCustomType(event.target.value as 'tech' | 'event' | 'relation')}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="tech">タグ/技術</option>
                <option value="event">タグ/イベント</option>
                <option value="relation">タグ/関係</option>
              </select>
              {tagEditorCustomType === 'event' && (
                <select
                  value={tagEditorEventTop}
                  onChange={event => setTagEditorEventTop(event.target.value as (typeof EVENT_TOP_LEVELS)[number])}
                  className="border rounded px-2 py-1 text-sm bg-orange-50 text-orange-700 border-orange-300"
                >
                  {EVENT_TOP_LEVELS.map(top => (
                    <option key={top} value={top}>#{top}</option>
                  ))}
                </select>
              )}
              <input
                type="text"
                value={tagEditorCustomTag}
                onChange={event => setTagEditorCustomTag(event.target.value)}
                className="border rounded px-2 py-1 text-sm min-w-[180px]"
                placeholder={tagEditorCustomType === 'event' ? 'イベント下位名を入力' : '新規タグ'}
              />
              <button
                type="button"
                onClick={() => {
                  const custom = tagEditorCustomType === 'event'
                    ? buildEventTagName(tagEditorEventTop, tagEditorCustomTag)
                    : tagEditorCustomTag.trim();
                  if (!custom) return;
                  addEditorTag(custom, tagEditorCustomType);
                  setTagEditorCustomTag('');
                  setAvailableTags(prev => {
                    if (prev.some(tag => tag.name === custom)) return prev;
                    return sortTagsByNaturalOrder([...prev, { id: Date.now(), name: custom, type: tagEditorCustomType }]);
                  });
                }}
                className="rounded bg-gray-800 px-3 py-1 text-sm text-white"
              >
                作成して追加
              </button>
            </div>
            <div className="pt-1">
              <button
                type="button"
                onClick={saveTagEditor}
                disabled={tagEditorSaving}
                className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                {tagEditorSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    );
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
                  {groupEntry.groupId && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => openTagEditor('group', groupEntry.groupId as number, groupLabel)}
                        className="rounded border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 hover:bg-blue-100"
                      >
                        グループタグ編集
                      </button>
                    </div>
                  )}
                  {tagEditorTarget?.scope === 'group' && tagEditorTarget.id === groupEntry.groupId && renderTagEditor()}
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
                            <div className="text-sm font-semibold text-indigo-700">
                              会社タグ:{' '}
                              <span className="inline-flex flex-wrap items-center gap-1">
                                {companyEntry.companyTags.length > 0 ? companyEntry.companyTags.map(tag => (
                                  <span key={tag.name} className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                                    {tag.type === 'event' ? formatEventTagLabel(tag.name) : tag.name}
                                  </span>
                                )) : <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-500">-</span>}
                              </span>
                            </div>
                            <div>連絡先数: {companyEntry.contacts.length}</div>
                          </div>
                          </div>
                        </button>
                        {companyExpanded && (
                          <div className="border-t border-gray-200 p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="text-xs text-gray-500 space-y-1">
                                <div>〒：{companyEntry.postal_code || '-'}</div>
                                <div>住所：{companyEntry.address || '-'}</div>
                              </div>
                              {companyEntry.companyId && (
                                <button
                                  type="button"
                                  onClick={() => openTagEditor('company', companyEntry.companyId as number, companyEntry.company)}
                                  className="rounded border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 hover:bg-blue-100"
                                >
                                  会社タグ編集
                                </button>
                              )}
                            </div>
                            {tagEditorTarget?.scope === 'company' && tagEditorTarget.id === companyEntry.companyId && renderTagEditor()}
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
                                    {tag.type === 'event' ? formatEventTagLabel(tag.name) : tag.name}
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
