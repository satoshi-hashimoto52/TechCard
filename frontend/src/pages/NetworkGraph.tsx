import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import ContextPanel from '../components/ContextPanel';
import ShortcutPanel from '../components/ShortcutPanel';

const NETWORK_GRAPH_COLORS = {
  self: '#CBD5E1',
  base: {
    event: '#FCA5A5',
    contact: '#CBD5E1',
    company: '#60A5FA',
    group: '#C4B5FD',
    tech: '#F6D365',
    relation: '#86EFAC',
  },
  fallback: '#9CA3AF',
  muted: '#F3F4F6',
};

const NODE_REL_SIZE = 5;
const LINK_COLOR = 'rgba(148, 163, 184, 0.4)';
const LAYOUT_STORAGE_KEY = 'techcard_network_layout_v1';

type GraphNode = {
  id: string;
  type: 'contact' | 'company' | 'group' | 'event' | 'tech' | 'relation';
  label: string;
  size?: number;
  role?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  postal_code?: string;
  address?: string;
  notes?: string;
  company_node_id?: string;
  is_self?: boolean;
};

type NodeObject = {
  id?: string;
  [key: string]: unknown;
};

type GraphLink = {
  source: string | { id: string };
  target: string | { id: string };
  type: 'event_attendance' | 'employment' | 'company_group' | 'company_tech' | 'contact_tech' | 'relation' | 'company_relation' | 'group_contact';
  count?: number;
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphLink[];
};

