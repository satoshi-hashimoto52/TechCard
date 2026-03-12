import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';

type GraphNode = {
  id: string;
  type: 'person' | 'company' | 'technology';
  label: string;
  role?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  postal_code?: string;
  address?: string;
  notes?: string;
  company_node_id?: string;
  is_self?: boolean;
  tag_type?: 'technology' | 'relation' | string;
};

type NodeObject = {
  id?: string;
  [key: string]: unknown;
};

type GraphLink = {
  source: string | { id: string };
  target: string | { id: string };
  type: 'works_at' | 'uses' | 'company_uses';
  count?: number;
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const NetworkGraph: React.FC = () => {
  const navigate = useNavigate();
  const graphRef = useRef<any>(null);
  const [rawGraph, setRawGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [techFilter, setTechFilter] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number } | null>(null);
  const [searchType, setSearchType] = useState<'technology' | 'company' | 'person'>('technology');
  const [searchValue, setSearchValue] = useState('');
  const [visibleTypes, setVisibleTypes] = useState({
    person: true,
    company: true,
    technology: true,
  });
  const [visibleTagTypes, setVisibleTagTypes] = useState({
    tech: true,
    relation: true,
  });
  const [highlightMode, setHighlightMode] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const labelBoxesRef = useRef<{ x: number; y: number; w: number; h: number; groupId?: string | null }[]>([]);
  const hasCenteredRef = useRef(false);
  const companyAnglesRef = useRef<Map<string, number>>(new Map());
  const companyRadiusRef = useRef(0);
  const zoomScaleRef = useRef(1);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const params: Record<string, string | number> = {};
    if (techFilter) params.technology = techFilter;
    if (companyFilter) params.company = companyFilter;
    if (personFilter) params.person = personFilter;
    axios.get<GraphData>('http://localhost:8000/graph/network', { params }).then(response => {
      setRawGraph(response.data);
    });
  }, [techFilter, companyFilter, personFilter]);

  const graph = useMemo(() => {
    const allowedTypes = new Set(
      Object.entries(visibleTypes)
        .filter(([, enabled]) => enabled)
        .map(([type]) => type),
    );
    const nodes = rawGraph.nodes
      .filter(node => {
        if (!allowedTypes.has(node.type)) return false;
        if (node.type === 'technology') {
          const tagKey = node.tag_type === 'relation' ? 'relation' : 'tech';
          return visibleTagTypes[tagKey];
        }
        return true;
      })
      .sort((a, b) => {
        const order: Record<GraphNode['type'], number> = {
          company: 0,
          person: 1,
          technology: 2,
        };
        return order[a.type] - order[b.type];
      });
    const nodeIds = new Set(nodes.map(node => node.id));
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const personHidden = !visibleTypes.person;
    if (personHidden) {
      const personCompany = new Map<string, string>();
      rawGraph.links.forEach(link => {
        if (link.type !== 'works_at') return;
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
        const personId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
        if (!companyId || !personId) return;
        personCompany.set(personId, companyId);
      });
      const counts = new Map<string, { companyId: string; tagId: string; count: number }>();
      rawGraph.links.forEach(link => {
        if (link.type !== 'uses') return;
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        const personId = sourceId.startsWith('contact_') ? sourceId : targetId.startsWith('contact_') ? targetId : null;
        const tagId = sourceId.startsWith('tag_') ? sourceId : targetId.startsWith('tag_') ? targetId : null;
        if (!personId || !tagId) return;
        const companyId = personCompany.get(personId);
        if (!companyId) return;
        if (!nodeIds.has(companyId) || !nodeIds.has(tagId)) return;
        const key = `${companyId}::${tagId}`;
        const entry = counts.get(key);
        if (entry) {
          entry.count += 1;
        } else {
          counts.set(key, { companyId, tagId, count: 1 });
        }
      });
      const links: GraphLink[] = Array.from(counts.values()).map(item => ({
        source: item.companyId,
        target: item.tagId,
        type: 'company_uses',
        count: item.count,
      }));
      return { nodes, links };
    }

    const selfNode = nodes.find(node => node.type === 'person' && (node as GraphNode).is_self);
    const selfNodeId = selfNode?.id ?? null;
    const selfTagIds = new Set<string>();
    if (selfNodeId) {
      rawGraph.links.forEach(link => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
        const tagId = sourceId.startsWith('tag_') ? sourceId : targetId.startsWith('tag_') ? targetId : null;
        if (!tagId) return;
        if ((sourceId === selfNodeId && tagId === targetId) || (targetId === selfNodeId && tagId === sourceId)) {
          selfTagIds.add(tagId);
        }
      });
    }
    const links: GraphLink[] = [];
    const seen = new Set<string>();
    rawGraph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (link.type === 'company_uses') return;
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
      if (link.type === 'uses') {
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        const tagId = sourceNode?.type === 'technology'
          ? sourceNode.id
          : targetNode?.type === 'technology'
          ? targetNode.id
          : null;
        const personNode = sourceNode?.type === 'person'
          ? sourceNode
          : targetNode?.type === 'person'
          ? targetNode
          : null;
        if (
          tagId &&
          personNode &&
          !selfTagIds.has(tagId) &&
          personNode.company_node_id &&
          nodeIds.has(personNode.company_node_id)
        ) {
          const companyId = personNode.company_node_id;
          const key = `company_uses:${companyId}:${tagId}`;
          if (!seen.has(key)) {
            links.push({ source: companyId, target: tagId, type: 'company_uses' });
            seen.add(key);
          }
          return;
        }
      }
      const key = `${link.type}:${sourceId}:${targetId}`;
      if (seen.has(key)) return;
      links.push({ source: sourceId, target: targetId, type: link.type });
      seen.add(key);
    });
    return { nodes, links };
  }, [rawGraph, visibleTypes, visibleTagTypes]);

  const tagCompanyIds = useMemo(() => {
    const map = new Map<string, string[]>();
    graph.links.forEach(link => {
      if (link.type !== 'company_uses') return;
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
      const tagId = sourceId.startsWith('tag_') ? sourceId : targetId.startsWith('tag_') ? targetId : null;
      if (!companyId || !tagId) return;
      const list = map.get(tagId) || [];
      list.push(companyId);
      map.set(tagId, list);
    });
    return map;
  }, [graph.links]);

  const selfNodeId = useMemo(() => {
    const selfNode = graph.nodes.find(node => node.type === 'person' && (node as GraphNode).is_self);
    return selfNode?.id ?? null;
  }, [graph.nodes]);
  const connectedTagIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selfNodeId) return ids;
    const techIds = new Set(graph.nodes.filter(node => node.type === 'technology').map(node => node.id));
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (sourceId === selfNodeId && techIds.has(targetId)) {
        ids.add(targetId);
      }
      if (targetId === selfNodeId && techIds.has(sourceId)) {
        ids.add(sourceId);
      }
    });
    return ids;
  }, [graph.links, graph.nodes, selfNodeId]);

  const personOverlapMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!selfNodeId) return map;
    graph.nodes.forEach(node => {
      if (node.type === 'person' && node.id !== selfNodeId) {
        map.set(node.id, 0);
      }
    });
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      const isSourcePerson = map.has(sourceId);
      const isTargetPerson = map.has(targetId);
      const isSourceTag = connectedTagIds.has(sourceId);
      const isTargetTag = connectedTagIds.has(targetId);
      if (isSourcePerson && isTargetTag) {
        map.set(sourceId, (map.get(sourceId) ?? 0) + 1);
      }
      if (isTargetPerson && isSourceTag) {
        map.set(targetId, (map.get(targetId) ?? 0) + 1);
      }
    });
    return map;
  }, [connectedTagIds, graph.links, graph.nodes, selfNodeId]);

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

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;
    graph.nodes.forEach(node => {
      if (node.type !== 'company' && !(node as GraphNode).is_self) {
        (node as any).fx = undefined;
        (node as any).fy = undefined;
      }
    });
    const selfNode = graph.nodes.find(node => node.type === 'person' && (node as GraphNode).is_self);
    if (selfNode) {
      (selfNode as any).fx = 0;
      (selfNode as any).fy = 0;
    }
    const charge = fg.d3Force('charge') as any;
    if (charge && typeof charge.strength === 'function') {
      charge.strength((node: GraphNode) => {
        if (node.type === 'technology') return -220;
        if (node.type === 'company') return -260;
        if (node.type === 'person') return -140;
        return -120;
      });
    }
    const linkForce = fg.d3Force('link') as any;
    if (linkForce && typeof linkForce.distance === 'function') {
      linkForce.distance((link: any) => {
        const sourceType = (link.source as GraphNode)?.type;
        const targetType = (link.target as GraphNode)?.type;
        if (link.type === 'works_at') return 70;
        if (link.type === 'company_uses') return 140;
        if (sourceType === 'company' || targetType === 'company') return 150;
        return 120;
      });
      if (typeof linkForce.strength === 'function') {
        linkForce.strength((link: any) => (link.type === 'works_at' ? 1.0 : 0.4));
      }
    }
    const personCompanyAttractForce = () => {
      let nodes: any[] = [];
      let nodeMap: Map<string, any> = new Map();
      const strength = 0.06;
      const force = (alpha: number) => {
        for (const node of nodes) {
          const typed = node as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          if (typed.type !== 'person' || typed.is_self || !typed.company_node_id) continue;
          const companyNode = nodeMap.get(typed.company_node_id);
          if (!companyNode) continue;
          const dx = (companyNode.x ?? 0) - (typed.x ?? 0);
          const dy = (companyNode.y ?? 0) - (typed.y ?? 0);
          typed.vx = (typed.vx ?? 0) + dx * strength * alpha;
          typed.vy = (typed.vy ?? 0) + dy * strength * alpha;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
        nodeMap = new Map(nodes.filter(n => n?.id).map(n => [n.id, n]));
      };
      return force;
    };
    fg.d3Force('person-company-attract', personCompanyAttractForce());
    const ringForce = () => {
      let nodes: any[] = [];
      const strength = 0.08;
      const resolveRadii = () => {
        const companyRadius = companyRadiusRef.current || 320;
        const connectedTagRadius = Math.min(220, Math.max(120, companyRadius * 0.45));
        const personRadius = Math.min(280, Math.max(170, companyRadius * 0.7));
        const meetingRadius = Math.max(60, Math.round(personRadius * 0.5));
        return { connectedTagRadius, personRadius, meetingRadius };
      };
      const force = (alpha: number) => {
        const { connectedTagRadius, personRadius, meetingRadius } = resolveRadii();
        for (const node of nodes) {
          const typed = node as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          if (typed.type === 'company' || typed.is_self) continue;
          let target = 0;
          if (typed.type === 'technology') {
            if (!connectedTagIds.has(typed.id)) {
              continue;
            }
            target = connectedTagRadius;
          } else if (typed.type === 'person') {
            target = personRadius;
          } else if (typed.type === 'meeting') {
            target = meetingRadius;
          }
          const dx = typed.x ?? 0;
          const dy = typed.y ?? 0;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = ((target - dist) / dist) * strength * alpha;
          typed.vx = (typed.vx ?? 0) + dx * k;
          typed.vy = (typed.vy ?? 0) + dy * k;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
      };
      return force;
    };
    fg.d3Force('rings', ringForce());
    const personOverlapPullForce = () => {
      let nodes: any[] = [];
      const baseStrength = 0.012;
      const force = (alpha: number) => {
        for (const node of nodes) {
          const typed = node as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          if (typed.type !== 'person' || typed.is_self) continue;
          const overlap = personOverlapMap.get(typed.id) ?? 0;
          if (overlap <= 0) continue;
          const strength = Math.min(0.06, baseStrength + overlap * 0.006);
          const dx = typed.x ?? 0;
          const dy = typed.y ?? 0;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = (strength * alpha);
          typed.vx = (typed.vx ?? 0) - (dx / dist) * k;
          typed.vy = (typed.vy ?? 0) - (dy / dist) * k;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
      };
      return force;
    };
    fg.d3Force('person-overlap-pull', personOverlapPullForce());
    const tagCompanyAttractForce = () => {
      let nodes: any[] = [];
      let nodeMap: Map<string, any> = new Map();
      let tagCompanies: Map<string, any[]> = new Map();
      const baseStrength = 0.5;
      const baseDistance = 10;
      const force = (alpha: number) => {
        const zoomFactor = Math.max(0.7, Math.min(1.8, zoomScaleRef.current || 1));
        const strength = baseStrength * zoomFactor;
        const desiredDistance = baseDistance * zoomFactor;
        for (const node of nodes) {
          const typed = node as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          if (typed.type !== 'technology') continue;
          if (connectedTagIds.has(typed.id)) continue;
          const companies = tagCompanies.get(typed.id);
          if (!companies || companies.length === 0) continue;
          let avgX = 0;
          let avgY = 0;
          let count = 0;
          for (const companyNode of companies) {
            const cx = companyNode.x ?? 0;
            const cy = companyNode.y ?? 0;
            avgX += cx;
            avgY += cy;
            count += 1;
          }
          if (count === 0) continue;
          avgX /= count;
          avgY /= count;
          const dx = avgX - (typed.x ?? 0);
          const dy = avgY - (typed.y ?? 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < desiredDistance) continue;
          const k = ((dist - desiredDistance) / dist) * strength * alpha;
          typed.vx = (typed.vx ?? 0) + dx * k;
          typed.vy = (typed.vy ?? 0) + dy * k;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
        nodeMap = new Map(nodes.filter(n => n?.id).map(n => [n.id, n]));
        tagCompanies = new Map();
        graph.links.forEach(link => {
          const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
          const targetId = typeof link.target === 'string' ? link.target : link.target.id;
          const sourceNode = nodeMap.get(sourceId);
          const targetNode = nodeMap.get(targetId);
          if (!sourceNode || !targetNode) return;
          if (sourceNode.type === 'company' && targetNode.type === 'technology') {
            const list = tagCompanies.get(targetId) || [];
            list.push(sourceNode);
            tagCompanies.set(targetId, list);
            return;
          }
          if (targetNode.type === 'company' && sourceNode.type === 'technology') {
            const list = tagCompanies.get(sourceId) || [];
            list.push(targetNode);
            tagCompanies.set(sourceId, list);
          }
        });
      };
      return force;
    };
    fg.d3Force('tag-company-attract', tagCompanyAttractForce());
    const personCompanySectorForce = () => {
      let nodes: any[] = [];
      const strength = 0.12;
      const force = (alpha: number) => {
        const angleMap = companyAnglesRef.current;
        for (const node of nodes) {
          const typed = node as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          if (typed.type !== 'person' || typed.is_self || !typed.company_node_id) continue;
          const targetAngle = angleMap.get(typed.company_node_id);
          if (targetAngle == null) continue;
          const x = typed.x ?? 0;
          const y = typed.y ?? 0;
          const r = Math.sqrt(x * x + y * y) || 1;
          const targetX = Math.cos(targetAngle) * r;
          const targetY = Math.sin(targetAngle) * r;
          typed.vx = (typed.vx ?? 0) + (targetX - x) * strength * alpha;
          typed.vy = (typed.vy ?? 0) + (targetY - y) * strength * alpha;
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
      };
      return force;
    };
    fg.d3Force('person-company-sector', personCompanySectorForce());
    const personSeparationForce = () => {
      let nodes: any[] = [];
      const minDistance = 26;
      const strength = 0.18;
      const force = (alpha: number) => {
        for (let i = 0; i < nodes.length; i += 1) {
          const a = nodes[i] as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
          if (a.type !== 'person' || !a.company_node_id) continue;
          for (let j = i + 1; j < nodes.length; j += 1) {
            const b = nodes[j] as GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
            if (b.type !== 'person' || !b.company_node_id) continue;
            if (a.company_node_id === b.company_node_id) continue;
            const dx = (b.x ?? 0) - (a.x ?? 0);
            const dy = (b.y ?? 0) - (a.y ?? 0);
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist >= minDistance) continue;
            const k = ((minDistance - dist) / dist) * strength * alpha;
            a.vx = (a.vx ?? 0) - dx * k;
            a.vy = (a.vy ?? 0) - dy * k;
            b.vx = (b.vx ?? 0) + dx * k;
            b.vy = (b.vy ?? 0) + dy * k;
          }
        }
      };
      (force as any).initialize = (newNodes: any[]) => {
        nodes = newNodes || [];
      };
      return force;
    };
    fg.d3Force('person-separation', personSeparationForce());
    fg.d3ReheatSimulation();
    if (selfNode && !hasCenteredRef.current) {
      hasCenteredRef.current = true;
      fg.centerAt(0, 0, 600);
      fg.zoom(1.15, 600);
    }
  }, [graph, connectedTagIds, personOverlapMap]);

  const applySearch = (value: string, type: typeof searchType) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setTechFilter(null);
      setCompanyFilter(null);
      setPersonFilter(null);
      return;
    }
    if (type === 'technology') {
      setTechFilter(trimmed);
      setCompanyFilter(null);
      setPersonFilter(null);
      return;
    }
    if (type === 'company') {
      setCompanyFilter(trimmed);
      setTechFilter(null);
      setPersonFilter(null);
      return;
    }
    setPersonFilter(trimmed);
    setTechFilter(null);
    setCompanyFilter(null);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      applySearch(searchValue, searchType);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchValue, searchType]);

  const nodeColor = useMemo(() => {
    return (node: NodeObject) => {
      const typed = node as GraphNode;
      if (typed.is_self) return '#f87171';
      const base =
        typed.type === 'person'
          ? '#3b82f6'
          : typed.type === 'company'
          ? '#22c55e'
          : typed.tag_type === 'relation'
          ? '#ec4899'
          : '#f59e0b';
      if (highlightMode && selectedNodeId) {
        if (!highlightedNodeIds.has(typed.id)) {
          return '#cbd5f5';
        }
      }
      return base;
    };
  }, [highlightMode, highlightedNodeIds, selectedNodeId]);

  const nodeSize = useMemo(() => {
    return (node: NodeObject) => {
      const typed = node as GraphNode;
      if (typed.type === 'technology') return 12;
      return 6;
    };
  }, []);

  const drawNodeLabel = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const typed = node as GraphNode;
    if (!typed.label) return;
    const baseSize = typed.type === 'technology' ? 8 : 10;
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
    ctx.fillStyle = '#111827';
    ctx.shadowColor = 'rgba(15, 23, 42, 0.35)';
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
    } else if (typed.type === 'person') {
      groupId = typed.company_node_id || null;
    } else if (typed.type === 'technology') {
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
    if (typed.type === 'technology') {
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
  }, [nodeColor, tagCompanyIds]);

  const handleNodeClick = (node: NodeObject) => {
    const typed = node as GraphNode;
    if (typed.type === 'company' && graphRef.current && (node as any).x != null && (node as any).y != null) {
      graphRef.current.centerAt((node as any).x, (node as any).y, 600);
      graphRef.current.zoom(1.6, 600);
    }
    if (highlightMode) {
      setSelectedNodeId(prev => (prev === typed.id ? null : typed.id));
      return;
    }
    if (typed.type === 'person') {
      const match = typed.id.match(/^contact_(\d+)$/);
      if (!match) return;
      setPersonFilter(null);
      setTechFilter(null);
      setCompanyFilter(null);
      navigate(`/contacts/${match[1]}`);
    }
    if (typed.type === 'technology') {
      setTechFilter(typed.label);
      setCompanyFilter(null);
      setPersonFilter(null);
    }
    if (typed.type === 'company') {
      setCompanyFilter(typed.label);
      setTechFilter(null);
      setPersonFilter(null);
    }
  };

  return (
    <div className="p-6 h-[calc(100vh-2rem)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">ネットワークグラフ</h1>
        {(techFilter || companyFilter || personFilter) && (
          <button
            type="button"
            onClick={() => {
              setTechFilter(null);
              setCompanyFilter(null);
              setPersonFilter(null);
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
                checked={visibleTypes.person}
                onChange={event => setVisibleTypes(prev => ({ ...prev, person: event.target.checked }))}
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
                checked={visibleTagTypes.tech}
                onChange={event => setVisibleTagTypes(prev => ({ ...prev, tech: event.target.checked }))}
                className="mr-1"
              />
              Tag/Tech
            </label>
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTagTypes.relation}
                onChange={event => setVisibleTagTypes(prev => ({ ...prev, relation: event.target.checked }))}
                className="mr-1"
              />
              Tag/Relation
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
          <select
            value={searchType}
            onChange={event => setSearchType(event.target.value as typeof searchType)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="technology">技術</option>
            <option value="company">会社</option>
            <option value="person">氏名</option>
          </select>
          <input
            type="text"
            value={searchValue}
            onChange={event => setSearchValue(event.target.value)}
            className="flex-1 min-w-[200px] border rounded px-3 py-2 text-sm"
            placeholder={`検索: ${searchType}`}
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
          タイプのON/OFFで表示切替。ハイライトONはクリックで周辺強調、OFFは会社/技術で絞り込み。
          会社ノードはクリックで中心表示します。
        </p>
        {personFilter && (
          <p className="text-xs text-gray-500 mt-2">氏名で絞り込み: "{personFilter}"</p>
        )}
      </div>
      <div className="bg-white rounded-lg shadow h-[calc(100%-3.5rem)] relative">
        <ForceGraph2D
          ref={graphRef}
          graphData={graph}
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
            const companies = graph.nodes.filter(node => node.type === 'company');
            if (companies.length > 0) {
              const nextAngles = new Map<string, number>();
              let radiusSum = 0;
              let radiusCount = 0;
              companies.forEach(node => {
                const x = (node as any).x ?? 0;
                const y = (node as any).y ?? 0;
                if (x === 0 && y === 0) return;
                const angle = Math.atan2(y, x);
                nextAngles.set(node.id, angle);
                radiusSum += Math.hypot(x, y);
                radiusCount += 1;
              });
              companyAnglesRef.current = nextAngles;
              companyRadiusRef.current = radiusCount > 0 ? radiusSum / radiusCount : 0;
            } else {
              companyAnglesRef.current = new Map();
              companyRadiusRef.current = 0;
            }
            const companyRadius = companyRadiusRef.current;
            if (!companyRadius) return;
            // guide lines removed
          }}
          nodeLabel={(node: NodeObject) => {
            const typed = node as GraphNode;
            return `${typed.label} (${typed.type})`;
          }}
          nodeColor={nodeColor}
          nodeVal={nodeSize}
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={drawNodeLabel}
          linkColor={(link: any) => {
            if (!highlightMode || !selectedNodeId) return 'rgba(148, 163, 184, 0.3)';
            const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
            const targetId = typeof link.target === 'string' ? link.target : link.target.id;
            return highlightedLinkKeys.has(`${sourceId}->${targetId}`)
              ? 'rgba(59, 130, 246, 0.8)'
              : 'rgba(203, 213, 225, 0.15)';
          }}
          linkWidth={(link: any) => {
            if (!visibleTypes.person && link.type === 'company_uses') {
              const count = Number(link.count) || 1;
              return Math.min(6, 1 + Math.log2(count + 1) * 1.2);
            }
            if (!highlightMode || !selectedNodeId) return 1;
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
            {hoveredNode.type === 'person' ? (
              <>
                <div>役職・部署: {hoveredNode.role || '-'}</div>
                <div>電話: {hoveredNode.mobile || hoveredNode.phone || '-'}</div>
                <div>メール: {hoveredNode.email || '-'}</div>
                {hoveredNode.notes ? <div>メモ: {hoveredNode.notes}</div> : null}
              </>
            ) : hoveredNode.type === 'company' ? (
              <>
                <div>郵便番号: {hoveredNode.postal_code || '-'}</div>
                <div>住所: {hoveredNode.address || '-'}</div>
              </>
            ) : (
              <div>{hoveredNode.type}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkGraph;
