import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import ContextPanel from '../components/ContextPanel';
import ShortcutPanel from '../components/ShortcutPanel';

const NETWORK_GRAPH_COLORS = {
  self: '#ed5f5f',
  base: {
    event: '#e6ed5f',
    contact: '#beed5f',
    company: '#5fed72',
    group: '#61ed5f',
    tech: '#615fed',
    relation: '#ed5fa8',
  },
  fallback: '#94a3b8',
  muted: '#cbd5f5',
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
  type: 'event_attendance' | 'employment' | 'company_group' | 'company_tech' | 'relation' | 'company_relation' | 'group_contact';
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
  const [rawGraph, setRawGraph] = useState<GraphData>({ nodes: [], edges: [] });
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
  const hasCenteredRef = useRef(false);
  const zoomScaleRef = useRef(1);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const orbitAnglesRef = useRef<Map<string, number>>(new Map());

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
    const filteredNodes = collapsed
      ? nodes.filter(node => node.type !== 'company' && node.type !== 'tech')
      : nodes;
    const nodeIds = new Set(filteredNodes.map(node => node.id));

    if (collapsed) {
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
      const links: GraphLink[] = [];
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'event_attendance' && edge.type !== 'relation') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
        links.push(edge);
      });
      contactCompany.forEach((companyId, contactId) => {
        const groupId = companyGroup.get(companyId);
        if (!groupId) return;
        if (!nodeIds.has(groupId) || !nodeIds.has(contactId)) return;
        links.push({ source: groupId, target: contactId, type: 'group_contact' });
      });
      return { nodes: filteredNodes, links };
    }

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

    const links = rawGraph.edges.filter(edge => {
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
    graph.nodes.forEach(node => {
      if (!(node as GraphNode).is_self) {
        (node as any).fx = undefined;
        (node as any).fy = undefined;
      }
    });
    const selfNode = graph.nodes.find(node => node.type === 'contact' && (node as GraphNode).is_self);
    if (selfNode) {
      (selfNode as any).fx = 0;
      (selfNode as any).fy = 0;
    }

    const charge = fg.d3Force('charge') as any;
    if (charge && typeof charge.strength === 'function') {
      charge.strength((node: GraphNode) => {
        if (node.type === 'group') return -280;
        if (node.type === 'company') return -240;
        if (node.type === 'event') return -200;
        if (node.type === 'tech') return -180;
        if (node.type === 'relation') return -170;
        if (node.type === 'contact') return -160;
        return -140;
      });
    }

    const linkForce = fg.d3Force('link') as any;
    if (linkForce && typeof linkForce.distance === 'function') {
      linkForce.distance((link: any) => {
        if (link.type === 'employment') return 180;
        if (link.type === 'company_group') return 210;
        if (link.type === 'company_tech') return 120;
        if (link.type === 'relation') return 120;
        if (link.type === 'group_contact') return 170;
        if (link.type === 'event_attendance') return 160;
        return 150;
      });
      if (typeof linkForce.strength === 'function') {
        linkForce.strength((link: any) => (link.type === 'employment' ? 0.9 : 0.5));
      }
    }

    const typeXForce = () => {
      let nodes: any[] = [];
      const strength = 0.06;
      const force = (alpha: number) => {
        for (const node of nodes) {
          const typed = node as GraphNode & { x?: number; vx?: number };
          let targetX = 0;
          if (typed.type === 'event') targetX = -360;
          if (typed.type === 'contact') targetX = 0;
          if (typed.type === 'relation') targetX = 80;
          if (typed.type === 'company') targetX = 260;
          if (typed.type === 'tech') targetX = 300;
          if (typed.type === 'group') targetX = 520;
          const x = typed.x ?? 0;
          typed.vx = (typed.vx ?? 0) + (targetX - x) * strength * alpha;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
      };
      return force;
    };
    fg.d3Force('type-x', typeXForce());

    const typeYForce = () => {
      let nodes: any[] = [];
      const strength = 0.04;
      const force = (alpha: number) => {
        for (const node of nodes) {
          const typed = node as GraphNode & { y?: number; vy?: number };
          if (typed.type === 'tech' || typed.type === 'relation') continue;
          const y = typed.y ?? 0;
          typed.vy = (typed.vy ?? 0) + (0 - y) * strength * alpha;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
      };
      return force;
    };
    fg.d3Force('type-y', typeYForce());

    const getAngle = (id: string) => {
      const existing = orbitAnglesRef.current.get(id);
      if (existing != null) return existing;
      let hash = 0;
      for (let i = 0; i < id.length; i += 1) {
        hash = (hash * 31 + id.charCodeAt(i)) % 360;
      }
      const angle = (hash * Math.PI) / 180;
      orbitAnglesRef.current.set(id, angle);
      return angle;
    };

    const orbitForce = (
      nodeType: 'tech' | 'relation',
      linkType: 'company_tech' | 'relation',
      anchorPrefix: 'company_' | 'contact_',
      radius: number,
    ) => {
      let nodes: any[] = [];
      let nodeMap: Map<string, any> = new Map();
      let anchorMap: Map<string, any[]> = new Map();
      const strength = 0.12;
      const force = (alpha: number) => {
        for (const node of nodes) {
          const typed = node as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          if (typed.type !== nodeType) continue;
          const anchors = anchorMap.get(typed.id);
          if (!anchors || anchors.length === 0) continue;
          let avgX = 0;
          let avgY = 0;
          anchors.forEach(anchor => {
            avgX += anchor.x ?? 0;
            avgY += anchor.y ?? 0;
          });
          avgX /= anchors.length;
          avgY /= anchors.length;
          const angle = getAngle(typed.id);
          const targetX = avgX + Math.cos(angle) * radius;
          const targetY = avgY + Math.sin(angle) * radius;
          const dx = targetX - (typed.x ?? 0);
          const dy = targetY - (typed.y ?? 0);
          typed.vx = (typed.vx ?? 0) + dx * strength * alpha;
          typed.vy = (typed.vy ?? 0) + dy * strength * alpha;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
        nodeMap = new Map(nodes.filter(n => n?.id).map(n => [n.id, n]));
        anchorMap = new Map();
        graph.links.forEach(link => {
          if (link.type !== linkType) return;
          const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
          const targetId = typeof link.target === 'string' ? link.target : link.target.id;
          const nodeId = sourceId.startsWith(`${nodeType}_`)
            ? sourceId
            : targetId.startsWith(`${nodeType}_`)
            ? targetId
            : null;
          const anchorId = sourceId.startsWith(anchorPrefix)
            ? sourceId
            : targetId.startsWith(anchorPrefix)
            ? targetId
            : null;
          if (!nodeId || !anchorId) return;
          const anchorNode = nodeMap.get(anchorId);
          if (!anchorNode) return;
          const list = anchorMap.get(nodeId) || [];
          list.push(anchorNode);
          anchorMap.set(nodeId, list);
        });
      };
      return force;
    };

    fg.d3Force('tech-orbit', orbitForce('tech', 'company_tech', 'company_', 95));
    fg.d3Force('relation-orbit', orbitForce('relation', 'relation', 'contact_', 85));

    const lowDegreeSeparationForce = () => {
      let nodes: any[] = [];
      const minDistance = 42;
      const strength = 0.18;
      const force = (alpha: number) => {
        const lowNodes = nodes.filter(node => {
          const typed = node as GraphNode;
          return (nodeDegreeMap.get(typed.id) ?? 0) <= 1;
        });
        for (const node of lowNodes) {
          const a = node as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          const ax = a.x ?? 0;
          const ay = a.y ?? 0;
          for (const other of nodes) {
            if (other === node) continue;
            const b = other as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
            const dx = (b.x ?? 0) - ax;
            const dy = (b.y ?? 0) - ay;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist >= minDistance) continue;
            const k = ((minDistance - dist) / dist) * strength * alpha;
            a.vx = (a.vx ?? 0) - dx * k;
            a.vy = (a.vy ?? 0) - dy * k;
          }
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
      };
      return force;
    };
    fg.d3Force('low-degree-separation', lowDegreeSeparationForce());

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

  const drawNodeLabel = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const typed = node as GraphNode;
    if (!typed.label) return;
    const baseSize = typed.type === 'tech' || typed.type === 'relation' ? 8 : 10;
    const scaledScreenSize = baseSize * globalScale;
    const clampedScreenSize = Math.max(7, Math.min(14, scaledScreenSize));
    const fontSize = clampedScreenSize / globalScale;
    const x = (node as any).x ?? 0;
    const y = (node as any).y ?? 0;
    const offsetFactor = Math.max(1, 1 / globalScale) * 1.25;
    ctx.save();
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
    const offsets = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168, 180, 192]
      .map(offset => offset * offsetFactor);
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
      orderedDirections = [...directions].sort((a, b) => {
        const da = a[0] * nx + a[1] * ny;
        const db = b[0] * nx + b[1] * ny;
        return db - da;
      });
    }
    for (const offset of offsets) {
      for (const [dxDir, dyDir] of orderedDirections) {
        const dx = (dxDir * offset) / globalScale;
        const dy = (dyDir * offset) / globalScale;
        const cx = x + dx;
        const cy = y + dy;
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
            className="flex-1 min-w-[200px] border rounded px-3 py-2 text-sm"
            placeholder={`検索: ${searchTypeLabel}`}
          />
          <button
            type="button"
            onClick={() => applySearch(searchValue, searchType)}
            className="bg-gray-800 text-white px-4 py-2 rounded text-sm"
          >
            検索
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
      <div className="bg-white rounded-lg shadow h-[calc(100%-3.5rem)] flex overflow-hidden">
        <div className="flex-1 min-w-0 relative">
          <ForceGraph2D
            ref={graphRef}
            graphData={graph}
            nodeRelSize={5}
            cooldownTicks={240}
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
              if (!highlightActive || !selectedNodeId) return 'rgba(120, 138, 158, 0.35)';
              const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
              const targetId = typeof link.target === 'string' ? link.target : link.target.id;
              return highlightedLinkKeys.has(`${sourceId}->${targetId}`)
                ? 'rgba(86, 132, 214, 0.85)'
                : 'rgba(200, 210, 224, 0.18)';
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
