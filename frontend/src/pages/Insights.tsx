import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

type GraphNode = {
  id: string;
  type: 'contact' | 'company' | 'group' | 'event' | 'tech' | 'relation';
  label: string;
  company_node_id?: string;
  is_self?: boolean;
};

type GraphLink = {
  source: string;
  target: string;
  type: string;
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphLink[];
};

type ViewType = 'tech' | 'event' | 'group';

const Insights: React.FC = () => {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [view, setView] = useState<ViewType>('tech');

  useEffect(() => {
    axios.get<GraphData>('http://localhost:8000/stats/network')
      .then(res => setGraph(res.data))
      .catch(() => setGraph({ nodes: [], edges: [] }));
  }, []);

  const nodeById = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph.nodes]);

  const contactCompanyMap = useMemo(() => {
    const map = new Map<string, string>();
    graph.edges.forEach(edge => {
      if (edge.type !== 'employment') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : String(edge.source);
      const targetId = typeof edge.target === 'string' ? edge.target : String(edge.target);
      const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
      const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
      if (!companyId || !contactId) return;
      if (!map.has(contactId)) {
        map.set(contactId, companyId);
      }
    });
    return map;
  }, [graph.edges]);

  const contactMeta = useMemo(() => {
    const map = new Map<string, { isSelf: boolean; companyId?: string | null; label: string }>();
    graph.nodes.forEach(node => {
      if (node.type !== 'contact') return;
      map.set(node.id, {
        isSelf: Boolean(node.is_self),
        companyId: node.company_node_id || contactCompanyMap.get(node.id) || null,
        label: node.label || '',
      });
    });
    return map;
  }, [contactCompanyMap, graph.nodes]);

  const selfContactId = useMemo(() => {
    let found: string | null = null;
    contactMeta.forEach((meta, id) => {
      if (!found && meta.isSelf) {
        found = id;
      }
    });
    return found;
  }, [contactMeta]);

  const selfCompanyId = useMemo(() => {
    if (!selfContactId) return null;
    return contactMeta.get(selfContactId)?.companyId || null;
  }, [contactMeta, selfContactId]);

  const isExcludedContact = useCallback(
    (contactId: string) => {
      if (!contactId) return false;
      if (selfContactId && contactId === selfContactId) return true;
      if (!selfCompanyId) return false;
      const companyId = contactMeta.get(contactId)?.companyId;
      return companyId === selfCompanyId;
    },
    [contactMeta, selfCompanyId, selfContactId],
  );

  const companyContacts = useMemo(() => {
    const map = new Map<string, string[]>();
    graph.edges.forEach(edge => {
      if (edge.type !== 'employment') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : String(edge.source);
      const targetId = typeof edge.target === 'string' ? edge.target : String(edge.target);
      const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
      const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
      if (!companyId || !contactId) return;
      if (isExcludedContact(contactId)) return;
      const contactLabel = nodeById.get(contactId)?.label || '';
      if (!contactLabel) return;
      const list = map.get(companyId) || [];
      if (!list.includes(contactLabel)) {
        list.push(contactLabel);
        map.set(companyId, list);
      }
    });
    return map;
  }, [graph.edges, isExcludedContact, nodeById]);

  const techMap = useMemo(() => {
    const map = new Map<string, { tech: string; companies: { name: string; contacts: string[] }[] }>();
    graph.edges.forEach(edge => {
      if (edge.type !== 'contact_tech') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : String(edge.source);
      const targetId = typeof edge.target === 'string' ? edge.target : String(edge.target);
      const techId = sourceId.startsWith('tech_') ? sourceId : targetId.startsWith('tech_') ? targetId : null;
      const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
      if (!techId || !contactId) return;
      if (isExcludedContact(contactId)) return;
      const techLabel = nodeById.get(techId)?.label || '';
      if (!techLabel) return;
      const contactLabel = nodeById.get(contactId)?.label || '';
      if (!contactLabel) return;
      const companyId = contactMeta.get(contactId)?.companyId || '';
      const companyLabel = companyId ? nodeById.get(companyId)?.label || '' : '';
      const companyName = companyLabel || 'Other';
      const entry = map.get(techId) || { tech: techLabel, companies: [] };
      const companyEntry = entry.companies.find(item => item.name === companyName);
      if (companyEntry) {
        if (!companyEntry.contacts.includes(contactLabel)) {
          companyEntry.contacts.push(contactLabel);
        }
      } else {
        entry.companies.push({ name: companyName, contacts: [contactLabel] });
      }
      map.set(techId, entry);
    });
    return Array.from(map.values())
      .map(item => ({
        ...item,
        companies: item.companies
          .map(company => ({
            ...company,
            contacts: company.contacts.sort((a, b) => a.localeCompare(b, 'ja')),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
      }))
      .sort((a, b) => a.tech.localeCompare(b.tech, 'ja'));
  }, [contactMeta, graph.edges, isExcludedContact, nodeById]);

  const eventMap = useMemo(() => {
    const map = new Map<string, { event: string; companies: { name: string; contacts: string[] }[] }>();
    graph.edges.forEach(edge => {
      if (edge.type !== 'event_attendance') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : String(edge.source);
      const targetId = typeof edge.target === 'string' ? edge.target : String(edge.target);
      const eventId = sourceId.startsWith('event_') ? sourceId : targetId.startsWith('event_') ? targetId : null;
      const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
      if (!eventId || !contactId) return;
      if (isExcludedContact(contactId)) return;
      const eventLabel = nodeById.get(eventId)?.label || '';
      const contactLabel = nodeById.get(contactId)?.label || '';
      if (!eventLabel || !contactLabel) return;
      const companyId = contactMeta.get(contactId)?.companyId || '';
      const companyLabel = companyId ? nodeById.get(companyId)?.label || '' : '';
      const companyName = companyLabel || 'Other';
      const entry = map.get(eventId) || { event: eventLabel, companies: [] };
      const companyEntry = entry.companies.find(item => item.name === companyName);
      if (companyEntry) {
        if (!companyEntry.contacts.includes(contactLabel)) {
          companyEntry.contacts.push(contactLabel);
        }
      } else {
        entry.companies.push({ name: companyName, contacts: [contactLabel] });
      }
      map.set(eventId, entry);
    });
    return Array.from(map.values())
      .map(item => ({
        ...item,
        companies: item.companies
          .map(company => ({
            ...company,
            contacts: company.contacts.sort((a, b) => a.localeCompare(b, 'ja')),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
      }))
      .sort((a, b) => a.event.localeCompare(b.event, 'ja'));
  }, [contactMeta, graph.edges, isExcludedContact, nodeById]);

  const groupMap = useMemo(() => {
    const groupCompanies = new Map<string, string[]>();
    graph.edges.forEach(edge => {
      if (edge.type !== 'company_group') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : String(edge.source);
      const targetId = typeof edge.target === 'string' ? edge.target : String(edge.target);
      const groupId = sourceId.startsWith('group_') ? sourceId : targetId.startsWith('group_') ? targetId : null;
      const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
      if (!groupId || !companyId) return;
      const list = groupCompanies.get(groupId) || [];
      if (!list.includes(companyId)) {
        list.push(companyId);
        groupCompanies.set(groupId, list);
      }
    });

    const rows = Array.from(groupCompanies.entries()).map(([groupId, companyIds]) => {
      const groupLabel = nodeById.get(groupId)?.label || 'Other';
      const companies = companyIds
        .map(companyId => ({
          name: nodeById.get(companyId)?.label || '',
          contacts: companyContacts.get(companyId) || [],
        }))
        .filter(company => company.contacts.length > 0);
      return { group: groupLabel, companies };
    });
    return rows
      .filter(row => row.companies.length > 0)
      .sort((a, b) => a.group.localeCompare(b.group, 'ja'));
  }, [graph.edges, nodeById, companyContacts]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Insights</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView('tech')}
            className={`px-3 py-1 rounded text-sm ${view === 'tech' ? 'bg-gray-900 text-white' : 'border'}`}
          >
            Experts
          </button>
          <button
            type="button"
            onClick={() => setView('event')}
            className={`px-3 py-1 rounded text-sm ${view === 'event' ? 'bg-gray-900 text-white' : 'border'}`}
          >
            Event
          </button>
          <button
            type="button"
            onClick={() => setView('group')}
            className={`px-3 py-1 rounded text-sm ${view === 'group' ? 'bg-gray-900 text-white' : 'border'}`}
          >
            Group
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-5 space-y-4">
        {view === 'tech' && (
          <div className="space-y-4">
            {techMap.map(item => (
              <div key={item.tech} className="border-b last:border-b-0 pb-3">
                <div className="font-semibold text-gray-900">{item.tech}</div>
                <div className="mt-1 space-y-2">
                  {item.companies.map(company => (
                    <div key={`${item.tech}-${company.name}`}>
                      <div className="text-sm text-gray-700">{company.name}</div>
                      <div className="ml-4 text-xs text-gray-500">
                        └ {company.contacts.join(' / ') || '-'}
                      </div>
                    </div>
                  ))}
                  {item.companies.length === 0 && <div className="text-xs text-gray-500">該当なし</div>}
                </div>
              </div>
            ))}
            {techMap.length === 0 && <div className="text-sm text-gray-500">データがありません。</div>}
          </div>
        )}
        {view === 'event' && (
          <div className="space-y-4">
            {eventMap.map(item => (
              <div key={item.event} className="border-b last:border-b-0 pb-3">
                <div className="font-semibold text-gray-900">{item.event}</div>
                <div className="mt-1 space-y-2">
                  {item.companies.map(company => (
                    <div key={`${item.event}-${company.name}`}>
                      <div className="text-sm text-gray-700">{company.name}</div>
                      <div className="ml-4 text-xs text-gray-500">
                        └ {company.contacts.join(' / ') || '-'}
                      </div>
                    </div>
                  ))}
                  {item.companies.length === 0 && <div className="text-xs text-gray-500">該当なし</div>}
                </div>
              </div>
            ))}
            {eventMap.length === 0 && <div className="text-sm text-gray-500">データがありません。</div>}
          </div>
        )}
        {view === 'group' && (
          <div className="space-y-4">
            {groupMap.map(item => (
              <div key={item.group} className="border-b last:border-b-0 pb-3">
                <div className="font-semibold text-gray-900">{item.group}</div>
                <div className="mt-1 space-y-2">
                  {item.companies.map(company => (
                    <div key={`${item.group}-${company.name}`}>
                      <div className="text-sm text-gray-700">{company.name}</div>
                      <div className="ml-4 text-xs text-gray-500">
                        └ {company.contacts.join(' / ') || '-'}
                      </div>
                    </div>
                  ))}
                  {item.companies.length === 0 && <div className="text-xs text-gray-500">該当なし</div>}
                </div>
              </div>
            ))}
            {groupMap.length === 0 && <div className="text-sm text-gray-500">データがありません。</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default Insights;