type GraphView = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const NetworkGraph: React.FC = () => {
  const navigate = useNavigate();
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rawGraph, setRawGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [graphSize, setGraphSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [techFilter, setTechFilter] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [contactFilter, setContactFilter] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number } | null>(null);
  const [searchType, setSearchType] = useState<'tech' | 'company' | 'contact' | 'event'>('tech');
  const [searchValue, setSearchValue] = useState('');
  const [visibleTypes, setVisibleTypes] = useState({
    contact: true,
    company: true,
    group: true,
    event: true,
    tech: true,
    relation: true,
  });
  const [highlightMode, setHighlightMode] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [groupCollapsed, setGroupCollapsed] = useState(false);
  const [searchFocus, setSearchFocus] = useState<{ type: 'tech' | 'company' | 'contact' | 'event'; value: string } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const labelBoxesRef = useRef<{ x: number; y: number; w: number; h: number; groupId?: string | null }[]>([]);
  const labelOffsetsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const labelDragStartRef = useRef<Map<string, { ox: number; oy: number; nx: number; ny: number }>>(new Map());
  const labelDragKeyRef = useRef(false);
  const selfNodeIdRef = useRef<string | null>(null);
  const labelAngleOverridesRef = useRef<Map<string, number>>(new Map());
  const parentMapRef = useRef<Map<string, string | null>>(new Map());
  const hasCenteredRef = useRef(false);
  const zoomScaleRef = useRef(1);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const orbitAnglesRef = useRef<Map<string, number>>(new Map());
  const saveLayoutTimerRef = useRef<number | null>(null);

  const searchTypeLabel = useMemo(() => {
    if (searchType === 'tech') return '技術';
    if (searchType === 'company') return '会社';
    if (searchType === 'contact') return '氏名';
    if (searchType === 'event') return 'イベント';
    return '';
  }, [searchType]);

  useEffect(() => {
    const params: Record<string, string | number> = {};
    if (techFilter) params.technology = techFilter;
    if (companyFilter) params.company = companyFilter;
    if (contactFilter) params.person = contactFilter;
    axios.get<GraphData>('http://localhost:8000/stats/network', { params }).then(response => {
      setRawGraph(response.data);
    });
  }, [techFilter, companyFilter, contactFilter]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      if (!entries.length) return;
      const rect = entries[0].contentRect;
      if (rect.width && rect.height) {
        setGraphSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const graph: GraphView = useMemo(() => {
    const allowedTypes = new Set(
      Object.entries(visibleTypes)
        .filter(([, enabled]) => enabled)
        .map(([type]) => type),
    );
    const nodes = rawGraph.nodes
      .filter(node => allowedTypes.has(node.type))
      .sort((a, b) => {
        const order: Record<GraphNode['type'], number> = {
          event: 0,
          contact: 1,
          company: 2,
          group: 3,
          tech: 4,
          relation: 5,
        };
        return order[a.type] - order[b.type];
      });
    const collapsed = groupCollapsed;
    const groupedCompanies = new Set<string>();
    if (collapsed) {
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'company_group') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
        if (!companyId) return;
        groupedCompanies.add(companyId);
      });
    }
    const filteredNodes = collapsed
      ? nodes.filter(node => {
          if (node.type === 'company') return !groupedCompanies.has(node.id);
          return true;
        })
      : nodes;
    if (collapsed) {
      const contactCompany = new Map<string, string>();
      const techConnectedToSelf = new Set<string>();
      const techCompanyMap = new Map<string, Set<string>>();
      if (visibleTypes.contact) {
        const nodeById = new Map(rawGraph.nodes.map(node => [node.id, node]));
        rawGraph.edges.forEach(edge => {
          if (edge.type !== 'contact_tech') return;
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          const contactId = sourceId.startsWith('contact_')
            ? sourceId
            : targetId.startsWith('contact_')
            ? targetId
            : null;
          const techId = sourceId.startsWith('tech_')
            ? sourceId
            : targetId.startsWith('tech_')
            ? targetId
            : null;
          if (!contactId || !techId) return;
          const contact = nodeById.get(contactId) as GraphNode | undefined;
          if (contact && contact.is_self) {
            techConnectedToSelf.add(techId);
          }
        });
        rawGraph.edges.forEach(edge => {
          if (edge.type !== 'company_tech') return;
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          const companyId = sourceId.startsWith('company_')
            ? sourceId
            : targetId.startsWith('company_')
            ? targetId
            : null;
          const techId = sourceId.startsWith('tech_')
            ? sourceId
            : targetId.startsWith('tech_')
            ? targetId
            : null;
          if (!companyId || !techId) return;
          const list = techCompanyMap.get(techId) || new Set<string>();
          list.add(companyId);
          techCompanyMap.set(techId, list);
        });
      }
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'employment') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
        const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
        if (!companyId || !contactId) return;
        contactCompany.set(contactId, companyId);
      });
      const companyGroup = new Map<string, string>();
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'company_group') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
        const groupId = sourceId.startsWith('group_') ? sourceId : targetId.startsWith('group_') ? targetId : null;
        if (!companyId || !groupId) return;
        companyGroup.set(companyId, groupId);
      });
      const nodeIds = new Set(filteredNodes.map(node => node.id));
      const links: GraphLink[] = [];
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'event_attendance' && edge.type !== 'relation') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
        links.push(edge);
      });
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'company_tech' && edge.type !== 'contact_tech') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
        if (edge.type === 'contact_tech' && visibleTypes.contact) {
          const techId = sourceId.startsWith('tech_')
            ? sourceId
            : targetId.startsWith('tech_')
            ? targetId
            : null;
          if (techId && !techConnectedToSelf.has(techId)) {
            return;
          }
        }
        if (edge.type === 'company_tech' && visibleTypes.contact) {
          const techId = sourceId.startsWith('tech_')
            ? sourceId
            : targetId.startsWith('tech_')
            ? targetId
            : null;
          const companyId = sourceId.startsWith('company_')
            ? sourceId
            : targetId.startsWith('company_')
            ? targetId
            : null;
          if (techId && techConnectedToSelf.has(techId)) {
            return;
          }
          if (techId && companyId) {
            const allowedCompanies = techCompanyMap.get(techId);
            if (!allowedCompanies || !allowedCompanies.has(companyId)) {
              return;
            }
          }
        }
        links.push(edge);
      });
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'employment') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const companyId = sourceId.startsWith('company_')
          ? sourceId
          : targetId.startsWith('company_')
            ? targetId
            : null;
        if (!companyId || groupedCompanies.has(companyId)) return;
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
        links.push({ ...edge, source: sourceId, target: targetId });
      });
      contactCompany.forEach((companyId, contactId) => {
        const groupId = companyGroup.get(companyId);
        if (!groupId) return;
        if (!nodeIds.has(groupId) || !nodeIds.has(contactId)) return;
        links.push({ source: groupId, target: contactId, type: 'group_contact' });
      });
      return { nodes: filteredNodes, links };
    }

    const nodeIds = new Set(filteredNodes.map(node => node.id));
    const contactHidden = !visibleTypes.contact;
    if (contactHidden) {
      const contactCompany = new Map<string, string>();
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'employment') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
        const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
        if (!companyId || !contactId) return;
        contactCompany.set(contactId, companyId);
      });
      const relationCounts = new Map<string, { companyId: string; relationId: string; count: number }>();
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'relation') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
        const relationId = sourceId.startsWith('relation_') ? sourceId : targetId.startsWith('relation_') ? targetId : null;
        if (!contactId || !relationId) return;
        const companyId = contactCompany.get(contactId);
        if (!companyId) return;
        if (!nodeIds.has(companyId) || !nodeIds.has(relationId)) return;
        const key = `${companyId}::${relationId}`;
        const entry = relationCounts.get(key);
        if (entry) {
          entry.count += 1;
        } else {
          relationCounts.set(key, { companyId, relationId, count: 1 });
        }
      });

      const links: GraphLink[] = [];
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'company_group' && edge.type !== 'company_tech') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
        links.push(edge);
      });
      relationCounts.forEach(item => {
        links.push({
          source: item.companyId,
          target: item.relationId,
          type: 'company_relation',
          count: item.count,
        });
      });
      return { nodes: filteredNodes, links };
    }

    const techConnectedToSelf = new Set<string>();
    const techCompanyMap = new Map<string, Set<string>>();
    if (visibleTypes.contact) {
      const nodeById = new Map(rawGraph.nodes.map(node => [node.id, node]));
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'contact_tech') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const contactId = sourceId.startsWith('contact_')
          ? sourceId
          : targetId.startsWith('contact_')
          ? targetId
          : null;
        const techId = sourceId.startsWith('tech_')
          ? sourceId
          : targetId.startsWith('tech_')
          ? targetId
          : null;
        if (!contactId || !techId) return;
        const contact = nodeById.get(contactId) as GraphNode | undefined;
        if (contact && contact.is_self) {
          techConnectedToSelf.add(techId);
        }
      });
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'company_tech') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const companyId = sourceId.startsWith('company_')
          ? sourceId
          : targetId.startsWith('company_')
          ? targetId
          : null;
        const techId = sourceId.startsWith('tech_')
          ? sourceId
          : targetId.startsWith('tech_')
          ? targetId
          : null;
        if (!companyId || !techId) return;
        const list = techCompanyMap.get(techId) || new Set<string>();
        list.add(companyId);
        techCompanyMap.set(techId, list);
      });
    }

    const links = rawGraph.edges.filter(edge => {
      if (edge.type === 'contact_tech' && visibleTypes.contact) {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const techId = sourceId.startsWith('tech_')
          ? sourceId
          : targetId.startsWith('tech_')
          ? targetId
          : null;
        if (techId && !techConnectedToSelf.has(techId)) {
          return false;
        }
      }
      if (edge.type === 'company_tech' && visibleTypes.contact) {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const techId = sourceId.startsWith('tech_')
          ? sourceId
          : targetId.startsWith('tech_')
          ? targetId
          : null;
        const companyId = sourceId.startsWith('company_')
          ? sourceId
          : targetId.startsWith('company_')
          ? targetId
          : null;
        if (techId && techConnectedToSelf.has(techId)) {
          return false;
        }
        if (techId && companyId) {
          const allowedCompanies = techCompanyMap.get(techId);
          if (!allowedCompanies || !allowedCompanies.has(companyId)) {
            return false;
          }
        }
      }
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });
    return { nodes: filteredNodes, links };
  }, [rawGraph, visibleTypes, groupCollapsed]);

  const tagCompanyIds = useMemo(() => {
    const map = new Map<string, string[]>();
    graph.links.forEach(link => {
      if (link.type !== 'company_tech' && link.type !== 'company_relation') return;
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
      const tagId = sourceId.startsWith('tech_') || sourceId.startsWith('relation_')
        ? sourceId
        : targetId.startsWith('tech_') || targetId.startsWith('relation_')
        ? targetId
        : null;
      if (!companyId || !tagId) return;
      const list = map.get(tagId) || [];
      list.push(companyId);
      map.set(tagId, list);
    });
    return map;
  }, [graph.links]);

  const nodeDegreeMap = useMemo(() => {
    const map = new Map<string, number>();
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      map.set(sourceId, (map.get(sourceId) ?? 0) + 1);
      map.set(targetId, (map.get(targetId) ?? 0) + 1);
    });
    return map;
  }, [graph.links]);

  const rawNodeById = useMemo(() => {
    return new Map(rawGraph.nodes.map(node => [node.id, node]));
  }, [rawGraph.nodes]);

  const contactRelations = useMemo(() => {
    const map = new Map<string, string[]>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'relation') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const contactId = sourceId.startsWith('contact_')
        ? sourceId
        : targetId.startsWith('contact_')
        ? targetId
        : null;
      const relationId = sourceId.startsWith('relation_')
        ? sourceId
        : targetId.startsWith('relation_')
        ? targetId
        : null;
      if (!contactId || !relationId) return;
      const label = rawNodeById.get(relationId)?.label || '';
      if (!label) return;
      const list = map.get(contactId) || [];
      if (!list.includes(label)) {
        list.push(label);
        map.set(contactId, list);
      }
    });
    return map;
  }, [rawGraph.edges, rawNodeById]);

  const contactEvents = useMemo(() => {
    const map = new Map<string, string[]>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'event_attendance') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const contactId = sourceId.startsWith('contact_')
        ? sourceId
        : targetId.startsWith('contact_')
        ? targetId
        : null;
      const eventId = sourceId.startsWith('event_')
        ? sourceId
        : targetId.startsWith('event_')
        ? targetId
        : null;
      if (!contactId || !eventId) return;
      const label = rawNodeById.get(eventId)?.label || '';
      if (!label) return;
      const list = map.get(contactId) || [];
      if (!list.includes(label)) {
        list.push(label);
        map.set(contactId, list);
      }
    });
    return map;
  }, [rawGraph.edges, rawNodeById]);

  const companyTechs = useMemo(() => {
    const map = new Map<string, string[]>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'company_tech') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const companyId = sourceId.startsWith('company_')
        ? sourceId
        : targetId.startsWith('company_')
        ? targetId
        : null;
      const techId = sourceId.startsWith('tech_')
        ? sourceId
        : targetId.startsWith('tech_')
        ? targetId
        : null;
      if (!companyId || !techId) return;
      const label = rawNodeById.get(techId)?.label || '';
      if (!label) return;
      const list = map.get(companyId) || [];
      if (!list.includes(label)) {
        list.push(label);
        map.set(companyId, list);
      }
    });
    return map;
  }, [rawGraph.edges, rawNodeById]);

  const companyGroupName = useMemo(() => {
    const map = new Map<string, string>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'company_group') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const companyId = sourceId.startsWith('company_')
        ? sourceId
        : targetId.startsWith('company_')
        ? targetId
        : null;
      const groupId = sourceId.startsWith('group_')
        ? sourceId
        : targetId.startsWith('group_')
        ? targetId
        : null;
      if (!companyId || !groupId) return;
      const label = rawNodeById.get(groupId)?.label || '';
      if (!label) return;
      map.set(companyId, label);
    });
    return map;
  }, [rawGraph.edges, rawNodeById]);

  const companyContactsCount = useMemo(() => {
    const map = new Map<string, number>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'employment') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const companyId = sourceId.startsWith('company_')
        ? sourceId
        : targetId.startsWith('company_')
        ? targetId
        : null;
      if (!companyId) return;
      map.set(companyId, (map.get(companyId) ?? 0) + 1);
    });
    return map;
  }, [rawGraph.edges]);

  const eventParticipantCount = useMemo(() => {
    const map = new Map<string, number>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'event_attendance') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const eventId = sourceId.startsWith('event_')
        ? sourceId
        : targetId.startsWith('event_')
        ? targetId
        : null;
      if (!eventId) return;
      map.set(eventId, (map.get(eventId) ?? 0) + 1);
    });
    return map;
  }, [rawGraph.edges]);

  const groupCompanyCount = useMemo(() => {
    const map = new Map<string, number>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'company_group') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const groupId = sourceId.startsWith('group_')
        ? sourceId
        : targetId.startsWith('group_')
        ? targetId
        : null;
      if (!groupId) return;
      map.set(groupId, (map.get(groupId) ?? 0) + 1);
    });
    return map;
  }, [rawGraph.edges]);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (!graph.nodes.some(node => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graph.nodes, selectedNodeId]);

  const highlightedNodeIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const ids = new Set<string>([selectedNodeId]);
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (sourceId === selectedNodeId || targetId === selectedNodeId) {
        ids.add(sourceId);
        ids.add(targetId);
      }
    });
    return ids;
  }, [graph.links, selectedNodeId]);

  const highlightedLinkKeys = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const keys = new Set<string>();
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (sourceId === selectedNodeId || targetId === selectedNodeId) {
        keys.add(`${sourceId}->${targetId}`);
      }
    });
    return keys;
  }, [graph.links, selectedNodeId]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graph.nodes.find(node => node.id === selectedNodeId) || null;
  }, [graph.nodes, selectedNodeId]);

  const contextData = useMemo(() => {
    if (!selectedNode) return null;
    if (selectedNode.type === 'contact') {
      const companyLabel = selectedNode.company_node_id
        ? rawNodeById.get(selectedNode.company_node_id)?.label || '-'
        : '-';
      const relations = (contactRelations.get(selectedNode.id) || []).join(' / ') || '-';
      const events = (contactEvents.get(selectedNode.id) || []).join(' / ') || '-';
      const tech = selectedNode.company_node_id
        ? (companyTechs.get(selectedNode.company_node_id) || []).join(' / ') || '-'
        : '-';
      return {
        title: selectedNode.label,
        subtitle: '連絡先',
        rows: [
          { label: '会社', value: companyLabel },
          { label: '関係', value: relations },
          { label: 'イベント', value: events },
          { label: '技術', value: tech },
          { label: 'メモ', value: selectedNode.notes || '-' },
        ],
      };
    }
    if (selectedNode.type === 'company') {
      return {
        title: selectedNode.label,
        subtitle: '会社',
        rows: [
          { label: 'グループ', value: companyGroupName.get(selectedNode.id) || '-' },
          { label: '技術', value: (companyTechs.get(selectedNode.id) || []).join(' / ') || '-' },
          { label: '連絡先数', value: companyContactsCount.get(selectedNode.id) ?? 0 },
        ],
      };
    }
    if (selectedNode.type === 'event') {
      return {
        title: selectedNode.label,
        subtitle: 'イベント',
        rows: [
          { label: '参加人数', value: eventParticipantCount.get(selectedNode.id) ?? 0 },
        ],
      };
    }
    if (selectedNode.type === 'group') {
      return {
        title: selectedNode.label,
        subtitle: 'グループ',
        rows: [
          { label: '企業数', value: groupCompanyCount.get(selectedNode.id) ?? 0 },
        ],
      };
    }
    if (selectedNode.type === 'tech') {
      const count = Array.from(rawGraph.edges).filter(edge => {
        if (edge.type !== 'company_tech') return false;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        return sourceId === selectedNode.id || targetId === selectedNode.id;
      }).length;
      return {
        title: selectedNode.label,
        subtitle: '技術',
        rows: [
          { label: '会社数', value: count },
        ],
      };
    }
    if (selectedNode.type === 'relation') {
      const count = Array.from(rawGraph.edges).filter(edge => {
        if (edge.type !== 'relation') return false;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        return sourceId === selectedNode.id || targetId === selectedNode.id;
      }).length;
      return {
        title: selectedNode.label,
        subtitle: '関係',
        rows: [
          { label: '連絡先数', value: count },
        ],
      };
    }
    return null;
  }, [
    selectedNode,
    companyContactsCount,
    companyGroupName,
    companyTechs,
    contactEvents,
    contactRelations,
    eventParticipantCount,
    groupCompanyCount,
    rawGraph.edges,
    rawNodeById,
  ]);

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    const selfNode = graph.nodes.find(node => node.type === 'contact' && (node as GraphNode).is_self) as GraphNode | undefined;
    if (!selfNode) return;
    selfNodeIdRef.current = selfNode.id;

    const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
    const nodeTypeById = new Map(graph.nodes.map(node => [node.id, node.type]));
    const adjacency = new Map<string, Set<string>>();
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (!adjacency.has(sourceId)) adjacency.set(sourceId, new Set());
      if (!adjacency.has(targetId)) adjacency.set(targetId, new Set());
      adjacency.get(sourceId)!.add(targetId);
      adjacency.get(targetId)!.add(sourceId);
    });

    const hopMap = new Map<string, number>();
    const queue: string[] = [selfNode.id];
    hopMap.set(selfNode.id, 0);
    while (queue.length) {
      const current = queue.shift() as string;
      const currentHop = hopMap.get(current) ?? 0;
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      neighbors.forEach(next => {
        if (hopMap.has(next)) return;
        hopMap.set(next, currentHop + 1);
        queue.push(next);
      });
    }

    const parentMap = new Map<string, string | null>();
    parentMap.set(selfNode.id, null);
    const parentQueue: string[] = [selfNode.id];
    while (parentQueue.length) {
      const current = parentQueue.shift() as string;
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      neighbors.forEach(next => {
        if (parentMap.has(next)) return;
        parentMap.set(next, current);
        parentQueue.push(next);
      });
    }
    parentMapRef.current = parentMap;

    let maxHop = 0;
    hopMap.forEach(hop => {
      if (hop > maxHop) maxHop = hop;
    });
    const defaultHop = maxHop + 1;

    const selfNeighborIds = adjacency.get(selfNode.id) ?? new Set<string>();
    const contactCompany = new Map<string, string>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'employment') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
      const contactId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
      if (!companyId || !contactId) return;
      contactCompany.set(contactId, companyId);
    });

    graph.nodes.forEach(node => {
      const hop = hopMap.get(node.id) ?? defaultHop;
      (node as any).depth = hop;
    });
    (selfNode as any).depth = 0;

    let outerTagDepth = 0;
    graph.nodes.forEach(node => {
      if (node.type !== 'tech' && node.type !== 'event') return;
      const hop = hopMap.get(node.id) ?? defaultHop;
      if (hop > outerTagDepth) outerTagDepth = hop;
    });
    if (outerTagDepth === 0) outerTagDepth = defaultHop;
    graph.nodes.forEach(node => {
      if (node.type !== 'relation') return;
      const currentDepth = Number.isFinite((node as any).depth) ? (node as any).depth : defaultHop;
      (node as any).depth = Math.max(currentDepth, outerTagDepth);
    });

    const companyChildMap = new Map<string, string>();
    graph.nodes.forEach(node => {
      if (node.type !== 'contact') return;
      const contact = node as GraphNode;
      if (contact.is_self) return;
      if (selfNeighborIds.has(contact.id)) return;
      const companyId = contactCompany.get(contact.id);
      if (!companyId) return;
      if (!nodesById.has(companyId)) return;
      companyChildMap.set(contact.id, companyId);
    });

    // sector-based layout removed for equal-angle radial layout

    const depthGroups = new Map<number, GraphNode[]>();
    graph.nodes.forEach(node => {
      if (node.id === selfNode.id) return;
      if (companyChildMap.has(node.id)) return;
      const hop = Number.isFinite((node as any).depth) ? (node as any).depth : defaultHop;
      const list = depthGroups.get(hop) || [];
      list.push(node as GraphNode);
      depthGroups.set(hop, list);
    });

    depthGroups.forEach((nodes, hop) => {
      const ringRadius = hop * 150;
      const ordered = [...nodes].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      const total = ordered.length || 1;
      ordered.forEach((node, index) => {
        const angle = (index / total) * Math.PI * 2;
        const x = Math.cos(angle) * ringRadius;
        const y = Math.sin(angle) * ringRadius;
        (node as any).ringAngle = angle;
        if (!Number.isFinite((node as any).x) || !Number.isFinite((node as any).y)) {
          (node as any).x = x;
          (node as any).y = y;
        }
      });
    });

    if (!Number.isFinite((selfNode as any).x) || !Number.isFinite((selfNode as any).y)) {
      (selfNode as any).x = 0;
      (selfNode as any).y = 0;
    }

    const companyChildAngleMap = new Map<string, number>();
    const companyChildrenByCompany = new Map<string, GraphNode[]>();
    companyChildMap.forEach((companyId, contactId) => {
      const contactNode = nodesById.get(contactId);
      if (!contactNode) return;
      const list = companyChildrenByCompany.get(companyId) || [];
      list.push(contactNode as GraphNode);
      companyChildrenByCompany.set(companyId, list);
    });
    companyChildrenByCompany.forEach((contacts, companyId) => {
      const ordered = [...contacts].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      const step = (Math.PI * 2) / ordered.length;
      ordered.forEach((contact, index) => {
        const angle = index * step;
        companyChildAngleMap.set(contact.id, angle);
      });
    });

    const radialForce = (strength = 0.18) => {
      let nodes: any[] = [];
      const force = (alpha: number) => {
        nodes.forEach(node => {
          if (node.id === selfNode.id) return;
          if (companyChildMap.has(node.id)) return;
          const depth = Number.isFinite(node.depth) ? node.depth : defaultHop;
          const ringRadius = depth * 140;
          let targetRadius = ringRadius;
          if (node.type === 'contact') {
            const degree = nodeDegreeMap.get(node.id) ?? 0;
            targetRadius = Math.max(ringRadius * 0.6, ringRadius - degree * 5);
          }
          const angle = Number.isFinite(node.sectorAngle)
            ? node.sectorAngle
            : Math.atan2(Number.isFinite(node.y) ? node.y : 0, Number.isFinite(node.x) ? node.x : 0);
          const tx = Math.cos(angle) * targetRadius;
          const ty = Math.sin(angle) * targetRadius;
          node.vx += (tx - node.x) * strength * alpha;
          node.vy += (ty - node.y) * strength * alpha;
        });
      };
      (force as any).initialize = (nextNodes: any[]) => {
        nodes = nextNodes;
      };
      return force;
    };

    const companyClusterForce = (strength = 0.15) => {
      let nodes: any[] = [];
      const force = (alpha: number) => {
        nodes.forEach(node => {
          const companyId = companyChildMap.get(node.id);
          if (!companyId) return;
          const company = nodesById.get(companyId) as any;
          if (!company) return;
          const depth = Number.isFinite(company.depth) ? company.depth : defaultHop;
          const ringRadius = depth * 140;
          const childRadius = ringRadius * 0.5;
          const angle = companyChildAngleMap.get(node.id) ?? 0;
          const cx = Number.isFinite(company.x) ? company.x : 0;
          const cy = Number.isFinite(company.y) ? company.y : 0;
          const tx = cx + Math.cos(angle) * childRadius;
          const ty = cy + Math.sin(angle) * childRadius;
          if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
            node.x = tx;
            node.y = ty;
          }
          node.vx += (tx - node.x) * strength * alpha;
          node.vy += (ty - node.y) * strength * alpha;
        });
      };
      (force as any).initialize = (nextNodes: any[]) => {
        nodes = nextNodes;
      };
      return force;
    };

    const collideForce = (radius = 40) => {
      let nodes: any[] = [];
      const r = radius;
      const force = (alpha: number) => {
        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const nodeA = nodes[i];
            const nodeB = nodes[j];
            const dx = (nodeB.x || 0) - (nodeA.x || 0);
            const dy = (nodeB.y || 0) - (nodeA.y || 0);
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (!dist) dist = 0.01;
            const minDist = r * 2;
            if (dist < minDist) {
              const move = ((minDist - dist) / dist) * 0.5 * alpha;
              const mx = dx * move;
              const my = dy * move;
              nodeA.vx -= mx;
              nodeA.vy -= my;
              nodeB.vx += mx;
              nodeB.vy += my;
            }
          }
        }
      };
      (force as any).initialize = (nextNodes: any[]) => {
        nodes = nextNodes;
      };
      return force;
    };

    const charge = fg.d3Force('charge') as any;
    if (charge && typeof charge.strength === 'function') {
      charge.strength(-220);
    }

    const linkForce = fg.d3Force('link') as any;
    if (linkForce && typeof linkForce.distance === 'function') {
      linkForce.distance((link: any) => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        if (sourceId === selfNode.id || targetId === selfNode.id) return 80;
        const sourceType = nodeTypeById.get(sourceId);
        const targetType = nodeTypeById.get(targetId);
        if (sourceType === 'tech' || targetType === 'tech' || sourceType === 'relation' || targetType === 'relation') return 120;
        if (sourceType === 'group' || targetType === 'group') return 260;
        if (sourceType === 'company' || targetType === 'company') return 220;
        if (sourceType === 'contact' || targetType === 'contact') return 160;
        return 140;
      });
      if (typeof linkForce.strength === 'function') {
        linkForce.strength(0.7);
      }
    }

    fg.d3Force('type-x', null);
    fg.d3Force('type-y', null);
    fg.d3Force('tech-orbit', null);
    fg.d3Force('relation-orbit', null);
    fg.d3Force('low-degree-separation', null);
    const centerForce = fg.d3Force('center') as any;
    if (centerForce && typeof centerForce.x === 'function') {
      centerForce.x(0);
    }
    if (centerForce && typeof centerForce.y === 'function') {
      centerForce.y(0);
    }
    fg.d3Force('radial', radialForce(0.18));
    fg.d3Force('company-cluster', companyClusterForce(0.15));
    fg.d3Force('collide', collideForce(40));

    if (typeof (fg as any).cooldownTicks === 'function') {
      (fg as any).cooldownTicks(300);
    }
    if (typeof (fg as any).cooldownTime === 'function') {
      (fg as any).cooldownTime(20000);
    }
    fg.d3ReheatSimulation();
    if (selfNode && !hasCenteredRef.current) {
      hasCenteredRef.current = true;
      fg.centerAt(0, 0, 600);
      fg.zoom(1.1, 600);
    }
  }, [graph, nodeDegreeMap]);

  const applySearch = (value: string, type: typeof searchType) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setTechFilter(null);
      setCompanyFilter(null);
      setContactFilter(null);
      setSearchFocus(null);
      setSelectedNodeId(null);
      return;
    }
    setSearchFocus({ type, value: trimmed });
    if (type === 'event') {
      setTechFilter(null);
      setCompanyFilter(null);
      setContactFilter(null);
      return;
    }
    if (type === 'tech') {
      setTechFilter(trimmed);
      setCompanyFilter(null);
      setContactFilter(null);
      return;
    }
    if (type === 'company') {
      setCompanyFilter(trimmed);
      setTechFilter(null);
      setContactFilter(null);
      return;
    }
    setContactFilter(trimmed);
    setTechFilter(null);
    setCompanyFilter(null);
  };

  const resetLayout = useCallback(() => {
    try {
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
    } catch (error) {
      console.warn('layout reset failed', error);
    }
    labelOffsetsRef.current.clear();
    labelAngleOverridesRef.current.clear();
    graph.nodes.forEach(node => {
      delete (node as any).x;
      delete (node as any).y;
      (node as any).vx = 0;
      (node as any).vy = 0;
      (node as any).fx = null;
      (node as any).fy = null;
    });
    const fg = graphRef.current;
    if (fg) {
      fg.d3ReheatSimulation();
      hasCenteredRef.current = false;
    }
  }, [graph.nodes]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      applySearch(searchValue, searchType);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchValue, searchType]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickOpen(true);
        setQuickQuery('');
      }
      if (event.key === 'Escape') {
        setQuickOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  const quickResults = useMemo(() => {
    const query = quickQuery.trim().toLowerCase();
    if (!query) return [];
    return graph.nodes.filter(node => {
      if (!['contact', 'company', 'tech', 'event', 'group'].includes(node.type)) return false;
      return (node.label || '').toLowerCase().includes(query);
    }).slice(0, 12);
  }, [graph.nodes, quickQuery]);

  const focusNode = (target: GraphNode) => {
    setSelectedNodeId(target.id);
    setSearchFocus({ type: target.type as any, value: target.label });
    const fg = graphRef.current;
    if (!fg) return;
    const x = (target as any).x;
    const y = (target as any).y;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    fg.centerAt(x, y, 700);
    fg.zoom(1.8, 700);
  };

  useEffect(() => {
    if (!searchFocus) return;
    const value = searchFocus.value.trim().toLowerCase();
    if (!value) return;
    const target = graph.nodes.find(node => {
      if (node.type !== searchFocus.type) return false;
      return (node.label || '').toLowerCase().includes(value);
    });
    if (!target) return;
    setSelectedNodeId(target.id);
    const fg = graphRef.current;
    if (!fg) return;
    const focus = () => {
      const x = (target as any).x;
      const y = (target as any).y;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      fg.centerAt(x, y, 700);
      fg.zoom(1.8, 700);
    };
    window.setTimeout(focus, 50);
  }, [graph.nodes, searchFocus]);

  const nodeColor = useMemo(() => {
    return (node: NodeObject) => {
      const typed = node as GraphNode;
      if (typed.is_self) return NETWORK_GRAPH_COLORS.self;
      const base = NETWORK_GRAPH_COLORS.base[typed.type] || NETWORK_GRAPH_COLORS.fallback;
      const highlightActive = highlightMode || Boolean(searchFocus);
      if (highlightActive && selectedNodeId) {
        if (!highlightedNodeIds.has(typed.id)) {
          return NETWORK_GRAPH_COLORS.muted;
        }
      }
      return base;
    };
  }, [highlightMode, highlightedNodeIds, searchFocus, selectedNodeId]);

  const nodeSize = useMemo(() => {
    return (node: NodeObject) => {
      const typed = node as GraphNode;
      const base =
        typed.type === 'group'
          ? 10
          : typed.type === 'company'
          ? 9
          : typed.type === 'event'
          ? 8
          : typed.type === 'tech'
          ? 7
          : typed.type === 'relation'
          ? 6
          : 6;
      const sizeValue = Math.max(1, typed.size ?? 1);
      const scale = Math.min(6, Math.sqrt(sizeValue));
      return base + scale;
    };
  }, []);

  const graphNodeById = useMemo(() => {
    return new Map(graph.nodes.map(node => [node.id, node as GraphNode]));
  }, [graph.nodes]);

  const scheduleLayoutSave = useCallback(() => {
    if (saveLayoutTimerRef.current) {
      window.clearTimeout(saveLayoutTimerRef.current);
    }
    saveLayoutTimerRef.current = window.setTimeout(() => {
      const positions: Record<string, { x: number; y: number }> = {};
      graph.nodes.forEach(node => {
        const nx = (node as any).x;
        const ny = (node as any).y;
        if (Number.isFinite(nx) && Number.isFinite(ny)) {
          positions[node.id] = { x: nx, y: ny };
        }
      });
      const labels: Record<string, { x: number; y: number }> = {};
      labelOffsetsRef.current.forEach((value, key) => {
        labels[key] = value;
      });
      const angles: Record<string, number> = {};
      labelAngleOverridesRef.current.forEach((value, key) => {
        if (Number.isFinite(value)) {
          angles[key] = value;
        }
      });
      const payload = { positions, labels, angles };
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn('layout save failed', error);
      }
    }, 300);
  }, [graph.nodes]);

  useEffect(() => {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        positions?: Record<string, { x: number; y: number }>;
        labels?: Record<string, { x: number; y: number }>;
        angles?: Record<string, number>;
      };
      if (parsed.positions) {
        graph.nodes.forEach(node => {
          const saved = parsed.positions?.[node.id];
          if (!saved) return;
          if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
            (node as any).x = saved.x;
            (node as any).y = saved.y;
            (node as any).vx = 0;
            (node as any).vy = 0;
          }
        });
      }
      labelOffsetsRef.current = new Map(Object.entries(parsed.labels ?? {}).map(([key, value]) => [key, value]));
      labelAngleOverridesRef.current = new Map(
        Object.entries(parsed.angles ?? {}).map(([key, value]) => [key, value]),
      );
    } catch (error) {
      console.warn('layout load failed', error);
    }
  }, [graph.nodes]);

  const drawNodeLabel = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const typed = node as GraphNode;
    if (!typed.label) return;
    const labelOffset = labelOffsetsRef.current.get(typed.id);
    const offsetX = labelOffset?.x ?? 0;
    const offsetY = labelOffset?.y ?? 0;
    const baseSize = typed.type === 'tech' || typed.type === 'relation' ? 8 : 10;
    const scaledScreenSize = baseSize * globalScale;
    const clampedScreenSize = Math.max(7, Math.min(14, scaledScreenSize));
    const fontSize = clampedScreenSize / globalScale;
    const x = ((node as any).x ?? 0) + offsetX;
    const y = ((node as any).y ?? 0) + offsetY;
    const offsetFactor = Math.max(1, 1 / globalScale) * 1.25;
    ctx.save();
    const radius = Math.sqrt(nodeSize(node)) * NODE_REL_SIZE;
    if (typed.is_self) {
      ctx.beginPath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(1.2 / globalScale, 1);
      ctx.arc(x, y, radius + 2 / globalScale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.shadowColor = 'rgba(15, 23, 42, 0.45)';
    ctx.shadowBlur = 4 / globalScale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1 / globalScale;
    const textWidth = ctx.measureText(typed.label).width;
    const padding = (3 * offsetFactor) / globalScale;
    const overlaps = (box: { x: number; y: number; w: number; h: number; groupId?: string | null }) =>
      labelBoxesRef.current.some(existing =>
        box.x < existing.x + existing.w
        && box.x + box.w > existing.x
        && box.y < existing.y + existing.h
        && box.y + box.h > existing.y,
      );
    let groupId: string | null = null;
    if (typed.type === 'company') {
      groupId = typed.id;
    } else if (typed.type === 'contact') {
      groupId = typed.company_node_id || null;
    } else if (typed.type === 'tech' || typed.type === 'relation') {
      const companies = tagCompanyIds.get(typed.id);
      groupId = companies && companies.length > 0 ? companies[0] : null;
    }
    const makeBox = (cx: number, cy: number) => ({
      x: cx - textWidth / 2 - padding,
      y: cy - fontSize / 2 - padding,
      w: textWidth + padding * 2,
      h: fontSize + padding * 2,
      groupId,
    });
    const ringAngle = labelAngleOverridesRef.current.get(typed.id)
      ?? (Number.isFinite((node as any).ringAngle)
        ? (node as any).ringAngle
        : Math.atan2(y, x));
    const labelRadius = Math.max(10 / globalScale, radius + 8 / globalScale);
    const anchorX = x + Math.cos(ringAngle) * labelRadius;
    const anchorY = y + Math.sin(ringAngle) * labelRadius;
    const offsets = [0, 10, 20, 30, 40, 50, 60, 70, 80].map(offset => offset * offsetFactor);
    const directions = [
      [0, 0],
      [0, -1],
      [1, 0],
      [-1, 0],
      [0, 1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    let placed = false;
    let orderedDirections = directions;
    let outward: { nx: number; ny: number } | null = null;
    if (typed.type === 'tech' || typed.type === 'relation') {
      const companyIds = tagCompanyIds.get(typed.id) || [];
      let vx = x;
      let vy = y;
      if (companyIds.length > 0) {
        let avgX = 0;
        let avgY = 0;
        let count = 0;
        companyIds.forEach(companyId => {
          const pos = nodePositionsRef.current.get(companyId);
          if (!pos) return;
          avgX += pos.x;
          avgY += pos.y;
          count += 1;
        });
        if (count > 0) {
          avgX /= count;
          avgY /= count;
          vx = x - avgX;
          vy = y - avgY;
        }
      }
      const len = Math.hypot(vx, vy) || 1;
      const nx = vx / len;
      const ny = vy / len;
      outward = { nx, ny };
      orderedDirections = [...directions].sort((a, b) => {
        const da = a[0] * nx + a[1] * ny;
        const db = b[0] * nx + b[1] * ny;
        return db - da;
      });
      if (typed.type === 'relation' && outward) {
        const filtered = orderedDirections.filter(([dxDir, dyDir]) => {
          if (dxDir === 0 && dyDir === 0) return false;
          return dxDir * outward!.nx + dyDir * outward!.ny >= 0;
        });
        if (filtered.length > 0) {
          orderedDirections = filtered;
        }
      }
    }
    if (typed.type === 'relation') {
      const selfId = selfNodeIdRef.current;
      const selfPos = selfId ? nodePositionsRef.current.get(selfId) : undefined;
      const sx = selfPos?.x ?? 0;
      const sy = selfPos?.y ?? 0;
      let rvx = x - sx;
      let rvy = y - sy;
      const rlen = Math.hypot(rvx, rvy) || 1;
      rvx /= rlen;
      rvy /= rlen;
      const tx = -rvy;
      const ty = rvx;
      const radialOffsets = [0, 10, 20, 30, 40, 50, 60, 70].map(offset => offset * offsetFactor);
      const tangentOffsets = [0, 12, -12, 24, -24, 36, -36].map(offset => offset * offsetFactor);
      let relationPlaced = false;
      for (const radial of radialOffsets) {
        for (const tangent of tangentOffsets) {
          const cx = anchorX + (rvx * radial + tx * tangent) / globalScale;
          const cy = anchorY + (rvy * radial + ty * tangent) / globalScale;
          const box = makeBox(cx, cy);
          if (!overlaps(box)) {
            labelBoxesRef.current.push(box);
            ctx.fillText(typed.label, cx, cy);
            relationPlaced = true;
            break;
          }
        }
        if (relationPlaced) break;
      }
      if (relationPlaced) {
        ctx.restore();
        return;
      }
    }
    for (const offset of offsets) {
      for (const [dxDir, dyDir] of orderedDirections) {
        const dx = (dxDir * offset) / globalScale;
        const dy = (dyDir * offset) / globalScale;
        const cx = anchorX + dx;
        const cy = anchorY + dy;
        const box = makeBox(cx, cy);
        const hasOverlap = overlaps(box);
        if (!hasOverlap) {
          labelBoxesRef.current.push(box);
          ctx.fillText(typed.label, cx, cy);
          placed = true;
          break;
        }
        const overlapsDifferentCompany = labelBoxesRef.current.some(existing =>
          box.x < existing.x + existing.w
          && box.x + box.w > existing.x
          && box.y < existing.y + existing.h
          && box.y + box.h > existing.y
          && existing.groupId
          && box.groupId
          && existing.groupId !== box.groupId,
        );
        if (!overlapsDifferentCompany) {
          labelBoxesRef.current.push(box);
          ctx.fillText(typed.label, cx, cy);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    ctx.restore();
  }, [nodeSize, tagCompanyIds]);

  const alignLabelChain = useCallback((outerId: string) => {
    const selfId = selfNodeIdRef.current;
    if (!selfId) return;
    const parentMap = parentMapRef.current;
    if (!parentMap || parentMap.size === 0) return;
    const outerNode = graphNodeById.get(outerId);
    if (!outerNode) return;
    const selfPos = nodePositionsRef.current.get(selfId)
      || { x: (graphNodeById.get(selfId) as any)?.x ?? 0, y: (graphNodeById.get(selfId) as any)?.y ?? 0 };
    const outerPos = nodePositionsRef.current.get(outerId)
      || { x: (outerNode as any).x ?? 0, y: (outerNode as any).y ?? 0 };
    const outerOffset = labelOffsetsRef.current.get(outerId) || { x: 0, y: 0 };
    const scale = zoomScaleRef.current || 1;
    const outerRadius = Math.sqrt(nodeSize(outerNode)) * NODE_REL_SIZE;
    const outerLabelRadius = Math.max(10 / scale, outerRadius + 8 / scale);
    const outerAnchorX = outerPos.x + outerOffset.x;
    const outerAnchorY = outerPos.y + outerOffset.y;
    const dx = outerAnchorX - selfPos.x;
    const dy = outerAnchorY - selfPos.y;
    const dist = Math.hypot(dx, dy);
    if (!dist) return;
    const ux = dx / dist;
    const uy = dy / dist;
    const angle = Math.atan2(uy, ux);

    const path: GraphNode[] = [];
    let current: string | null = outerId;
    while (current && current !== selfId) {
      const node = graphNodeById.get(current);
      if (node) path.push(node);
      current = parentMap.get(current) ?? null;
    }
    const outerDepth = Number((outerNode as any).depth) || 1;
    path.forEach(node => {
      const depth = Number((node as any).depth) || 0;
      const t = outerDepth > 0 ? depth / outerDepth : 0;
      const targetDist = dist * t;
      const nodePos = nodePositionsRef.current.get(node.id)
        || { x: (node as any).x ?? 0, y: (node as any).y ?? 0 };
      const nodeRadius = Math.sqrt(nodeSize(node)) * NODE_REL_SIZE;
      const labelRadius = Math.max(10 / scale, nodeRadius + 8 / scale);
      labelAngleOverridesRef.current.set(node.id, angle);
      labelOffsetsRef.current.set(node.id, {
        x: selfPos.x + ux * targetDist - nodePos.x - ux * labelRadius,
        y: selfPos.y + uy * targetDist - nodePos.y - uy * labelRadius,
      });
    });
    labelAngleOverridesRef.current.set(outerId, angle);
    labelOffsetsRef.current.set(outerId, {
      x: outerAnchorX - outerPos.x - ux * outerLabelRadius,
      y: outerAnchorY - outerPos.y - uy * outerLabelRadius,
    });
  }, [graphNodeById, nodeSize]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        labelDragKeyRef.current = true;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        labelDragKeyRef.current = false;
        labelDragStartRef.current.clear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleNodeClick = (node: NodeObject) => {
    const typed = node as GraphNode;
    setSelectedNodeId(prev => (prev === typed.id ? null : typed.id));
    if (typed.type === 'company' && graphRef.current && (node as any).x != null && (node as any).y != null) {
      graphRef.current.centerAt((node as any).x, (node as any).y, 600);
      graphRef.current.zoom(1.6, 600);
    }
    if (highlightMode) {
      return;
    }
    if (typed.type === 'contact') {
      const match = typed.id.match(/^contact_(\d+)$/);
      if (!match) return;
      setContactFilter(null);
      setTechFilter(null);
      setCompanyFilter(null);
      navigate(`/contacts/${match[1]}`);
    }
    if (typed.type === 'event') {
      const match = typed.id.match(/^event_(\d+)$/);
      if (!match) return;
      navigate(`/events/${match[1]}`);
    }
    if (typed.type === 'tech') {
      setTechFilter(typed.label);
      setCompanyFilter(null);
      setContactFilter(null);
    }
    if (typed.type === 'company') {
      const match = typed.id.match(/^company_(\d+)$/);
      if (match) {
        navigate(`/company/${match[1]}`);
        return;
      }
      setCompanyFilter(typed.label);
      setTechFilter(null);
      setContactFilter(null);
    }
  };

  return (
    <div className="p-6 h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">ネットワークグラフ</h1>
        {(techFilter || companyFilter || contactFilter) && (
          <button
            type="button"
            onClick={() => {
              setTechFilter(null);
              setCompanyFilter(null);
              setContactFilter(null);
            }}
            className="text-sm text-gray-700 hover:text-gray-900"
          >
            フィルタ解除
          </button>
        )}
      </div>
      <div className="mb-4 bg-white rounded-lg shadow p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTypes.contact}
                onChange={event => setVisibleTypes(prev => ({ ...prev, contact: event.target.checked }))}
                className="mr-1"
              />
              人
            </label>
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTypes.company}
                onChange={event => setVisibleTypes(prev => ({ ...prev, company: event.target.checked }))}
                className="mr-1"
              />
              会社
            </label>
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTypes.group}
                onChange={event => setVisibleTypes(prev => ({ ...prev, group: event.target.checked }))}
                className="mr-1"
              />
              グループ
            </label>
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTypes.event}
                onChange={event => setVisibleTypes(prev => ({ ...prev, event: event.target.checked }))}
                className="mr-1"
              />
              #Event
            </label>
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTypes.tech}
                onChange={event => setVisibleTypes(prev => ({ ...prev, tech: event.target.checked }))}
                className="mr-1"
              />
              #Tech
            </label>
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTypes.relation}
                onChange={event => setVisibleTypes(prev => ({ ...prev, relation: event.target.checked }))}
                className="mr-1"
              />
              #Relation
            </label>
          </div>
          <label className="text-xs text-gray-600 flex items-center gap-1">
            <input
              type="checkbox"
              checked={highlightMode}
              onChange={event => setHighlightMode(event.target.checked)}
            />
            ハイライト
          </label>
          <label className="text-xs text-gray-600 flex items-center gap-1">
            <input
              type="checkbox"
              checked={groupCollapsed}
              onChange={event => setGroupCollapsed(event.target.checked)}
            />
            グループ折りたたみ
          </label>
          <select
            value={searchType}
            onChange={event => setSearchType(event.target.value as typeof searchType)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="tech">技術</option>
            <option value="company">会社</option>
            <option value="contact">氏名</option>
            <option value="event">イベント</option>
          </select>
          <input
            type="text"
            value={searchValue}
            onChange={event => setSearchValue(event.target.value)}
            className="flex-1 min-w-[200px] max-w-[240px] border rounded px-3 py-2 text-sm"
            placeholder={`検索: ${searchTypeLabel}`}
          />
          <button
            type="button"
            onClick={() => applySearch(searchValue, searchType)}
            className="bg-gray-800 text-white px-4 py-2 rounded text-sm"
          >
            検索
          </button>
          <button
            type="button"
            onClick={resetLayout}
            className="border border-gray-300 text-gray-700 px-3 py-2 rounded text-sm"
          >
            レイアウトリセット
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          タイプのON/OFFで表示切替。検索はノードをハイライトしてズームします。
          グループ折りたたみで会社ノードを省略できます。
        </p>
        {contactFilter && (
          <p className="text-xs text-gray-500 mt-2">氏名で絞り込み: "{contactFilter}"</p>
        )}
      </div>
      <div className="bg-white rounded-lg shadow h-[calc(100%-3.5rem)] flex w-full overflow-hidden min-w-0">
        <div ref={containerRef} className="flex-1 min-w-0 relative overflow-hidden">
          {graphSize.width > 0 && graphSize.height > 0 && (
            <ForceGraph2D
              ref={graphRef}
              graphData={graph}
              width={graphSize.width}
              height={graphSize.height}
              nodeRelSize={NODE_REL_SIZE}
              cooldownTicks={300}
              cooldownTime={20000}
              linkDirectionalParticles={2}
              linkDirectionalParticleSpeed={0.006}
              linkDirectionalParticleWidth={1.2}
              onRenderFramePre={(ctx, globalScale) => {
                labelBoxesRef.current = [];
                zoomScaleRef.current = graphRef.current?.zoom?.() ?? globalScale ?? 1;
                const nextPositions = new Map<string, { x: number; y: number }>();
                graph.nodes.forEach(node => {
                  const nx = (node as any).x;
                  const ny = (node as any).y;
                  if (typeof nx === 'number' && typeof ny === 'number') {
                    nextPositions.set(node.id, { x: nx, y: ny });
                  }
                });
                nodePositionsRef.current = nextPositions;
              }}
              nodeLabel={(node: NodeObject) => {
                const typed = node as GraphNode;
                return typed.label;
              }}
              nodeColor={nodeColor}
              nodeVal={nodeSize}
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={drawNodeLabel}
              linkColor={(link: any) => {
                const highlightActive = highlightMode || Boolean(searchFocus);
                if (!highlightActive || !selectedNodeId) return LINK_COLOR;
                const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
                const targetId = typeof link.target === 'string' ? link.target : link.target.id;
                return highlightedLinkKeys.has(`${sourceId}->${targetId}`)
                  ? 'rgba(156, 163, 175, 0.9)'
                  : 'rgba(156, 163, 175, 0.25)';
              }}
              linkWidth={(link: any) => {
                if (!visibleTypes.contact && link.type === 'company_relation') {
                  const count = Number(link.count) || 1;
                  return Math.min(6, 1 + Math.log2(count + 1) * 1.2);
                }
                const highlightActive = highlightMode || Boolean(searchFocus);
                if (!highlightActive || !selectedNodeId) return 1;
                const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
                const targetId = typeof link.target === 'string' ? link.target : link.target.id;
                return highlightedLinkKeys.has(`${sourceId}->${targetId}`) ? 2 : 1;
              }}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              onNodeClick={handleNodeClick}
              onNodeDrag={(node: NodeObject, translate: { x: number; y: number }) => {
                const typed = node as GraphNode;
                if (labelDragKeyRef.current) {
                  const currentOffset = labelOffsetsRef.current.get(typed.id) || { x: 0, y: 0 };
                  let base = labelDragStartRef.current.get(typed.id);
                  if (!base) {
                    const nx = (node as any).x ?? 0;
                    const ny = (node as any).y ?? 0;
                    base = { ox: currentOffset.x, oy: currentOffset.y, nx, ny };
                    labelDragStartRef.current.set(typed.id, base);
                  }
                  labelOffsetsRef.current.set(typed.id, {
                    x: base.ox + translate.x,
                    y: base.oy + translate.y,
                  });
                  (node as any).fx = base.nx;
                  (node as any).fy = base.ny;
                  alignLabelChain(typed.id);
                  return;
                }
                (node as any).fx = (node as any).x;
                (node as any).fy = (node as any).y;
              }}
              onNodeDragEnd={(node: NodeObject) => {
                const typed = node as GraphNode;
                labelDragStartRef.current.delete(typed.id);
                (node as any).fx = null;
                (node as any).fy = null;
                scheduleLayoutSave();
              }}
              onNodeHover={(node: NodeObject | null) => {
                const typed = (node as GraphNode) || null;
                setHoveredNode(typed);
                if (typed && graphRef.current && (node as any).x != null && (node as any).y != null) {
                  const coords = graphRef.current.graph2ScreenCoords((node as any).x, (node as any).y);
                  setHoveredPos({ x: coords.x, y: coords.y });
                } else {
                  setHoveredPos(null);
                }
              }}
              onBackgroundClick={() => setSelectedNodeId(null)}
            />
          )}
          {hoveredNode && hoveredPos && (
            <div
              className="absolute bg-gray-900 text-white text-sm px-3 py-2 rounded shadow space-y-1 pointer-events-none"
              style={{
                left: hoveredPos.x + 12,
                top: hoveredPos.y + 12,
                transform: 'translate(-50%, -100%)',
                maxWidth: 240,
              }}
            >
              <div className="font-semibold">{hoveredNode.label}</div>
              {hoveredNode.type === 'contact' ? (
                <>
                  <div>
                    会社: {hoveredNode.company_node_id ? rawNodeById.get(hoveredNode.company_node_id)?.label || '-' : '-'}
                  </div>
                  <div>役職・部署: {hoveredNode.role || '-'}</div>
                  <div>関係: {(contactRelations.get(hoveredNode.id) || []).join(' / ') || '-'}</div>
                  <div>イベント: {(contactEvents.get(hoveredNode.id) || []).join(' / ') || '-'}</div>
                  <div>電話: {hoveredNode.mobile || hoveredNode.phone || '-'}</div>
                  <div>メール: {hoveredNode.email || '-'}</div>
                  {hoveredNode.notes ? <div>メモ: {hoveredNode.notes}</div> : null}
                </>
              ) : hoveredNode.type === 'company' ? (
                <>
                  <div>グループ: {companyGroupName.get(hoveredNode.id) || '-'}</div>
                  <div>技術: {(companyTechs.get(hoveredNode.id) || []).join(' / ') || '-'}</div>
                  <div>連絡先数: {companyContactsCount.get(hoveredNode.id) ?? 0}</div>
                </>
              ) : hoveredNode.type === 'event' ? (
                <div>参加者数: {eventParticipantCount.get(hoveredNode.id) ?? 0}</div>
              ) : hoveredNode.type === 'group' ? (
                <div>企業数: {groupCompanyCount.get(hoveredNode.id) ?? 0}</div>
              ) : (
                <div>{hoveredNode.type}</div>
              )}
            </div>
          )}
          {quickOpen && (
            <div className="absolute inset-0 bg-black/40 flex items-start justify-center pt-16">
              <div className="bg-white rounded-lg shadow w-[480px] max-w-[90%] p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">クイック検索</div>
                  <button
                    type="button"
                    onClick={() => setQuickOpen(false)}
                    className="text-xs text-gray-500"
                  >
                    閉じる
                  </button>
                </div>
                <input
                  autoFocus
                  type="text"
                  value={quickQuery}
                  onChange={event => setQuickQuery(event.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="連絡先 / 会社 / 技術 / イベント / グループ"
                />
                <div className="mt-3 max-h-[300px] overflow-y-auto border rounded">
                  {quickResults.length === 0 && (
                    <div className="px-3 py-4 text-sm text-gray-500">結果がありません。</div>
                  )}
                  {quickResults.map(node => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        focusNode(node);
                        setQuickOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-gray-50 text-sm"
                    >
                      <span className="font-medium">{node.label}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {node.type === 'contact'
                          ? '連絡先'
                          : node.type === 'company'
                          ? '会社'
                          : node.type === 'event'
                          ? 'イベント'
                          : node.type === 'group'
                          ? 'グループ'
                          : node.type === 'tech'
                          ? '技術'
                          : '関係'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <ShortcutPanel embedded bottomClassName="bottom-12" />
        </div>
        <ContextPanel data={contextData} />
      </div>
    </div>
  );
};

export default NetworkGraph;
