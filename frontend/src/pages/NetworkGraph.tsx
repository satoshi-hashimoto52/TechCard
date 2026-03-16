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
const DEPTH_RADIUS_STEP = 160;
const GRID_STORAGE_KEY = 'techcard_grid_config';
const defaultGridConfig = {
  enabled: false,
  radialLines: 12,
  ringCount: 8,
  radiusStep: 120,
  snapRadius: 30,
  autoSnap: true,
};

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
  const [layoutEpoch, setLayoutEpoch] = useState(0);
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
  const [gridConfig, setGridConfig] = useState(() => {
    const saved = localStorage.getItem(GRID_STORAGE_KEY);
    if (saved) {
      try {
        return { ...defaultGridConfig, ...JSON.parse(saved) };
      } catch (error) {
        console.warn('grid config load failed', error);
      }
    }
    return defaultGridConfig;
  });
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
  const gridCenterRef = useRef<{ x: number; y: number } | null>(null);
  const fixedNodeIdsRef = useRef(new Set<string>());
  const orbitAnglesRef = useRef<Map<string, number>>(new Map());
  const saveLayoutTimerRef = useRef<number | null>(null);
  const layoutSeedRef = useRef<number | null>(null);

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
        if (graphRef.current) {
          requestAnimationFrame(() => {
            graphRef.current?.zoomToFit?.(400);
          });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [layoutEpoch]);

  useEffect(() => {
    try {
      localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify(gridConfig));
    } catch (error) {
      console.warn('grid config save failed', error);
    }
  }, [gridConfig]);

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
    const resolveFirstHop = (nodeId: string) => {
      let current: string | null = nodeId;
      let prev: string | null = null;
      while (current) {
        const parentNode: string | null = parentMap.get(current) ?? null;
        if (parentNode === selfNode.id || parentNode === null) {
          return current;
        }
        prev = current;
        current = parentNode;
      }
      return prev ?? nodeId;
    };

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

    const firstHopAngles = new Map<string, number>();
    // self に直接つながるノードへ等角度を割り当て
    {
      const direct = Array.from(selfNeighborIds).map(id => nodesById.get(id)).filter(Boolean) as GraphNode[];
      const ordered = [...direct].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      const total = Math.max(1, ordered.length);
      ordered.forEach((node, index) => {
        const angle = (index / total) * Math.PI * 2;
        firstHopAngles.set(node.id, angle);
        (node as any).ringAngle = angle;
      });
    }

    const depthGroups = new Map<number, GraphNode[]>();
    graph.nodes.forEach(node => {
      if (node.id === selfNode.id) return;
      if (companyChildMap.has(node.id)) return;
      const hop = Number.isFinite((node as any).depth) ? (node as any).depth : defaultHop;
      const list = depthGroups.get(hop) || [];
      list.push(node as GraphNode);
      depthGroups.set(hop, list);
    });

    const seedFactor = layoutSeedRef.current ?? 1;
    depthGroups.forEach((nodes, hop) => {
      const ringRadius = hop * DEPTH_RADIUS_STEP * seedFactor;
      nodes.forEach((node, index) => {
        const firstHop = resolveFirstHop(node.id);
        const angle =
          firstHopAngles.get(firstHop) ??
          Number.isFinite((node as any).ringAngle)
            ? (node as any).ringAngle
            : (index / Math.max(1, nodes.length)) * Math.PI * 2;
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
    // 自分を必ず原点に固定
    (selfNode as any).fx = 0;
    (selfNode as any).fy = 0;

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

    // 初期座標を放射状にばらまく（保存済みがある場合は維持）
    graph.nodes.forEach(node => {
      if (Number.isFinite((node as any).x) && Number.isFinite((node as any).y)) return;
      const depth = Number.isFinite((node as any).depth) ? (node as any).depth : defaultHop;
      const angle = Number.isFinite((node as any).ringAngle) ? (node as any).ringAngle : Math.random() * Math.PI * 2;
      const radius = Math.max(1, depth) * 260;
      (node as any).x = Math.cos(angle) * radius;
      (node as any).y = Math.sin(angle) * radius;
    });

    const collideForce = (radius = 80) => {
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
      charge.strength(-1400);
    }

    const linkForce = fg.d3Force('link') as any;
      if (linkForce && typeof linkForce.distance === 'function') {
        linkForce.distance((link: any) => {
          const sourceType = (link.source as any)?.type;
          const targetType = (link.target as any)?.type;
          if (sourceType === 'contact' || targetType === 'contact') return 160;
          if (sourceType === 'company' || targetType === 'company') return 200;
          if (sourceType === 'tech' || targetType === 'tech') return 240;
          if (sourceType === 'relation' || targetType === 'relation') return 240;
          if (sourceType === 'group' || targetType === 'group') return 220;
          if (sourceType === 'event' || targetType === 'event') return 200;
          return 180;
        });
        if (typeof linkForce.strength === 'function') {
          linkForce.strength(0.08);
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
    fg.d3Force('radial', null);
    fg.d3Force('depth', null);
    fg.d3Force('align', null);
    fg.d3Force('company-cluster', null);
    fg.d3Force('collide', collideForce(80));

    if (typeof (fg as any).cooldownTicks === 'function') {
      (fg as any).cooldownTicks(300);
    }
    if (typeof (fg as any).cooldownTime === 'function') {
      (fg as any).cooldownTime(20000);
    }
    if (typeof (fg as any).d3VelocityDecay === 'function') {
      (fg as any).d3VelocityDecay(0.75);
    }
    if (typeof (fg as any).d3AlphaDecay === 'function') {
      (fg as any).d3AlphaDecay(0.05);
    }
    fg.d3ReheatSimulation();
    if (selfNode && !hasCenteredRef.current) {
      hasCenteredRef.current = true;
      fg.centerAt(0, 0, 600);
      fg.zoom(1.1, 600);
    }
    if (layoutSeedRef.current != null) {
      layoutSeedRef.current = null;
    }
  }, [graph, nodeDegreeMap, layoutEpoch]);

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
    gridOccupancyRef.current.clear();
    gridCenterRef.current = null;
    layoutSeedRef.current = 1;
    graph.nodes.forEach(node => {
      delete (node as any).x;
      delete (node as any).y;
      (node as any).vx = 0;
      (node as any).vy = 0;
      (node as any).fx = null;
      (node as any).fy = null;
    });
    fixedNodeIdsRef.current.clear();
    const fg = graphRef.current;
    if (fg) {
      fg.d3ReheatSimulation();
      hasCenteredRef.current = false;
    }
    setLayoutEpoch(prev => prev + 1);
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
  }, [graph.nodes, layoutEpoch]);

  const getGridCenter = useCallback(() => {
    if (!gridConfig.enabled) return { x: 0, y: 0 };
    if (gridCenterRef.current) return gridCenterRef.current;
    const selfId = selfNodeIdRef.current;
    if (!selfId) return { x: 0, y: 0 };
    const fallback = graphNodeById.get(selfId) as any;
    const pos = nodePositionsRef.current.get(selfId) || { x: fallback?.x ?? 0, y: fallback?.y ?? 0 };
    gridCenterRef.current = { x: pos.x ?? 0, y: pos.y ?? 0 };
    return gridCenterRef.current;
  }, [graphNodeById, gridConfig.enabled]);

  const getGridPoints = useCallback(
    (config: typeof gridConfig) => {
      const points: { x: number; y: number; key: string }[] = [];
      const step = (Math.PI * 2) / Math.max(1, config.radialLines);
      for (let r = 1; r <= config.ringCount; r += 1) {
        const radius = r * config.radiusStep;
        for (let i = 0; i < config.radialLines; i += 1) {
          const angle = i * step;
          points.push({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            key: `${r}_${i}`,
          });
        }
      }
      return points;
    },
    [],
  );

  const gridIntersections = useMemo(() => {
    if (!gridConfig.enabled) return [];
    return getGridPoints(gridConfig).map(p => ({ x: p.x, y: p.y }));
  }, [gridConfig, getGridPoints]);

  const gridOccupancyRef = useRef(new Map<string, string>());

  const snapNodeToGrid = useCallback(
    (node: any, config: typeof gridConfig) => {
      if (!config.enabled) return;
      // release previous occupancy by this node
      Array.from(gridOccupancyRef.current.entries()).forEach(([key, val]) => {
        if (val === node.id) gridOccupancyRef.current.delete(key);
      });
      const points = getGridPoints(config);
      const center = getGridCenter();
      let best: { x: number; y: number; key: string } | null = null;
      let minDist = Infinity;
      points.forEach(p => {
        if (gridOccupancyRef.current.has(p.key)) return;
        const px = center.x + p.x;
        const py = center.y + p.y;
        const dx = px - (node.x ?? 0);
        const dy = py - (node.y ?? 0);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < config.snapRadius && d < minDist) {
          minDist = d;
          best = { ...p, x: px, y: py };
        }
      });
      if (best) {
        const chosen = best as { x: number; y: number; key: string };
        node.fx = chosen.x;
        node.fy = chosen.y;
        gridOccupancyRef.current.set(chosen.key, node.id);
      }
    },
    [getGridCenter, getGridPoints],
  );

  const snapToGrid = useCallback(
    (x: number, y: number) => {
      if (!gridConfig.enabled || !gridConfig.autoSnap || gridIntersections.length === 0) return null;
      const center = getGridCenter();
      let closest: { x: number; y: number } | null = null;
      let minDist = Infinity;
      for (const p of gridIntersections) {
        const px = center.x + p.x;
        const py = center.y + p.y;
        const dx = px - x;
        const dy = py - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < gridConfig.snapRadius && d < minDist) {
          closest = { x: px, y: py };
          minDist = d;
        }
      }
      return closest;
    },
    [gridConfig.enabled, gridConfig.autoSnap, gridConfig.snapRadius, gridIntersections, getGridCenter],
  );

  useEffect(() => {
    if (!gridConfig.enabled) {
      gridCenterRef.current = null;
      return;
    }
    // capture center once whenグリッド有効化
    getGridCenter();
  }, [gridConfig.enabled, getGridCenter]);

  const drawRadialGrid = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const { radialLines, ringCount, radiusStep } = gridConfig;
    const center = getGridCenter();
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    // 青緑系で白背景でも視認性を確保
    ctx.strokeStyle = 'rgba(70, 150, 170, 0.32)';
    ctx.lineWidth = 0.6 / scale;
    ctx.translate(center.x, center.y);
    for (let i = 1; i <= ringCount; i += 1) {
      const r = i * radiusStep;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const step = (Math.PI * 2) / Math.max(1, radialLines);
    for (let i = 0; i < radialLines; i += 1) {
      const angle = i * step;
      const x = Math.cos(angle) * ringCount * radiusStep;
      const y = Math.sin(angle) * ringCount * radiusStep;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();
  }, [getGridCenter, gridConfig]);

  const scheduleLayoutSave = useCallback(() => {
    if (saveLayoutTimerRef.current) {
      window.clearTimeout(saveLayoutTimerRef.current);
    }
    saveLayoutTimerRef.current = window.setTimeout(() => {
      const positions: Record<string, { x: number; y: number }> = {};
      const fixed: Record<string, boolean> = {};
      graph.nodes.forEach(node => {
        const nx = (node as any).x;
        const ny = (node as any).y;
        if (Number.isFinite(nx) && Number.isFinite(ny)) {
          positions[node.id] = { x: nx, y: ny };
          const fx = (node as any).fx;
          const fy = (node as any).fy;
          if (fx !== null && fx !== undefined && fy !== null && fy !== undefined) {
            fixed[node.id] = true;
          }
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
      const payload = { positions, labels, angles, fixed };
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn('layout save failed', error);
      }
    }, 300);
  }, [graph.nodes, layoutEpoch]);

  useEffect(() => {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        positions?: Record<string, { x: number; y: number }>;
        labels?: Record<string, { x: number; y: number }>;
        angles?: Record<string, number>;
        fixed?: Record<string, boolean>;
      };
      const fixedNodeIds = new Set<string>(
        parsed.fixed ? Object.entries(parsed.fixed).filter(([, isFixed]) => isFixed).map(([nodeId]) => nodeId) : [],
      );
      if (parsed.positions) {
        graph.nodes.forEach(node => {
          const saved = parsed.positions?.[node.id];
          if (!saved) return;
          if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
            (node as any).x = saved.x;
            (node as any).y = saved.y;
            (node as any).vx = 0;
            (node as any).vy = 0;
            if (fixedNodeIds.has(node.id)) {
              (node as any).fx = saved.x;
              (node as any).fy = saved.y;
            }
          }
        });
      }
      fixedNodeIdsRef.current = fixedNodeIds;
      labelOffsetsRef.current = new Map(Object.entries(parsed.labels ?? {}).map(([key, value]) => [key, value]));
      labelAngleOverridesRef.current = new Map(
        Object.entries(parsed.angles ?? {}).map(([key, value]) => [key, value]),
      );
      if (gridConfig.enabled && parsed.fixed) {
        const center = getGridCenter();
        const points = getGridPoints(gridConfig);
        gridOccupancyRef.current.clear();
        graph.nodes.forEach(node => {
          if (!parsed.fixed?.[node.id]) return;
          const px = (node as any).fx ?? (node as any).x;
          const py = (node as any).fy ?? (node as any).y;
          if (!Number.isFinite(px) || !Number.isFinite(py)) return;
          let bestKey: string | null = null;
          let bestDist = Infinity;
          points.forEach(p => {
            const dx = center.x + p.x - px;
            const dy = center.y + p.y - py;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < gridConfig.snapRadius && d < bestDist) {
              bestDist = d;
              bestKey = p.key;
            }
          });
          if (bestKey && !gridOccupancyRef.current.has(bestKey)) {
            gridOccupancyRef.current.set(bestKey, node.id);
          }
        });
      }
    } catch (error) {
      console.warn('layout load failed', error);
    }
  }, [graph.nodes, layoutEpoch, gridConfig.enabled, getGridCenter, getGridPoints]);

  const drawNodeLabel = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const typed = node as GraphNode;
    if (!typed.label) return;
    const baseSize = typed.type === 'tech' || typed.type === 'relation' ? 8 : 10;
    const scaledScreenSize = baseSize * globalScale;
    const clampedScreenSize = Math.max(7, Math.min(14, scaledScreenSize));
    const fontSize = clampedScreenSize / globalScale;
    const x = ((node as any).x ?? 0);
    const y = ((node as any).y ?? 0);
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
    const labelRadius = Math.max(8 / globalScale, radius + 4 / globalScale);
    const anchorX = x;
    const anchorY = y;
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
    // radial priority removed; labels stay near node
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-600 flex items-center gap-1">
              <input
                type="checkbox"
                checked={gridConfig.enabled}
                onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, enabled: event.target.checked }))}
              />
              Grid
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              線数
              <input
                type="number"
                min={4}
                max={100}
                step={1}
                value={gridConfig.radialLines}
                onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, radialLines: Number(event.target.value) || 12 }))}
                className="w-16 border rounded px-2 py-1 text-xs"
              />
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              リング
              <input
                type="number"
                min={2}
                max={50}
                step={1}
                value={gridConfig.ringCount}
                onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, ringCount: Number(event.target.value) || 8 }))}
                className="w-16 border rounded px-2 py-1 text-xs"
              />
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              間隔
              <input
                type="number"
                min={50}
                max={240}
                step={10}
                value={gridConfig.radiusStep}
                onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, radiusStep: Number(event.target.value) || 120 }))}
                className="w-16 border rounded px-2 py-1 text-xs"
              />
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              吸着
              <input
                type="number"
                min={8}
                max={60}
                step={5}
                value={gridConfig.snapRadius}
                onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, snapRadius: Number(event.target.value) || 30 }))}
                className="w-16 border rounded px-2 py-1 text-xs"
              />
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-1">
              <input
                type="checkbox"
                checked={gridConfig.autoSnap}
                onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, autoSnap: event.target.checked }))}
              />
              Auto Snap
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
            onRenderFramePost={(ctx, globalScale) => {
              if (gridConfig.enabled) {
                drawRadialGrid(ctx, globalScale);
              }
            }}
            nodeLabel={(node: NodeObject) => {
              const typed = node as GraphNode;
              return typed.label;
            }}
              nodeColor={nodeColor}
              nodeVal={nodeSize}
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={drawNodeLabel}
              enableZoomInteraction
              enablePanInteraction
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
                  return Math.min(8, 2 + Math.log2(count + 1) * 1.4);
                }
                const highlightActive = highlightMode || Boolean(searchFocus);
                if (!highlightActive || !selectedNodeId) return 2;
                const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
                const targetId = typeof link.target === 'string' ? link.target : link.target.id;
                return highlightedLinkKeys.has(`${sourceId}->${targetId}`) ? 3 : 1.4;
              }}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
            onNodeClick={handleNodeClick}
            onNodeDrag={(node: NodeObject) => {
              const typed = node as GraphNode;
              if (typed.is_self) return;
              if (!gridConfig.enabled && fixedNodeIdsRef.current.has(typed.id)) {
                const fx = (node as any).fx;
                const fy = (node as any).fy;
                if (Number.isFinite(fx) && Number.isFinite(fy)) {
                  (node as any).x = fx;
                  (node as any).y = fy;
                }
                return;
              }
              fixedNodeIdsRef.current.delete(typed.id);
              (node as any).fx = (node as any).x;
              (node as any).fy = (node as any).y;
              if (gridConfig.enabled) {
                snapNodeToGrid(node as any, gridConfig);
              }
            }}
            onNodeDragEnd={(node: NodeObject) => {
              const typed = node as GraphNode;
              if (typed.is_self) return;
              if (!gridConfig.enabled && fixedNodeIdsRef.current.has(typed.id)) {
                const fx = (node as any).fx;
                const fy = (node as any).fy;
                if (Number.isFinite(fx) && Number.isFinite(fy)) {
                  (node as any).x = fx;
                  (node as any).y = fy;
                }
                return;
              }
              fixedNodeIdsRef.current.delete(typed.id);
              (node as any).fx = null;
              (node as any).fy = null;
              if (gridConfig.enabled) {
                snapNodeToGrid(node as any, gridConfig);
              }
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
                  {hoveredNode.notes ? (
                    <div className="whitespace-pre-wrap break-words">メモ: {hoveredNode.notes}</div>
                  ) : null}
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
