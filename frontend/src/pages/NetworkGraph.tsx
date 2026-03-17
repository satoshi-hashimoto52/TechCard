import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
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
const DISPLAY_STORAGE_KEY = 'techcard_display_config';
const DEPTH_LAYOUT_RADIUS_STEP = 260;
const PRIVATE_AREA_RING_COUNT = 4;
const PRIVATE_AREA_FILL = 'rgba(145, 214, 163, 0.14)';
const PRIVATE_AREA_STROKE = 'rgba(87, 166, 111, 0.32)';
const GRID_RING_BASE_STROKE = 'rgba(70, 150, 170, 0.32)';
const GRID_RING_ALT_STROKE = 'rgba(28, 120, 168, 0.52)';
const SELF_COMPANY_RING_STROKE = 'rgba(239, 68, 68, 0.32)';
const COMPANY_MEMBER_RING_STROKE = 'rgba(96, 165, 250, 0.28)';
const COMPANY_MEMBER_RING_MIN_RADIUS = 92;
const COMPANY_MEMBER_RING_MEMBER_GAP = 68;
const LAYOUT_CHARGE_STRENGTH = -820;
const LAYOUT_COLLIDE_RADIUS = 52;
const CONNECTED_ANCHOR_RADIUS_RATIO = 0.82;
const CONNECTED_BRANCH_ANGLE_BLEND = 0.9;
const COMPANY_BRANCH_RADIUS_STEP_RATIO = 0.74;
const COMPANY_BRANCH_FAN_RADIANS = 1.05;
const RELAXED_ANCHOR_HOLD_STRENGTH = 0.42;
const SAVED_LAYOUT_RADIALIZE_BLEND = 0.55;
const SAVED_LAYOUT_RADIUS_LIMIT_RATIO = 1.7;
const SAVED_LAYOUT_RADIUS_PADDING = 120;
const GRID_STORAGE_KEY = 'techcard_grid_config';
const GUIDE_STORAGE_KEY = 'techcard_distance_guide_config';
const HOVER_TOOLTIP_DELAY_MS = 220;
const CUT_ALL_CONNECTIONS = false;
const HIDE_RING_VISUALS = true;
const ENABLE_NODE_HOVER_TOOLTIP = false;
const defaultVisibleTypes = {
  contact: true,
  company: true,
  group: true,
  event: true,
  tech: true,
  relation: true,
};
const defaultGridConfig = {
  enabled: false,
  cellSize: 120,
};
const defaultGuideConfig = {
  enabled: true,
  baseLabel: '所属会社基準',
  boundaries: [
    { stepRings: 4, name: '直接業務' },
    { stepRings: 4, name: '間接業務' },
    { stepRings: 4, name: '会社単位イベント' },
    { stepRings: 4, name: '弱い接点' },
  ],
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
  type: 'event_attendance' | 'employment' | 'company_group' | 'company_tech' | 'group_tech' | 'contact_tech' | 'tech_bridge' | 'relation' | 'company_relation' | 'group_contact' | 'company_event' | 'relation_event';
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

type CompanyMemberAssignment = {
  companyId: string;
  angle: number;
  radius: number;
  index: number;
  total: number;
};

type SearchType = 'tech' | 'company' | 'contact' | 'event';

type VisibleTypes = {
  contact: boolean;
  company: boolean;
  group: boolean;
  event: boolean;
  tech: boolean;
  relation: boolean;
};

type DistanceBoundary = {
  stepRings: number;
  name: string;
};

type GuideConfig = {
  enabled: boolean;
  baseLabel: string;
  boundaries: DistanceBoundary[];
};

type DisplayConfig = {
  visibleTypes: VisibleTypes;
  highlightMode: boolean;
  groupCollapsed: boolean;
  searchType: SearchType;
  relationEventEnabled: boolean;
};

const defaultDisplayConfig: DisplayConfig = {
  visibleTypes: defaultVisibleTypes,
  highlightMode: true,
  groupCollapsed: false,
  searchType: 'tech',
  relationEventEnabled: true,
};

const splitCompanyLabelForDisplay = (label: string): { corporateType: string; companyName: string } | null => {
  const raw = String(label || '').trim();
  if (!raw) return null;
  const toCorpType = (value: string): string | null => {
    if (value === '株式会社' || value === '株' || value === '㈱') return '株式会社';
    if (value === '有限会社' || value === '有' || value === '㈲') return '有限会社';
    return null;
  };
  const patterns: RegExp[] = [
    /^(株式会社|有限会社|㈱|㈲)\s*(.+)$/u,
    /^(.+?)\s*(株式会社|有限会社|㈱|㈲)$/u,
    /^[（(](株|有)[）)]\s*(.+)$/u,
    /^(.+?)\s*[（(](株|有)[）)]$/u,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const first = String(match[1] || '').trim();
    const second = String(match[2] || '').trim();
    const typeFirst = toCorpType(first);
    if (typeFirst && second) {
      return { corporateType: typeFirst, companyName: second };
    }
    const typeSecond = toCorpType(second);
    if (typeSecond && first) {
      return { corporateType: typeSecond, companyName: first };
    }
  }
  return null;
};

const loadDisplayConfig = (): DisplayConfig => {
  const normalizeBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const normalizeSearchType = (value: unknown): SearchType => {
    if (value === 'tech' || value === 'company' || value === 'contact' || value === 'event') return value;
    return defaultDisplayConfig.searchType;
  };

  try {
    const saved = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (!saved) return defaultDisplayConfig;
    const parsed = JSON.parse(saved) as Partial<DisplayConfig> & { visibleTypes?: unknown };
    const visible: Partial<VisibleTypes> =
      parsed.visibleTypes && typeof parsed.visibleTypes === 'object'
        ? (parsed.visibleTypes as Partial<VisibleTypes>)
        : {};
    return {
      visibleTypes: {
        contact: normalizeBoolean(visible.contact, defaultVisibleTypes.contact),
        company: normalizeBoolean(visible.company, defaultVisibleTypes.company),
        group: normalizeBoolean(visible.group, defaultVisibleTypes.group),
        event: normalizeBoolean(visible.event, defaultVisibleTypes.event),
        tech: normalizeBoolean(visible.tech, defaultVisibleTypes.tech),
        relation: normalizeBoolean(visible.relation, defaultVisibleTypes.relation),
      },
      highlightMode: normalizeBoolean(parsed.highlightMode, defaultDisplayConfig.highlightMode),
      groupCollapsed: normalizeBoolean(parsed.groupCollapsed, defaultDisplayConfig.groupCollapsed),
      searchType: normalizeSearchType(parsed.searchType),
      relationEventEnabled: normalizeBoolean((parsed as Partial<DisplayConfig>).relationEventEnabled, defaultDisplayConfig.relationEventEnabled),
    };
  } catch (error) {
    console.warn('display config load failed', error);
    return defaultDisplayConfig;
  }
};

const NetworkGraph: React.FC = () => {
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [displayConfigSeed] = useState<DisplayConfig>(() => loadDisplayConfig());
  const [rawGraph, setRawGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [graphSize, setGraphSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [techFilter, setTechFilter] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [contactFilter, setContactFilter] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number } | null>(null);
  const [searchType, setSearchType] = useState<SearchType>(displayConfigSeed.searchType);
  const [searchValue, setSearchValue] = useState('');
  const [visibleTypes, setVisibleTypes] = useState<VisibleTypes>(displayConfigSeed.visibleTypes);
  const [highlightMode, setHighlightMode] = useState(displayConfigSeed.highlightMode);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [groupCollapsed, setGroupCollapsed] = useState(displayConfigSeed.groupCollapsed);
  const [relationEventEnabled, setRelationEventEnabled] = useState(displayConfigSeed.relationEventEnabled);
  const [searchFocus, setSearchFocus] = useState<{ type: SearchType; value: string } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [guideConfig, setGuideConfig] = useState<GuideConfig>(() => {
    const saved = localStorage.getItem(GUIDE_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<GuideConfig>;
        const raw = Array.isArray(parsed.boundaries) ? parsed.boundaries.slice(0, 6) : [];
        const hasOffset = raw.some(item => Number.isFinite(Number((item as { offsetRings?: number }).offsetRings)));

        let boundaries = defaultGuideConfig.boundaries;
        if (raw.length > 0) {
          if (hasOffset) {
            let prev = 0;
            boundaries = raw.map(item => {
              const offset = Math.max(1, Number((item as { offsetRings?: number }).offsetRings) || 1);
              const step = Math.max(1, offset - prev);
              prev = offset;
              return {
                stepRings: step,
                name: String((item as Partial<DistanceBoundary>).name || ''),
              };
            });
          } else {
            boundaries = raw.map(item => ({
              stepRings: Math.max(1, Number((item as { stepRings?: number }).stepRings) || 1),
              name: String((item as Partial<DistanceBoundary>).name || ''),
            }));
          }
        }
        return {
          enabled: parsed.enabled ?? defaultGuideConfig.enabled,
          baseLabel: parsed.baseLabel ?? defaultGuideConfig.baseLabel,
          boundaries: boundaries.length > 0 ? boundaries : defaultGuideConfig.boundaries,
        };
      } catch (error) {
        console.warn('guide config load failed', error);
      }
    }
    return defaultGuideConfig;
  });
  const labelBoxesRef = useRef<{ x: number; y: number; w: number; h: number; groupId?: string | null }[]>([]);
  const labelOffsetsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const labelDragStartRef = useRef<Map<string, { ox: number; oy: number; nx: number; ny: number }>>(new Map());
  const labelDragKeyRef = useRef(false);
  const selfNodeIdRef = useRef<string | null>(null);
  const selfCompanyNodeIdRef = useRef<string | null>(null);
  const labelAngleOverridesRef = useRef<Map<string, number>>(new Map());
  const parentMapRef = useRef<Map<string, string | null>>(new Map());
  const hasCenteredRef = useRef(false);
  const zoomScaleRef = useRef(1);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const gridCenterRef = useRef<{ x: number; y: number } | null>(null);
  const fixedNodeIdsRef = useRef(new Set<string>());
  const relaxedNodeIdsRef = useRef(new Set<string>());
  const relaxedAnchorPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragLastPositionRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const orbitAnglesRef = useRef<Map<string, number>>(new Map());
  const gridNodeKeyRef = useRef<Map<string, string>>(new Map());
  const prevGridConfigRef = useRef(defaultGridConfig);
  const saveLayoutTimerRef = useRef<number | null>(null);
  const layoutSeedRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const draggingNodeIdRef = useRef<string | null>(null);
  const rotatingCompanyIdRef = useRef<string | null>(null);
  const hoveredNodeRef = useRef<GraphNode | null>(null);
  const didDragNodeRef = useRef(false);
  const companyMemberAssignmentsRef = useRef<Map<string, CompanyMemberAssignment>>(new Map());
  const companyMemberRingsRef = useRef<Map<string, { radius: number; count: number }>>(new Map());
  const companyMemberContactIdsRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    try {
      localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(guideConfig));
    } catch (error) {
      console.warn('guide config save failed', error);
    }
  }, [guideConfig]);

  useEffect(() => {
    try {
      localStorage.setItem(
        DISPLAY_STORAGE_KEY,
        JSON.stringify({
          visibleTypes,
          highlightMode,
          groupCollapsed,
          searchType,
          relationEventEnabled,
        }),
      );
    } catch (error) {
      console.warn('display config save failed', error);
    }
  }, [visibleTypes, highlightMode, groupCollapsed, searchType, relationEventEnabled]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current != null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
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
    if (CUT_ALL_CONNECTIONS) {
      return { nodes: filteredNodes, links: [] };
    }
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
        if (edge.type !== 'company_tech' && edge.type !== 'group_tech' && edge.type !== 'contact_tech' && edge.type !== 'tech_bridge') return;
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
        if (edge.type !== 'company_group' && edge.type !== 'company_tech' && edge.type !== 'group_tech' && edge.type !== 'tech_bridge') return;
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
    const contactCompany = new Map<string, string>();
    const relationEventKeys = new Set<string>();
    const selfContactIds = new Set<string>();
    const selfEventIds = new Set<string>();
    const selfRelationIds = new Set<string>();
    const contactRelationIds = new Map<string, Set<string>>();
    if (visibleTypes.contact) {
      const nodeById = new Map(rawGraph.nodes.map(node => [node.id, node]));
      rawGraph.nodes.forEach(node => {
        if (node.type === 'contact' && node.is_self) {
          selfContactIds.add(node.id);
        }
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
        const contactId = sourceId.startsWith('contact_')
          ? sourceId
          : targetId.startsWith('contact_')
          ? targetId
          : null;
        if (!companyId || !contactId) return;
        contactCompany.set(contactId, companyId);
      });
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
      rawGraph.edges.forEach(edge => {
        if (edge.type !== 'event_attendance') return;
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        const contactId = sourceId.startsWith('contact_')
          ? sourceId
          : targetId.startsWith('contact_')
          ? targetId
          : null;
        if (!contactId || !selfContactIds.has(contactId)) return;
        const eventId = sourceId.startsWith('event_')
          ? sourceId
          : targetId.startsWith('event_')
          ? targetId
          : null;
        if (eventId) selfEventIds.add(eventId);
      });

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
        if (selfContactIds.has(contactId)) {
          selfRelationIds.add(relationId);
          return;
        }
        const list = contactRelationIds.get(contactId) || new Set<string>();
        list.add(relationId);
        contactRelationIds.set(contactId, list);
      });

      if (relationEventEnabled) {
        const eventRelationContacts = new Map<string, Set<string>>();
        rawGraph.edges.forEach(edge => {
          if (edge.type !== 'event_attendance') return;
          const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
          const contactId = sourceId.startsWith('contact_')
            ? sourceId
            : targetId.startsWith('contact_')
            ? targetId
            : null;
          if (!contactId || selfContactIds.has(contactId)) return;
          const eventId = sourceId.startsWith('event_')
            ? sourceId
            : targetId.startsWith('event_')
            ? targetId
            : null;
          if (!eventId || !selfEventIds.has(eventId)) return;
          const relations = contactRelationIds.get(contactId);
          if (!relations || relations.size === 0) return;
          relations.forEach(relationId => {
            if (!selfRelationIds.has(relationId)) return;
            const key = `${eventId}::${relationId}`;
            const contacts = eventRelationContacts.get(key) || new Set<string>();
            contacts.add(contactId);
            eventRelationContacts.set(key, contacts);
          });
        });
        eventRelationContacts.forEach((contacts, key) => {
          if (contacts.size >= 1) relationEventKeys.add(key);
        });
      }
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
    if (visibleTypes.contact) {
      const existingKeys = new Set<string>();
      links.forEach(link => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        const targetId = typeof link.target === 'string' ? link.target : link.target.id;
        existingKeys.add(`${sourceId}->${targetId}->${link.type}`);
      });
      if (relationEventEnabled) {
        relationEventKeys.forEach(key => {
          const [eventId, relationId] = key.split('::');
          if (!eventId || !relationId) return;
          if (!nodeIds.has(eventId) || !nodeIds.has(relationId)) return;
          const linkKey = `${relationId}->${eventId}->relation_event`;
          if (existingKeys.has(linkKey)) return;
          links.push({ source: relationId, target: eventId, type: 'relation_event' });
          existingKeys.add(linkKey);
        });
      }
    }
    return { nodes: filteredNodes, links };
  }, [rawGraph, visibleTypes, groupCollapsed, relationEventEnabled]);

  const tagCompanyIds = useMemo(() => {
    const map = new Map<string, string[]>();
    graph.links.forEach(link => {
      if (link.type !== 'company_tech' && link.type !== 'company_relation' && link.type !== 'company_event') return;
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      const companyId = sourceId.startsWith('company_') ? sourceId : targetId.startsWith('company_') ? targetId : null;
      const tagId = sourceId.startsWith('tech_') || sourceId.startsWith('relation_') || sourceId.startsWith('event_')
        ? sourceId
        : targetId.startsWith('tech_') || targetId.startsWith('relation_') || targetId.startsWith('event_')
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

  const companyMemberLayout = useMemo(() => {
    const companyIds = new Set(
      graph.nodes
        .filter(node => node.type === 'company')
        .map(node => node.id),
    );
    const employmentByContact = new Map<string, string>();
    rawGraph.edges.forEach(edge => {
      if (edge.type !== 'employment') return;
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const companyId = sourceId.startsWith('company_')
        ? sourceId
        : targetId.startsWith('company_')
        ? targetId
        : null;
      const contactId = sourceId.startsWith('contact_')
        ? sourceId
        : targetId.startsWith('contact_')
        ? targetId
        : null;
      if (!companyId || !contactId) return;
      employmentByContact.set(contactId, companyId);
    });

    const membersByCompany = new Map<string, GraphNode[]>();
    graph.nodes.forEach(node => {
      if (node.type !== 'contact') return;
      const typed = node as GraphNode;
      const preferredCompanyId = typed.company_node_id;
      const employmentCompanyId = employmentByContact.get(typed.id) || null;
      const companyId = preferredCompanyId && companyIds.has(preferredCompanyId)
        ? preferredCompanyId
        : employmentCompanyId && companyIds.has(employmentCompanyId)
          ? employmentCompanyId
          : null;
      if (!companyId) return;
      const list = membersByCompany.get(companyId) || [];
      list.push(typed);
      membersByCompany.set(companyId, list);
    });

    const contactAssignments = new Map<string, CompanyMemberAssignment>();
    const companyRings = new Map<string, { radius: number; count: number }>();
    membersByCompany.forEach((members, companyId) => {
      const ordered = [...members].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
      const total = ordered.length;
      if (total === 0) return;
      const circumference = Math.max(3, total) * COMPANY_MEMBER_RING_MEMBER_GAP;
      const radius = Math.max(COMPANY_MEMBER_RING_MIN_RADIUS, circumference / (Math.PI * 2));
      companyRings.set(companyId, { radius, count: total });
      ordered.forEach((member, index) => {
        const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
        contactAssignments.set(member.id, {
          companyId,
          angle,
          radius,
          index,
          total,
        });
      });
    });
    return {
      contactAssignments,
      companyRings,
      contactIds: new Set(contactAssignments.keys()),
    };
  }, [graph.nodes, rawGraph.edges]);

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
    return rawNodeById.get(selectedNodeId) || graph.nodes.find(node => String(node.id) === selectedNodeId) || null;
  }, [graph.nodes, rawNodeById, selectedNodeId]);

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
    if (!selfNode) {
      selfNodeIdRef.current = null;
      selfCompanyNodeIdRef.current = null;
      return;
    }
    selfNodeIdRef.current = selfNode.id;
    selfCompanyNodeIdRef.current = selfNode.company_node_id ?? null;
    companyMemberAssignmentsRef.current = companyMemberLayout.contactAssignments;
    companyMemberRingsRef.current = companyMemberLayout.companyRings;
    companyMemberContactIdsRef.current = companyMemberLayout.contactIds;

    const nodesById = new Map(graph.nodes.map(node => [node.id, node]));
    companyMemberLayout.contactIds.forEach(contactId => {
      const node = nodesById.get(contactId) as any;
      if (!node) return;
      node.fx = null;
      node.fy = null;
      fixedNodeIdsRef.current.delete(contactId);
      relaxedNodeIdsRef.current.delete(contactId);
      relaxedAnchorPositionsRef.current.delete(contactId);
    });
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
    const defaultHop = Math.max(1, maxHop + 1);
    const connectedNodeIds = new Set<string>(hopMap.keys());
    const selfNeighborIds = adjacency.get(selfNode.id) ?? new Set<string>();

    graph.nodes.forEach(node => {
      const hop = hopMap.get(node.id) ?? defaultHop;
      (node as any).depth = hop;
    });
    (selfNode as any).depth = 0;

    const disconnectedAnchorDepth = Math.max(2, defaultHop + 1);
    const disconnectedContactDepth = Math.max(1, disconnectedAnchorDepth - 2);
    const hashToAngle = (text: string) => {
      let hash = 0;
      for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
      }
      return (hash / 0xffffffff) * Math.PI * 2;
    };

    const contactCompanyMap = new Map<string, string>();
    const contactTagMap = new Map<string, { tagId: string; priority: number }>();
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (link.type === 'employment') {
        const companyId = sourceId.startsWith('company_')
          ? sourceId
          : targetId.startsWith('company_')
          ? targetId
          : null;
        const contactId = sourceId.startsWith('contact_')
          ? sourceId
          : targetId.startsWith('contact_')
          ? targetId
          : null;
        if (companyId && contactId) {
          contactCompanyMap.set(contactId, companyId);
        }
        return;
      }
      const isTagLink = link.type === 'relation' || link.type === 'contact_tech' || link.type === 'event_attendance';
      if (!isTagLink) return;
      const contactId = sourceId.startsWith('contact_')
        ? sourceId
        : targetId.startsWith('contact_')
        ? targetId
        : null;
      if (!contactId) return;
      let tagId: string | null = null;
      let priority = 99;
      if (link.type === 'relation') {
        tagId = sourceId.startsWith('relation_') ? sourceId : targetId.startsWith('relation_') ? targetId : null;
        priority = 1;
      } else if (link.type === 'event_attendance') {
        tagId = sourceId.startsWith('event_') ? sourceId : targetId.startsWith('event_') ? targetId : null;
        priority = 2;
      } else if (link.type === 'contact_tech') {
        tagId = sourceId.startsWith('tech_') ? sourceId : targetId.startsWith('tech_') ? targetId : null;
        priority = 3;
      }
      if (!tagId) return;
      const existing = contactTagMap.get(contactId);
      if (!existing || priority < existing.priority) {
        contactTagMap.set(contactId, { tagId, priority });
      }
    });

    const disconnectedAnchors = new Map<string, string[]>();
    graph.nodes.forEach(node => {
      if (node.type !== 'contact') return;
      const typed = node as GraphNode;
      if (typed.is_self) return;
      if (connectedNodeIds.has(node.id)) return;
      const anchorId = contactCompanyMap.get(node.id) || contactTagMap.get(node.id)?.tagId || null;
      if (!anchorId || !nodeTypeById.has(anchorId)) {
        (node as any).depth = disconnectedContactDepth;
        (node as any).ringAngle = hashToAngle(node.id);
        return;
      }
      const list = disconnectedAnchors.get(anchorId) || [];
      list.push(node.id);
      disconnectedAnchors.set(anchorId, list);
    });

    disconnectedAnchors.forEach((contactIds, anchorId) => {
      if (connectedNodeIds.has(anchorId)) return;
      const anchorNode = nodesById.get(anchorId);
      if (!anchorNode) return;
      const anchorAngle = hashToAngle(anchorId);
      (anchorNode as any).depth = disconnectedAnchorDepth;
      (anchorNode as any).ringAngle = anchorAngle;

      const orderedContacts = [...contactIds].sort((a, b) => {
        const aLabel = nodesById.get(a)?.label || a;
        const bLabel = nodesById.get(b)?.label || b;
        return aLabel.localeCompare(bLabel);
      });
      const center = (orderedContacts.length - 1) / 2;
      orderedContacts.forEach((contactId, index) => {
        const contactNode = nodesById.get(contactId);
        if (!contactNode) return;
        const offset = (index - center) * 0.1;
        (contactNode as any).depth = disconnectedContactDepth;
        (contactNode as any).ringAngle = anchorAngle + offset;
      });
    });

    const firstHopAngles = new Map<string, number>();
    {
      const direct = Array.from(selfNeighborIds)
        .map(id => nodesById.get(id))
        .filter(Boolean) as GraphNode[];
      const ordered = [...direct].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
      const total = Math.max(1, ordered.length);
      ordered.forEach((node, index) => {
        const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
        firstHopAngles.set(node.id, angle);
      });
    }

    const selfCompanyId = selfNode.company_node_id ?? null;
    const selfCompanyNode = selfCompanyId ? (nodesById.get(selfCompanyId) as GraphNode | undefined) : undefined;
    const companyHopMap = new Map<string, number>();
    if (selfCompanyId && nodesById.has(selfCompanyId)) {
      const queue: string[] = [selfCompanyId];
      companyHopMap.set(selfCompanyId, 0);
      while (queue.length) {
        const current = queue.shift() as string;
        const currentHop = companyHopMap.get(current) ?? 0;
        const neighbors = adjacency.get(current);
        if (!neighbors) continue;
        neighbors.forEach(next => {
          if (!connectedNodeIds.has(next)) return;
          if (companyHopMap.has(next)) return;
          companyHopMap.set(next, currentHop + 1);
          queue.push(next);
        });
      }
    }
    const resolveCompanyFirstHop = (nodeId: string): string | null => {
      if (!selfCompanyId) return null;
      if (nodeId === selfCompanyId) return selfCompanyId;
      let current: string | null = nodeId;
      while (current) {
        const parentNode: string | null = parentMap.get(current) ?? null;
        if (parentNode === selfCompanyId) {
          return current;
        }
        if (!parentNode || parentNode === selfNode.id) {
          return null;
        }
        current = parentNode;
      }
      return null;
    };
    const companyBranchNodeIds = new Set<string>();
    connectedNodeIds.forEach(nodeId => {
      if (nodeId === selfNode.id || nodeId === selfCompanyId) return;
      const firstHop = resolveFirstHop(nodeId);
      if (selfCompanyId && firstHop === selfCompanyId) {
        companyBranchNodeIds.add(nodeId);
      }
    });
    const companyFirstHopAngles = new Map<string, number>();
    if (selfCompanyId) {
      const companyBaseAngle = Number.isFinite((selfCompanyNode as any)?.ringAngle)
        ? Number((selfCompanyNode as any)?.ringAngle)
        : (firstHopAngles.get(selfCompanyId) ?? (-Math.PI / 2));
      const directChildren = Array.from(adjacency.get(selfCompanyId) ?? [])
        .filter(id => id !== selfNode.id && connectedNodeIds.has(id));
      const orderedChildren = [...directChildren].sort((a, b) => {
        const aLabel = (nodesById.get(a)?.label || a);
        const bLabel = (nodesById.get(b)?.label || b);
        return aLabel.localeCompare(bLabel, 'ja');
      });
      const total = Math.max(1, orderedChildren.length);
      orderedChildren.forEach((nodeId, index) => {
        const spread = total <= 1
          ? 0
          : (((index / (total - 1)) - 0.5) * 2 * COMPANY_BRANCH_FAN_RADIANS);
        companyFirstHopAngles.set(nodeId, companyBaseAngle + spread);
      });
    }

    const depthGroups = new Map<number, GraphNode[]>();
    graph.nodes.forEach(node => {
      if (node.id === selfNode.id) return;
      const hop = Number.isFinite((node as any).depth) ? (node as any).depth : defaultHop;
      const list = depthGroups.get(hop) || [];
      list.push(node as GraphNode);
      depthGroups.set(hop, list);
    });

    const seedFactor = layoutSeedRef.current ?? 1;
    depthGroups.forEach((nodes, hop) => {
      const ringRadius = hop * DEPTH_LAYOUT_RADIUS_STEP * seedFactor;
      const ordered = [...nodes].sort((a, b) => {
        const angleA = Number((a as any).ringAngle);
        const angleB = Number((b as any).ringAngle);
        if (Number.isFinite(angleA) && Number.isFinite(angleB)) {
          return angleA - angleB;
        }
        const labelA = a.label || a.id;
        const labelB = b.label || b.id;
        return labelA.localeCompare(labelB);
      });
      const disconnectedInRing = ordered.filter(node => !connectedNodeIds.has(node.id));
      const disconnectedTotal = Math.max(1, disconnectedInRing.length);
      let disconnectedIndex = 0;
      const blendAngle = (primary: number, secondary: number, ratio: number) =>
        Math.atan2(
          (1 - ratio) * Math.sin(primary) + ratio * Math.sin(secondary),
          (1 - ratio) * Math.cos(primary) + ratio * Math.cos(secondary),
        );
      ordered.forEach((node, index) => {
        let angle: number;
        const ringEvenAngle = (index / Math.max(1, ordered.length)) * Math.PI * 2 - Math.PI / 2;
        if (connectedNodeIds.has(node.id)) {
          const isCompanyBranch = companyBranchNodeIds.has(node.id);
          if (isCompanyBranch) {
            const companyFirstHop = resolveCompanyFirstHop(node.id);
            const companyAngle = companyFirstHop ? companyFirstHopAngles.get(companyFirstHop) : null;
            angle = Number.isFinite(companyAngle)
              ? blendAngle(Number(companyAngle), ringEvenAngle, 0.04)
              : ringEvenAngle;
          } else {
            const firstHop = resolveFirstHop(node.id);
            const straightAngle = firstHopAngles.get(firstHop);
            angle = Number.isFinite(straightAngle)
              ? blendAngle(Number(straightAngle), ringEvenAngle, 0.08)
              : ringEvenAngle;
          }
        } else {
          const presetAngle = Number((node as any).ringAngle);
          if (Number.isFinite(presetAngle)) {
            angle = presetAngle;
          } else {
            angle = (disconnectedIndex / disconnectedTotal) * Math.PI * 2 - Math.PI / 2;
            disconnectedIndex += 1;
          }
        }
        let x = Math.cos(angle) * ringRadius;
        let y = Math.sin(angle) * ringRadius;
        if (connectedNodeIds.has(node.id) && selfCompanyId && companyBranchNodeIds.has(node.id)) {
          const fallbackCompanyAngle = Number.isFinite((selfCompanyNode as any)?.ringAngle)
            ? Number((selfCompanyNode as any).ringAngle)
            : (firstHopAngles.get(selfCompanyId) ?? (-Math.PI / 2));
          const companyDepth = Number.isFinite((selfCompanyNode as any)?.depth)
            ? Number((selfCompanyNode as any).depth)
            : 1;
          const companyRadiusFromSelf = Math.max(1, companyDepth) * DEPTH_LAYOUT_RADIUS_STEP * seedFactor;
          const companyX = Number.isFinite((selfCompanyNode as any)?.x)
            ? Number((selfCompanyNode as any).x)
            : Math.cos(fallbackCompanyAngle) * companyRadiusFromSelf;
          const companyY = Number.isFinite((selfCompanyNode as any)?.y)
            ? Number((selfCompanyNode as any).y)
            : Math.sin(fallbackCompanyAngle) * companyRadiusFromSelf;
          const companyHop = Math.max(1, companyHopMap.get(node.id) ?? 1);
          const localRadius = companyHop * DEPTH_LAYOUT_RADIUS_STEP * COMPANY_BRANCH_RADIUS_STEP_RATIO * seedFactor;
          x = companyX + Math.cos(angle) * localRadius;
          y = companyY + Math.sin(angle) * localRadius;
        }
        (node as any).ringAngle = angle;
        if (!Number.isFinite((node as any).x) || !Number.isFinite((node as any).y)) {
          (node as any).x = x;
          (node as any).y = y;
        }
      });
    });

    companyMemberAssignmentsRef.current.forEach((assignment, contactId) => {
      const companyNode = nodesById.get(assignment.companyId) as any;
      const contactNode = nodesById.get(contactId) as any;
      if (!companyNode || !contactNode) return;
      const companyX = Number.isFinite(companyNode.x)
        ? companyNode.x
        : Math.cos(Number(companyNode.ringAngle) || 0) * Math.max(1, Number(companyNode.depth) || defaultHop) * DEPTH_LAYOUT_RADIUS_STEP;
      const companyY = Number.isFinite(companyNode.y)
        ? companyNode.y
        : Math.sin(Number(companyNode.ringAngle) || 0) * Math.max(1, Number(companyNode.depth) || defaultHop) * DEPTH_LAYOUT_RADIUS_STEP;
      const targetX = companyX + Math.cos(assignment.angle) * assignment.radius;
      const targetY = companyY + Math.sin(assignment.angle) * assignment.radius;
      const shouldReset = layoutSeedRef.current != null;
      if (!Number.isFinite(contactNode.x) || !Number.isFinite(contactNode.y) || shouldReset) {
        contactNode.x = targetX;
        contactNode.y = targetY;
      }
      contactNode.companyRingCompanyId = assignment.companyId;
      contactNode.companyRingAngle = assignment.angle;
      contactNode.companyRingRadius = assignment.radius;
    });

    // 初期座標を放射状にばらまく（保存済みがある場合は維持）
    graph.nodes.forEach(node => {
      if (Number.isFinite((node as any).x) && Number.isFinite((node as any).y)) return;
      const depth = Number.isFinite((node as any).depth) ? (node as any).depth : defaultHop;
      const angle = Number.isFinite((node as any).ringAngle) ? (node as any).ringAngle : Math.random() * Math.PI * 2;
      const radius = Math.max(1, depth) * DEPTH_LAYOUT_RADIUS_STEP * seedFactor;
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

    const depthAnchorForce = (strength = 0.14) => {
      let nodes: any[] = [];
      let nodeMap = new Map<string, any>();
      const blendAngle = (primary: number, secondary: number, ratio: number) =>
        Math.atan2(
          (1 - ratio) * Math.sin(primary) + ratio * Math.sin(secondary),
          (1 - ratio) * Math.cos(primary) + ratio * Math.cos(secondary),
        );
      const force = (alpha: number) => {
        const pull = Math.max(0, alpha) * strength;
        if (!pull) return;
        nodes.forEach(node => {
          if (!node || node.id === selfNode.id) return;
          if (node.fx != null && node.fy != null) return;
          if (relaxedNodeIdsRef.current.has(String(node.id))) return;
          const currentX = Number.isFinite(node.x) ? node.x : 0;
          const currentY = Number.isFinite(node.y) ? node.y : 0;
          const depth = Number.isFinite(node.depth) ? node.depth : defaultHop;
          const nodeId = String(node.id);
          const isConnectedToSelf = connectedNodeIds.has(nodeId);
          const isCompanyBranch = isConnectedToSelf && companyBranchNodeIds.has(nodeId);
          let baseAngle = Number.isFinite(node.ringAngle) ? node.ringAngle : Math.atan2(currentY, currentX);
          if (isCompanyBranch) {
            const companyFirstHop = resolveCompanyFirstHop(nodeId);
            const branchAngle = companyFirstHop ? companyFirstHopAngles.get(companyFirstHop) : null;
            if (Number.isFinite(branchAngle)) {
              baseAngle = blendAngle(baseAngle, Number(branchAngle), CONNECTED_BRANCH_ANGLE_BLEND);
              node.ringAngle = baseAngle;
            }
          } else if (isConnectedToSelf) {
            const firstHop = resolveFirstHop(nodeId);
            const branchAngle = firstHopAngles.get(firstHop);
            if (Number.isFinite(branchAngle)) {
              baseAngle = blendAngle(baseAngle, Number(branchAngle), CONNECTED_BRANCH_ANGLE_BLEND);
              node.ringAngle = baseAngle;
            }
          }
          let targetX: number;
          let targetY: number;
          if (isCompanyBranch && selfCompanyId) {
            const companyNodeObj = nodeMap.get(selfCompanyId);
            const fallbackCompanyAngle = Number.isFinite((companyNodeObj as any)?.ringAngle)
              ? Number((companyNodeObj as any).ringAngle)
              : (firstHopAngles.get(selfCompanyId) ?? (-Math.PI / 2));
            const companyDepth = Number.isFinite((companyNodeObj as any)?.depth)
              ? Number((companyNodeObj as any).depth)
              : 1;
            const companyRadiusFromSelf = Math.max(1, companyDepth) * DEPTH_LAYOUT_RADIUS_STEP;
            const companyX = Number.isFinite((companyNodeObj as any)?.x)
              ? Number((companyNodeObj as any).x)
              : Math.cos(fallbackCompanyAngle) * companyRadiusFromSelf;
            const companyY = Number.isFinite((companyNodeObj as any)?.y)
              ? Number((companyNodeObj as any).y)
              : Math.sin(fallbackCompanyAngle) * companyRadiusFromSelf;
            const companyHop = Math.max(1, companyHopMap.get(nodeId) ?? depth);
            const targetRadius = companyHop * DEPTH_LAYOUT_RADIUS_STEP * COMPANY_BRANCH_RADIUS_STEP_RATIO;
            targetX = companyX + Math.cos(baseAngle) * targetRadius;
            targetY = companyY + Math.sin(baseAngle) * targetRadius;
          } else {
            const anchorRatio = isConnectedToSelf ? CONNECTED_ANCHOR_RADIUS_RATIO : 1;
            const targetRadius = Math.max(1, depth) * DEPTH_LAYOUT_RADIUS_STEP * anchorRatio;
            targetX = Math.cos(baseAngle) * targetRadius;
            targetY = Math.sin(baseAngle) * targetRadius;
          }
          let nodePull = isConnectedToSelf ? pull : pull * 0.85;
          if (node.type === 'contact') {
            if (companyMemberContactIdsRef.current.has(String(node.id))) return;
            nodePull *= isConnectedToSelf ? 0.52 : 0.34;
          }
          node.vx = (node.vx || 0) + (targetX - currentX) * nodePull;
          node.vy = (node.vy || 0) + (targetY - currentY) * nodePull;
        });
      };
      (force as any).initialize = (nextNodes: any[]) => {
        nodes = nextNodes;
        nodeMap = new Map(nextNodes.map(node => [String(node.id), node]));
      };
      return force;
    };

    const companyMemberRingForce = (strength = 0.24) => {
      let nodeMap = new Map<string, any>();
      const force = (alpha: number) => {
        const pull = Math.max(0, alpha) * strength;
        if (!pull) return;
        companyMemberAssignmentsRef.current.forEach((assignment, contactId) => {
          const contactNode = nodeMap.get(contactId);
          const companyNode = nodeMap.get(assignment.companyId);
          if (!contactNode || !companyNode) return;
          if (contactNode.fx != null && contactNode.fy != null) return;
          const companyX = Number.isFinite(companyNode.x) ? companyNode.x : 0;
          const companyY = Number.isFinite(companyNode.y) ? companyNode.y : 0;
          const currentX = Number.isFinite(contactNode.x) ? contactNode.x : companyX;
          const currentY = Number.isFinite(contactNode.y) ? contactNode.y : companyY;
          const targetX = companyX + Math.cos(assignment.angle) * assignment.radius;
          const targetY = companyY + Math.sin(assignment.angle) * assignment.radius;
          contactNode.vx = (contactNode.vx || 0) + (targetX - currentX) * pull;
          contactNode.vy = (contactNode.vy || 0) + (targetY - currentY) * pull;
        });
      };
      (force as any).initialize = (nextNodes: any[]) => {
        nodeMap = new Map(nextNodes.map(node => [String(node.id), node]));
      };
      return force;
    };

    const relaxedAnchorForce = (strength = RELAXED_ANCHOR_HOLD_STRENGTH) => {
      let nodeMap = new Map<string, any>();
      const force = (alpha: number) => {
        const basePull = Math.max(0.06, Math.max(0, alpha) * strength);
        relaxedAnchorPositionsRef.current.forEach((anchor, id) => {
          const node = nodeMap.get(id);
          if (!node) return;
          if (draggingNodeIdRef.current === id) return;
          if (!relaxedNodeIdsRef.current.has(id)) return;
          if (node.fx != null && node.fy != null) return;
          const currentX = Number.isFinite(node.x) ? node.x : anchor.x;
          const currentY = Number.isFinite(node.y) ? node.y : anchor.y;
          const vx = Number.isFinite(node.vx) ? node.vx : 0;
          const vy = Number.isFinite(node.vy) ? node.vy : 0;
          node.vx = (vx + (anchor.x - currentX) * basePull) * 0.72;
          node.vy = (vy + (anchor.y - currentY) * basePull) * 0.72;
          const speed = Math.hypot(node.vx, node.vy);
          if (speed > 1.8) {
            const ratio = 1.8 / speed;
            node.vx *= ratio;
            node.vy *= ratio;
          }
        });
      };
      (force as any).initialize = (nextNodes: any[]) => {
        nodeMap = new Map(nextNodes.map(node => [String(node.id), node]));
      };
      return force;
    };

    const charge = fg.d3Force('charge') as any;
    if (charge && typeof charge.strength === 'function') {
      charge.strength(LAYOUT_CHARGE_STRENGTH);
    }

    const linkForce = fg.d3Force('link') as any;
      if (linkForce && typeof linkForce.distance === 'function') {
        linkForce.distance((link: any) => {
          if (link.type === 'employment') return 96;
          const sourceType = (link.source as any)?.type;
          const targetType = (link.target as any)?.type;
          if (sourceType === 'contact' || targetType === 'contact') return 128;
          if (sourceType === 'company' || targetType === 'company') return 160;
          if (sourceType === 'tech' || targetType === 'tech') return 190;
          if (sourceType === 'relation' || targetType === 'relation') return 190;
          if (sourceType === 'group' || targetType === 'group') return 176;
          if (sourceType === 'event' || targetType === 'event') return 164;
          return 150;
        });
        if (typeof linkForce.strength === 'function') {
          linkForce.strength((link: any) => (link.type === 'employment' ? 0.24 : 0.14));
        }
      }

    fg.d3Force('type-x', null);
    fg.d3Force('type-y', null);
    fg.d3Force('tech-orbit', null);
    fg.d3Force('relation-orbit', null);
    fg.d3Force('low-degree-separation', null);
    fg.d3Force('depth-anchor', depthAnchorForce(0.14));
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
    fg.d3Force('company-member-ring', companyMemberRingForce(0.46));
    fg.d3Force('relaxed-anchor', relaxedAnchorForce(RELAXED_ANCHOR_HOLD_STRENGTH));
    fg.d3Force('collide', collideForce(LAYOUT_COLLIDE_RADIUS));

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
  }, [graph, nodeDegreeMap, layoutEpoch, companyMemberLayout]);

  const applySearch = (value: string, type: typeof searchType) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setTechFilter(null);
      setCompanyFilter(null);
      setContactFilter(null);
      setSearchFocus(null);
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
    gridNodeKeyRef.current.clear();
    nodePositionsRef.current.clear();
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
    relaxedNodeIdsRef.current.clear();
    relaxedAnchorPositionsRef.current.clear();
    dragLastPositionRef.current.clear();
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
        setSelectedNodeId(null);
        setHoveredNode(null);
        setHoveredPos(null);
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
    setSelectedNodeId(String(target.id));
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
    setSelectedNodeId(String(target.id));
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

  const graphAdjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    graph.links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      if (!map.has(sourceId)) map.set(sourceId, new Set<string>());
      if (!map.has(targetId)) map.set(targetId, new Set<string>());
      map.get(sourceId)!.add(targetId);
      map.get(targetId)!.add(sourceId);
    });
    return map;
  }, [graph.links]);

  const getDragFollowers = useCallback((startId: string, maxDepth = 3) => {
    const result: Array<{ id: string; depth: number }> = [];
    const visited = new Set<string>([startId]);
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    while (queue.length) {
      const current = queue.shift() as { id: string; depth: number };
      if (current.depth >= maxDepth) continue;
      const neighbors = graphAdjacency.get(current.id);
      if (!neighbors) continue;
      neighbors.forEach(nextId => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        const nextDepth = current.depth + 1;
        result.push({ id: nextId, depth: nextDepth });
        queue.push({ id: nextId, depth: nextDepth });
      });
    }
    return result;
  }, [graphAdjacency]);

  const getLayoutCenter = useCallback(() => {
    const selfId = selfNodeIdRef.current;
    if (!selfId) return { x: 0, y: 0 };
    const fallback = graphNodeById.get(selfId) as any;
    const pos = nodePositionsRef.current.get(selfId) || { x: fallback?.x ?? 0, y: fallback?.y ?? 0 };
    return { x: pos.x ?? 0, y: pos.y ?? 0 };
  }, [graphNodeById]);

  const getGridCenter = useCallback(() => {
    if (!gridConfig.enabled) return getLayoutCenter();
    if (gridCenterRef.current) return gridCenterRef.current;
    gridCenterRef.current = getLayoutCenter();
    return gridCenterRef.current;
  }, [getLayoutCenter, gridConfig.enabled]);

  const gridOccupancyRef = useRef(new Map<string, string>());

  const findNearestSquareCell = useCallback(
    (
      x: number,
      y: number,
      config: typeof gridConfig,
      ignoreNodeId?: string | null,
    ): { key: string; x: number; y: number } | null => {
      const center = getGridCenter();
      const cellSize = Math.max(24, Number(config.cellSize) || 120);
      const baseIx = Math.round((x - center.x) / cellSize);
      const baseIy = Math.round((y - center.y) / cellSize);
      let best: { key: string; x: number; y: number } | null = null;
      let bestDist = Infinity;
      const searchRadius = 12;
      for (let r = 0; r <= searchRadius; r += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          for (let dy = -r; dy <= r; dy += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const ix = baseIx + dx;
            const iy = baseIy + dy;
            const key = `${ix}_${iy}`;
            const occupiedBy = gridOccupancyRef.current.get(key);
            if (occupiedBy && occupiedBy !== ignoreNodeId) continue;
            const px = center.x + ix * cellSize;
            const py = center.y + iy * cellSize;
            const dist = Math.hypot(px - x, py - y);
            if (dist < bestDist) {
              bestDist = dist;
              best = { key, x: px, y: py };
            }
          }
        }
        if (best) break;
      }
      return best;
    },
    [getGridCenter],
  );

  const snapNodeToGrid = useCallback(
    (node: any, config: typeof gridConfig) => {
      if (!config.enabled) return;
      if (node.type === 'contact') return;
      // release previous occupancy by this node
      Array.from(gridOccupancyRef.current.entries()).forEach(([key, val]) => {
        if (val === node.id) gridOccupancyRef.current.delete(key);
      });
      gridNodeKeyRef.current.delete(String(node.id));
      const nx = Number.isFinite(node.x) ? Number(node.x) : 0;
      const ny = Number.isFinite(node.y) ? Number(node.y) : 0;
      const chosen: { key: string; x: number; y: number } | null = findNearestSquareCell(nx, ny, config, String(node.id));
      if (chosen) {
        node.x = chosen.x;
        node.y = chosen.y;
        node.vx = 0;
        node.vy = 0;
        node.fx = chosen.x;
        node.fy = chosen.y;
        gridOccupancyRef.current.set(chosen.key, String(node.id));
        gridNodeKeyRef.current.set(String(node.id), chosen.key);
      }
    },
    [findNearestSquareCell],
  );

  useEffect(() => {
    if (!gridConfig.enabled) {
      gridCenterRef.current = null;
      return;
    }
    // capture center once whenグリッド有効化
    getGridCenter();
  }, [gridConfig.enabled, getGridCenter]);

  const getSelfCompanyGuide = useCallback(() => {
    const selfCompanyId = selfCompanyNodeIdRef.current;
    if (!selfCompanyId) return null;
    const center = getLayoutCenter();
    const fallback = graphNodeById.get(selfCompanyId) as any;
    const pos = nodePositionsRef.current.get(selfCompanyId) || { x: fallback?.x, y: fallback?.y };
    if (!pos) return null;
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    const radius = Math.hypot(dx, dy);
    if (!Number.isFinite(radius) || radius <= 1) return null;
    return { center, radius };
  }, [getLayoutCenter, graphNodeById]);

  const drawSelfCompanyRing = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    if (HIDE_RING_VISUALS) return;
    const guide = getSelfCompanyGuide();
    if (!guide) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(guide.center.x, guide.center.y);
    ctx.strokeStyle = SELF_COMPANY_RING_STROKE;
    ctx.lineWidth = 1.4 / scale;
    ctx.beginPath();
    ctx.arc(0, 0, guide.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }, [getSelfCompanyGuide]);

  const drawCompanyMemberRings = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const rings = companyMemberRingsRef.current;
    if (!rings.size) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = COMPANY_MEMBER_RING_STROKE;
    ctx.lineWidth = Math.max(1.4 / scale, 0.6);
    rings.forEach((ring, companyId) => {
      if (!Number.isFinite(ring.radius) || ring.radius <= 8) return;
      const pos = nodePositionsRef.current.get(companyId);
      if (!pos) return;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }, []);

  const drawDistanceGuides = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    if (HIDE_RING_VISUALS) return;
    if (!guideConfig.enabled) return;
    const guide = getSelfCompanyGuide();
    if (!guide) return;

    const step = Math.max(20, Number(gridConfig.cellSize) || 120);
    const placedLabelPoints: Array<{ x: number; y: number; r: number }> = [];
    const drawArcLabel = (text: string, radius: number, color: string) => {
      const normalized = text.trim();
      if (!normalized || radius <= 10) return;
      const fontSize = Math.max(10, 13 / scale);
      const labelRadius = radius + fontSize * 0.95;
      ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const spacing = fontSize * 0.08;
      const chars = Array.from(normalized);
      const widths = chars.map(ch => ctx.measureText(ch).width + spacing);
      const totalArc = widths.reduce((sum, w) => sum + w, 0) / labelRadius;

      const buildLayout = (centerAngle: number) => {
        const normalizedCenter = ((centerAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const reverse = normalizedCenter > Math.PI / 2 && normalizedCenter < Math.PI * 1.5;
        const drawChars = reverse ? [...chars].reverse() : chars;
        const drawWidths = reverse ? [...widths].reverse() : widths;
        let angle = reverse ? centerAngle + totalArc / 2 : centerAngle - totalArc / 2;
        const glyphs: Array<{ ch: string; x: number; y: number }> = [];
        drawChars.forEach((ch, index) => {
          const arc = drawWidths[index] / labelRadius;
          const mid = reverse ? angle - arc / 2 : angle + arc / 2;
          glyphs.push({
            ch,
            x: Math.cos(mid) * labelRadius,
            y: Math.sin(mid) * labelRadius,
          });
          angle = reverse ? angle - arc : angle + arc;
        });
        return { glyphs, fontSize };
      };

      const overlaps = (layout: { glyphs: Array<{ ch: string; x: number; y: number }>; fontSize: number }) => {
        const margin = layout.fontSize * 0.72;
        for (const glyph of layout.glyphs) {
          const gx = guide.center.x + glyph.x;
          const gy = guide.center.y + glyph.y;
          for (const node of graph.nodes) {
            const pos = nodePositionsRef.current.get(node.id);
            if (!pos) continue;
            const nodeRadius = Math.sqrt(nodeSize(node)) * NODE_REL_SIZE;
            if (Math.hypot(pos.x - gx, pos.y - gy) < nodeRadius + margin) {
              return true;
            }
          }
          for (const label of placedLabelPoints) {
            if (Math.hypot(label.x - gx, label.y - gy) < label.r + margin * 0.6) {
              return true;
            }
          }
        }
        return false;
      };

      const angleStep = Math.PI / 18;
      let selected = buildLayout(-Math.PI / 2);
      for (let i = 0; i < 36; i += 1) {
        const candidate = buildLayout(-Math.PI / 2 + i * angleStep);
        if (!overlaps(candidate)) {
          selected = candidate;
          break;
        }
      }

      selected.glyphs.forEach(glyph => {
        ctx.fillText(glyph.ch, glyph.x, glyph.y);
        placedLabelPoints.push({
          x: guide.center.x + glyph.x,
          y: guide.center.y + glyph.y,
          r: selected.fontSize * 0.55,
        });
      });
    };

    const boundaries = guideConfig.boundaries.map(item => ({
      stepRings: Math.max(1, Number(item.stepRings) || 1),
      name: item.name || '',
    }));

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(guide.center.x, guide.center.y);
    drawArcLabel(guideConfig.baseLabel || '所属会社基準', guide.radius, 'rgba(239, 68, 68, 0.75)');

    ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)';
    ctx.lineWidth = 1.8 / scale;
    ctx.setLineDash([6 / scale, 6 / scale]);
    let cumulativeRings = 0;
    boundaries.forEach((boundary, index) => {
      cumulativeRings += boundary.stepRings;
      const radius = guide.radius + cumulativeRings * step;
      if (!Number.isFinite(radius) || radius <= 10) return;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      drawArcLabel(boundary.name || `区切り${index + 1}`, radius, 'rgba(37, 99, 235, 0.9)');
    });
    ctx.setLineDash([]);
    ctx.restore();
  }, [getSelfCompanyGuide, graph.nodes, gridConfig.cellSize, guideConfig, nodeSize]);

  const drawSquareGrid = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    if (!gridConfig.enabled) return;
    const cellSize = Math.max(24, Number(gridConfig.cellSize) || 120);
    const center = getGridCenter();
    const halfW = graphSize.width / Math.max(2, 2 * scale);
    const halfH = graphSize.height / Math.max(2, 2 * scale);
    let nodeMinX = Infinity;
    let nodeMaxX = -Infinity;
    let nodeMinY = Infinity;
    let nodeMaxY = -Infinity;
    graph.nodes.forEach(node => {
      const pos = nodePositionsRef.current.get(node.id);
      const x = Number.isFinite(pos?.x) ? Number(pos?.x) : (Number.isFinite((node as any).x) ? Number((node as any).x) : null);
      const y = Number.isFinite(pos?.y) ? Number(pos?.y) : (Number.isFinite((node as any).y) ? Number((node as any).y) : null);
      if (x == null || y == null) return;
      nodeMinX = Math.min(nodeMinX, x);
      nodeMaxX = Math.max(nodeMaxX, x);
      nodeMinY = Math.min(nodeMinY, y);
      nodeMaxY = Math.max(nodeMaxY, y);
    });
    const hasNodeBounds = Number.isFinite(nodeMinX) && Number.isFinite(nodeMaxX) && Number.isFinite(nodeMinY) && Number.isFinite(nodeMaxY);
    const minX = Math.min(center.x - halfW, hasNodeBounds ? nodeMinX : center.x - halfW) - cellSize * 4;
    const maxX = Math.max(center.x + halfW, hasNodeBounds ? nodeMaxX : center.x + halfW) + cellSize * 4;
    const minY = Math.min(center.y - halfH, hasNodeBounds ? nodeMinY : center.y - halfH) - cellSize * 4;
    const maxY = Math.max(center.y + halfH, hasNodeBounds ? nodeMaxY : center.y + halfH) + cellSize * 4;
    const startIx = Math.floor((minX - center.x) / cellSize);
    const endIx = Math.ceil((maxX - center.x) / cellSize);
    const startIy = Math.floor((minY - center.y) / cellSize);
    const endIy = Math.ceil((maxY - center.y) / cellSize);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = GRID_RING_BASE_STROKE;
    ctx.lineWidth = Math.max(0.5 / scale, 0.4);
    for (let ix = startIx; ix <= endIx; ix += 1) {
      const x = center.x + ix * cellSize;
      const emphasize = ix % 2 === 0;
      ctx.strokeStyle = emphasize ? GRID_RING_ALT_STROKE : GRID_RING_BASE_STROKE;
      ctx.beginPath();
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
      ctx.stroke();
    }
    for (let iy = startIy; iy <= endIy; iy += 1) {
      const y = center.y + iy * cellSize;
      const emphasize = iy % 2 === 0;
      ctx.strokeStyle = emphasize ? GRID_RING_ALT_STROKE : GRID_RING_BASE_STROKE;
      ctx.beginPath();
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
      ctx.stroke();
    }
    ctx.restore();
  }, [getGridCenter, graph.nodes, graphSize.height, graphSize.width, gridConfig.cellSize, gridConfig.enabled]);

  const drawPrivateArea = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    if (HIDE_RING_VISUALS) return;
    const center = getLayoutCenter();
    const radius = Math.max(40, gridConfig.cellSize * PRIVATE_AREA_RING_COUNT);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = PRIVATE_AREA_FILL;
    ctx.strokeStyle = PRIVATE_AREA_STROKE;
    ctx.lineWidth = 0.8 / scale;
    ctx.translate(center.x, center.y);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [getLayoutCenter, gridConfig.cellSize]);

  const scheduleLayoutSave = useCallback(() => {
    if (saveLayoutTimerRef.current) {
      window.clearTimeout(saveLayoutTimerRef.current);
    }
    saveLayoutTimerRef.current = window.setTimeout(() => {
      const positions: Record<string, { x: number; y: number }> = {};
      const fixed: Record<string, boolean> = {};
      graph.nodes.forEach(node => {
        if (companyMemberContactIdsRef.current.has(node.id)) return;
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
      const companyMemberAngles: Record<string, number> = {};
      companyMemberAssignmentsRef.current.forEach((assignment, contactId) => {
        if (Number.isFinite(assignment.angle)) {
          companyMemberAngles[contactId] = assignment.angle;
        }
      });
      const payload = { positions, labels, angles, fixed, companyMemberAngles };
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn('layout save failed', error);
      }
    }, 300);
  }, [graph.nodes, layoutEpoch]);

  useEffect(() => {
    const prev = prevGridConfigRef.current;
    const changed =
      prev.enabled !== gridConfig.enabled
      || prev.cellSize !== gridConfig.cellSize;
    if (!changed) return;

    if (!gridConfig.enabled) {
      // 非表示時も固定は維持し、編集だけロックする
      prevGridConfigRef.current = { ...gridConfig };
      return;
    }

    const center = getGridCenter();
    const nodesById = new Map(graph.nodes.map(node => [node.id, node as any]));
    const cellSize = Math.max(24, Number(gridConfig.cellSize) || 120);
    const nextKeyMap = new Map<string, string>();
    const nextOccupancy = new Map<string, string>();
    let changedAny = false;

    Array.from(gridNodeKeyRef.current.entries()).forEach(([nodeId, key]) => {
      const node = nodesById.get(nodeId);
      if (!node || node.is_self || node.type === 'contact') {
        return;
      }
      const parts = key.split('_');
      let ix = Number(parts[0]);
      let iy = Number(parts[1]);
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) {
        const px = Number.isFinite(node.fx) ? Number(node.fx) : (Number.isFinite(node.x) ? Number(node.x) : center.x);
        const py = Number.isFinite(node.fy) ? Number(node.fy) : (Number.isFinite(node.y) ? Number(node.y) : center.y);
        ix = Math.round((px - center.x) / cellSize);
        iy = Math.round((py - center.y) / cellSize);
      }
      const nextKey = `${ix}_${iy}`;
      if (nextOccupancy.has(nextKey)) return;
      const x = center.x + ix * cellSize;
      const y = center.y + iy * cellSize;
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
      node.fx = x;
      node.fy = y;
      nextKeyMap.set(nodeId, nextKey);
      nextOccupancy.set(nextKey, nodeId);
      changedAny = true;
    });
    gridOccupancyRef.current = nextOccupancy;
    gridNodeKeyRef.current = nextKeyMap;

    if (changedAny) {
      graphRef.current?.d3ReheatSimulation?.();
      scheduleLayoutSave();
    }

    prevGridConfigRef.current = { ...gridConfig };
  }, [
    graph.nodes,
    getGridCenter,
    gridConfig.enabled,
    gridConfig.cellSize,
    scheduleLayoutSave,
  ]);

  useEffect(() => {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return;
    try {
      let adjusted = false;
      const parsed = JSON.parse(raw) as {
        positions?: Record<string, { x: number; y: number }>;
        labels?: Record<string, { x: number; y: number }>;
        angles?: Record<string, number>;
        fixed?: Record<string, boolean>;
        companyMemberAngles?: Record<string, number>;
      };
      if (parsed.companyMemberAngles) {
        const nodeMap = new Map(graph.nodes.map(node => [node.id, node as any]));
        Object.entries(parsed.companyMemberAngles).forEach(([contactId, savedAngle]) => {
          if (!Number.isFinite(savedAngle)) return;
          const assignment = companyMemberAssignmentsRef.current.get(contactId);
          if (!assignment) return;
          assignment.angle = Number(savedAngle);
          const contactNode = nodeMap.get(contactId);
          const companyNode = nodeMap.get(assignment.companyId);
          if (!contactNode || !companyNode) return;
          const companyX = Number.isFinite(companyNode.x) ? Number(companyNode.x) : 0;
          const companyY = Number.isFinite(companyNode.y) ? Number(companyNode.y) : 0;
          contactNode.x = companyX + Math.cos(assignment.angle) * assignment.radius;
          contactNode.y = companyY + Math.sin(assignment.angle) * assignment.radius;
          contactNode.vx = 0;
          contactNode.vy = 0;
          adjusted = true;
        });
      }
      const fixedNodeIds = new Set<string>(
        parsed.fixed ? Object.entries(parsed.fixed).filter(([, isFixed]) => isFixed).map(([nodeId]) => nodeId) : [],
      );
      companyMemberContactIdsRef.current.forEach(nodeId => {
        fixedNodeIds.delete(nodeId);
      });
      if (parsed.positions) {
        graph.nodes.forEach(node => {
          if (companyMemberContactIdsRef.current.has(node.id)) return;
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
      const selfNode = graph.nodes.find(node => node.type === 'contact' && (node as GraphNode).is_self) as GraphNode | undefined;
      const anchorX = Number.isFinite((selfNode as any)?.x) ? Number((selfNode as any).x) : 0;
      const anchorY = Number.isFinite((selfNode as any)?.y) ? Number((selfNode as any).y) : 0;
      graph.nodes.forEach(node => {
        if (node.id === selfNode?.id) return;
        if (companyMemberContactIdsRef.current.has(node.id)) return;
        if (fixedNodeIds.has(node.id)) return;
        if (relaxedNodeIdsRef.current.has(node.id)) return;
        let nx = (node as any).x;
        let ny = (node as any).y;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
        const depth = Number.isFinite((node as any).depth) ? Number((node as any).depth) : 1;
        const expectedRadius = Math.max(1, depth) * DEPTH_LAYOUT_RADIUS_STEP;
        const ringAngle = Number.isFinite((node as any).ringAngle)
          ? Number((node as any).ringAngle)
          : Math.atan2(ny - anchorY, nx - anchorX);
        const targetX = anchorX + Math.cos(ringAngle) * expectedRadius;
        const targetY = anchorY + Math.sin(ringAngle) * expectedRadius;
        const blendedX = nx + (targetX - nx) * SAVED_LAYOUT_RADIALIZE_BLEND;
        const blendedY = ny + (targetY - ny) * SAVED_LAYOUT_RADIALIZE_BLEND;
        if (Math.hypot(blendedX - nx, blendedY - ny) > 1) {
          nx = blendedX;
          ny = blendedY;
          (node as any).x = nx;
          (node as any).y = ny;
          (node as any).vx = 0;
          (node as any).vy = 0;
          adjusted = true;
        }
        const dx = nx - anchorX;
        const dy = ny - anchorY;
        const distance = Math.hypot(dx, dy);
        if (!Number.isFinite(distance) || distance <= 0) return;
        const maxRadius = expectedRadius * SAVED_LAYOUT_RADIUS_LIMIT_RATIO + SAVED_LAYOUT_RADIUS_PADDING;
        if (distance <= maxRadius) return;
        const scale = maxRadius / distance;
        (node as any).x = anchorX + dx * scale;
        (node as any).y = anchorY + dy * scale;
        (node as any).vx = 0;
        (node as any).vy = 0;
        adjusted = true;
      });
      fixedNodeIdsRef.current = fixedNodeIds;
      labelOffsetsRef.current = new Map(Object.entries(parsed.labels ?? {}).map(([key, value]) => [key, value]));
      labelAngleOverridesRef.current = new Map(
        Object.entries(parsed.angles ?? {}).map(([key, value]) => [key, value]),
      );
      if (parsed.fixed) {
        const center = getGridCenter();
        const cellSize = Math.max(24, Number(gridConfig.cellSize) || 120);
        gridOccupancyRef.current.clear();
        gridNodeKeyRef.current.clear();
        graph.nodes.forEach(node => {
          if (!parsed.fixed?.[node.id]) return;
          if (companyMemberContactIdsRef.current.has(node.id)) return;
          if (node.type === 'contact') return;
          const px = (node as any).fx ?? (node as any).x;
          const py = (node as any).fy ?? (node as any).y;
          if (!Number.isFinite(px) || !Number.isFinite(py)) return;
          const baseIx = Math.round((Number(px) - center.x) / cellSize);
          const baseIy = Math.round((Number(py) - center.y) / cellSize);
          let best: { key: string; x: number; y: number } | null = null;
          let bestDist = Infinity;
          for (let r = 0; r <= 12; r += 1) {
            for (let dx = -r; dx <= r; dx += 1) {
              for (let dy = -r; dy <= r; dy += 1) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const ix = baseIx + dx;
                const iy = baseIy + dy;
                const key = `${ix}_${iy}`;
                if (gridOccupancyRef.current.has(key)) continue;
                const sx = center.x + ix * cellSize;
                const sy = center.y + iy * cellSize;
                const dist = Math.hypot(sx - Number(px), sy - Number(py));
                if (dist < bestDist) {
                  bestDist = dist;
                  best = { key, x: sx, y: sy };
                }
              }
            }
            if (best) break;
          }
          if (best) {
            const chosen = best as { key: string; x: number; y: number };
            (node as any).x = chosen.x;
            (node as any).y = chosen.y;
            (node as any).vx = 0;
            (node as any).vy = 0;
            (node as any).fx = chosen.x;
            (node as any).fy = chosen.y;
            gridOccupancyRef.current.set(chosen.key, node.id);
            gridNodeKeyRef.current.set(node.id, chosen.key);
          }
        });
      }
      // 会社ノード座標の復元が終わった後に、氏名ノードを会社リング上へ再投影する。
      // これを入れないと、リロード直後に旧会社座標基準の位置から一瞬補正されて見える。
      const nodeMap = new Map(graph.nodes.map(node => [node.id, node as any]));
      companyMemberAssignmentsRef.current.forEach((assignment, contactId) => {
        const contactNode = nodeMap.get(contactId);
        const companyNode = nodeMap.get(assignment.companyId);
        if (!contactNode || !companyNode) return;
        if (!Number.isFinite(companyNode.x) || !Number.isFinite(companyNode.y)) return;
        const ringX = Number(companyNode.x) + Math.cos(assignment.angle) * assignment.radius;
        const ringY = Number(companyNode.y) + Math.sin(assignment.angle) * assignment.radius;
        if (!Number.isFinite(ringX) || !Number.isFinite(ringY)) return;
        const prevX = Number(contactNode.x);
        const prevY = Number(contactNode.y);
        contactNode.x = ringX;
        contactNode.y = ringY;
        contactNode.vx = 0;
        contactNode.vy = 0;
        if (!Number.isFinite(prevX) || !Number.isFinite(prevY) || Math.hypot(prevX - ringX, prevY - ringY) > 0.5) {
          adjusted = true;
        }
      });
      if (adjusted) {
        scheduleLayoutSave();
      }
    } catch (error) {
      console.warn('layout load failed', error);
    }
  }, [graph.nodes, layoutEpoch, gridConfig.cellSize, getGridCenter, scheduleLayoutSave]);

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
    const companySplit = typed.type === 'company' ? splitCompanyLabelForDisplay(typed.label) : null;
    const labelLines = companySplit
      ? [companySplit.corporateType, companySplit.companyName]
      : [typed.label];
    const lineHeight = fontSize * 1.2;
    const textHeight = labelLines.length === 1 ? fontSize : lineHeight * labelLines.length;
    const textWidth = labelLines.reduce((maxWidth, line) => Math.max(maxWidth, ctx.measureText(line).width), 0);
    const padding = (3 * offsetFactor) / globalScale;
    const drawLines = (cx: number, cy: number) => {
      if (labelLines.length === 1) {
        ctx.fillText(labelLines[0], cx, cy);
        return;
      }
      const startY = cy - ((labelLines.length - 1) * lineHeight) / 2;
      labelLines.forEach((line, index) => {
        ctx.fillText(line, cx, startY + index * lineHeight);
      });
    };
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
    } else if (typed.type === 'tech' || typed.type === 'relation' || typed.type === 'event') {
      const companies = tagCompanyIds.get(typed.id);
      groupId = companies && companies.length > 0 ? companies[0] : null;
    }
    const makeBox = (cx: number, cy: number) => ({
      x: cx - textWidth / 2 - padding,
      y: cy - textHeight / 2 - padding,
      w: textWidth + padding * 2,
      h: textHeight + padding * 2,
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
          drawLines(cx, cy);
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
          drawLines(cx, cy);
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
    const id = (typed.id ?? node.id);
    if (id == null) return;
    setSelectedNodeId(String(id));
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoveredNode(null);
    setHoveredPos(null);
    if (typed.type === 'company' && graphRef.current && (node as any).x != null && (node as any).y != null) {
      graphRef.current.centerAt((node as any).x, (node as any).y, 600);
      graphRef.current.zoom(1.6, 600);
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
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setSettingsOpen(prev => !prev)}
              className="border border-slate-300 bg-slate-200 text-slate-700 w-11 h-11 rounded-md flex items-center justify-center hover:bg-slate-300"
              title="表示・グリッド設定"
              aria-label="表示・グリッド設定"
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3.3" />
                <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1 0 2.8l-.2.2a2 2 0 0 1-2.8 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-2 2h-.3a2 2 0 0 1-2-2v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 0 1-2.8 0l-.2-.2a2 2 0 0 1 0-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1-2-2v-.3a2 2 0 0 1 2-2h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 0 1 0-2.8l.2-.2a2 2 0 0 1 2.8 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 2-2h.3a2 2 0 0 1 2 2v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a2 2 0 0 1 2 2v.3a2 2 0 0 1-2 2h-.2a1 1 0 0 0-.9.6Z" />
              </svg>
            </button>
            {settingsOpen && (
              <div className="fixed right-6 top-24 z-40 w-[420px] max-w-[92vw] bg-slate-50/95 border border-slate-300 rounded-lg shadow-xl p-3 space-y-3 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">表示設定</h3>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    閉じる
                  </button>
                </div>
                <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
                  <p className="text-xs font-medium text-gray-700">接続ルール表示</p>
                  <label className="text-xs text-gray-600 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={relationEventEnabled}
                      onChange={event => setRelationEventEnabled(event.target.checked)}
                    />
                    2段接続（関係→イベント）を表示
                  </label>
                </div>
                <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
                  <p className="text-xs font-medium text-gray-700">グリッド線設定</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={gridConfig.enabled}
                        onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, enabled: event.target.checked }))}
                      />
                      Grid表示
                    </label>
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      セル
                      <input
                        type="number"
                        min={24}
                        max={320}
                        step={4}
                        value={gridConfig.cellSize}
                        onChange={event => setGridConfig((prev: typeof gridConfig) => ({ ...prev, cellSize: Number(event.target.value) || 120 }))}
                        className="w-16 border rounded px-2 py-1 text-xs"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    Grid表示中に「個人以外」をドラッグするとセル固定。Grid非表示時は固定を維持したまま編集ロック。
                  </p>
                </div>
                <div className="space-y-2 rounded border border-slate-200 bg-white p-2">
                  <p className="text-xs font-medium text-gray-700">距離区切り設定（赤線基準）</p>
                  <label className="text-xs text-gray-600 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={guideConfig.enabled}
                      onChange={event => setGuideConfig(prev => ({ ...prev, enabled: event.target.checked }))}
                    />
                    区切り表示
                  </label>
                  <label className="text-xs text-gray-600 flex items-center gap-2">
                    基準線ラベル
                    <input
                      type="text"
                      value={guideConfig.baseLabel}
                      onChange={event => setGuideConfig(prev => ({ ...prev, baseLabel: event.target.value }))}
                      className="flex-1 border rounded px-2 py-1 text-xs"
                    />
                  </label>
                  <div className="space-y-1">
                    {guideConfig.boundaries.map((boundary, index) => (
                      <div key={`boundary-${index}`} className="flex items-center gap-2">
                        <label className="text-xs text-gray-600 flex items-center gap-1">
                          前リングから
                          <input
                            type="number"
                            min={1}
                            max={40}
                            step={1}
                            value={boundary.stepRings}
                            onChange={event => {
                              const value = Math.max(1, Number(event.target.value) || 1);
                              setGuideConfig(prev => ({
                                ...prev,
                                boundaries: prev.boundaries.map((item, i) => (i === index ? { ...item, stepRings: value } : item)),
                              }));
                            }}
                            className="w-16 border rounded px-2 py-1 text-xs"
                          />
                        </label>
                        <input
                          type="text"
                          value={boundary.name}
                          onChange={event => {
                            const value = event.target.value;
                            setGuideConfig(prev => ({
                              ...prev,
                              boundaries: prev.boundaries.map((item, i) => (i === index ? { ...item, name: value } : item)),
                            }));
                          }}
                          className="flex-1 border rounded px-2 py-1 text-xs"
                          placeholder={`区切り ${index + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
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
        <div
          ref={containerRef}
          className="flex-1 min-w-0 relative overflow-hidden"
          onClickCapture={() => {
            if (didDragNodeRef.current) return;
            const hovered = hoveredNodeRef.current;
            if (!hovered) return;
            handleNodeClick(hovered as unknown as NodeObject);
          }}
        >
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
              const frameNodeById = new Map(graph.nodes.map(node => [node.id, node as any]));
              const rotatingCompanyId = rotatingCompanyIdRef.current;
              companyMemberAssignmentsRef.current.forEach((assignment, contactId) => {
                const contactNode = frameNodeById.get(contactId);
                const companyNode = frameNodeById.get(assignment.companyId);
                if (!contactNode || !companyNode) return;
                const companyX = Number.isFinite(companyNode.x) ? companyNode.x : 0;
                const companyY = Number.isFinite(companyNode.y) ? companyNode.y : 0;
                const ringX = companyX + Math.cos(assignment.angle) * assignment.radius;
                const ringY = companyY + Math.sin(assignment.angle) * assignment.radius;
                contactNode.x = ringX;
                contactNode.y = ringY;
                contactNode.vx = 0;
                contactNode.vy = 0;
                if (rotatingCompanyId && assignment.companyId === rotatingCompanyId) {
                  contactNode.fx = ringX;
                  contactNode.fy = ringY;
                } else {
                  contactNode.fx = null;
                  contactNode.fy = null;
                }
              });
              const nextPositions = new Map<string, { x: number; y: number }>();
              graph.nodes.forEach(node => {
                const nx = (node as any).x;
                const ny = (node as any).y;
                if (typeof nx === 'number' && typeof ny === 'number') {
                  nextPositions.set(node.id, { x: nx, y: ny });
                }
              });
              nodePositionsRef.current = nextPositions;
              drawSelfCompanyRing(ctx, globalScale);
              drawPrivateArea(ctx, globalScale);
              drawCompanyMemberRings(ctx, globalScale);
            }}
            onRenderFramePost={(ctx, globalScale) => {
              if (gridConfig.enabled) {
                drawSquareGrid(ctx, globalScale);
              }
              drawDistanceGuides(ctx, globalScale);
            }}
            nodeLabel={ENABLE_NODE_HOVER_TOOLTIP ? ((node: NodeObject) => {
              const typed = node as GraphNode;
              return typed.label;
            }) : undefined}
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
              if (!gridConfig.enabled && gridNodeKeyRef.current.has(typed.id)) {
                const lockedNode = graphNodeById.get(typed.id) as any;
                const fx = Number.isFinite(lockedNode?.fx) ? Number(lockedNode.fx) : Number((node as any).fx);
                const fy = Number.isFinite(lockedNode?.fy) ? Number(lockedNode.fy) : Number((node as any).fy);
                if (Number.isFinite(fx) && Number.isFinite(fy)) {
                  (node as any).x = fx;
                  (node as any).y = fy;
                  (node as any).fx = fx;
                  (node as any).fy = fy;
                  (node as any).vx = 0;
                  (node as any).vy = 0;
                }
                return;
              }
              didDragNodeRef.current = true;
              if (typed.id != null) {
                draggingNodeIdRef.current = String(typed.id);
              }
              if (hoverTimerRef.current != null) {
                window.clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = null;
              }
              setHoveredNode(null);
              setHoveredPos(null);
              Array.from(gridOccupancyRef.current.entries()).forEach(([key, val]) => {
                if (val === typed.id) gridOccupancyRef.current.delete(key);
              });
              gridNodeKeyRef.current.delete(typed.id);
              fixedNodeIdsRef.current.delete(typed.id);
              relaxedNodeIdsRef.current.add(typed.id);
              const rawCurrentX = Number((node as any).x);
              const rawCurrentY = Number((node as any).y);
              if (Number.isFinite(rawCurrentX) && Number.isFinite(rawCurrentY)) {
                relaxedAnchorPositionsRef.current.set(typed.id, { x: rawCurrentX, y: rawCurrentY });
              }
              let projectedDragPos: { x: number; y: number } | null = null;
              const assignment = companyMemberAssignmentsRef.current.get(typed.id);
              if (
                assignment
                && Number.isFinite(rawCurrentX)
                && Number.isFinite(rawCurrentY)
              ) {
                const companyNode = graphNodeById.get(assignment.companyId) as any;
                if (companyNode && Number.isFinite(companyNode.x) && Number.isFinite(companyNode.y)) {
                  rotatingCompanyIdRef.current = assignment.companyId;
                  const companyX = Number(companyNode.x);
                  const companyY = Number(companyNode.y);
                  const prev = dragLastPositionRef.current.get(typed.id);
                  const normalizeDelta = (value: number) => {
                    let result = value;
                    while (result > Math.PI) result -= Math.PI * 2;
                    while (result < -Math.PI) result += Math.PI * 2;
                    return result;
                  };
                  const pointerDx = rawCurrentX - companyX;
                  const pointerDy = rawCurrentY - companyY;
                  const pointerDist = Math.hypot(pointerDx, pointerDy);
                  const currentAngle = pointerDist > 1
                    ? Math.atan2(pointerDy, pointerDx)
                    : assignment.angle;
                  let delta = 0;
                  if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
                    const prevAngle = Math.atan2(prev.y - companyY, prev.x - companyX);
                    delta = normalizeDelta(currentAngle - prevAngle);
                  } else {
                    delta = normalizeDelta(currentAngle - assignment.angle);
                  }
                  if (Math.abs(delta) > 0.0001) {
                    companyMemberAssignmentsRef.current.forEach((member, memberId) => {
                      if (member.companyId !== assignment.companyId) return;
                      member.angle += delta;
                      const memberNode = graphNodeById.get(memberId) as any;
                      if (!memberNode) return;
                      const mx = companyX + Math.cos(member.angle) * member.radius;
                      const my = companyY + Math.sin(member.angle) * member.radius;
                      memberNode.x = mx;
                      memberNode.y = my;
                      memberNode.vx = 0;
                      memberNode.vy = 0;
                      memberNode.fx = mx;
                      memberNode.fy = my;
                      relaxedAnchorPositionsRef.current.set(memberId, { x: mx, y: my });
                    });
                  }
                  const updated = companyMemberAssignmentsRef.current.get(typed.id) || assignment;
                  const ringX = companyX + Math.cos(updated.angle) * updated.radius;
                  const ringY = companyY + Math.sin(updated.angle) * updated.radius;
                  (node as any).x = ringX;
                  (node as any).y = ringY;
                  (node as any).fx = ringX;
                  (node as any).fy = ringY;
                  projectedDragPos = { x: ringX, y: ringY };
                  if (Number.isFinite(ringX) && Number.isFinite(ringY)) {
                    relaxedAnchorPositionsRef.current.set(typed.id, { x: ringX, y: ringY });
                  }
                }
              } else {
                const prev = dragLastPositionRef.current.get(typed.id);
                if (
                  !gridConfig.enabled
                  && prev
                  && Number.isFinite(rawCurrentX)
                  && Number.isFinite(rawCurrentY)
                ) {
                  const dx = rawCurrentX - prev.x;
                  const dy = rawCurrentY - prev.y;
                  if (Math.abs(dx) + Math.abs(dy) > 0.01) {
                    const followers = getDragFollowers(typed.id, 3);
                    followers.forEach(({ id, depth }) => {
                      const follower = graphNodeById.get(id) as any;
                      if (!follower) return;
                      if (follower.is_self) return;
                      if (fixedNodeIdsRef.current.has(id)) return;
                      const factor = depth === 1 ? 0.58 : depth === 2 ? 0.34 : 0.2;
                      const mx = dx * factor;
                      const my = dy * factor;
                      if (!Number.isFinite(follower.x) || !Number.isFinite(follower.y)) return;
                      follower.x += mx;
                      follower.y += my;
                      follower.vx = 0;
                      follower.vy = 0;
                      follower.ringAngle = Math.atan2(follower.y, follower.x);
                      if (follower.fx != null && follower.fy != null) {
                        follower.fx += mx;
                        follower.fy += my;
                      }
                    });
                  }
                }
              }
              if (projectedDragPos) {
                dragLastPositionRef.current.set(typed.id, projectedDragPos);
              } else if (Number.isFinite(rawCurrentX) && Number.isFinite(rawCurrentY)) {
                dragLastPositionRef.current.set(typed.id, { x: rawCurrentX, y: rawCurrentY });
              }
              (node as any).vx = 0;
              (node as any).vy = 0;
              (node as any).fx = (node as any).x;
              (node as any).fy = (node as any).y;
            }}
            onNodeDragEnd={(node: NodeObject) => {
              const typed = node as GraphNode;
              draggingNodeIdRef.current = null;
              window.setTimeout(() => {
                didDragNodeRef.current = false;
              }, 0);
              dragLastPositionRef.current.delete(typed.id);
              fixedNodeIdsRef.current.delete(typed.id);
              (node as any).fx = null;
              (node as any).fy = null;
              (node as any).vx = 0;
              (node as any).vy = 0;
              if (Number.isFinite((node as any).x) && Number.isFinite((node as any).y)) {
                relaxedAnchorPositionsRef.current.set(typed.id, { x: Number((node as any).x), y: Number((node as any).y) });
              }
              const assignment = companyMemberAssignmentsRef.current.get(typed.id);
              if (assignment) {
                const companyNode = graphNodeById.get(assignment.companyId) as any;
                if (companyNode && Number.isFinite(companyNode.x) && Number.isFinite(companyNode.y)) {
                  (node as any).x = companyNode.x + Math.cos(assignment.angle) * assignment.radius;
                  (node as any).y = companyNode.y + Math.sin(assignment.angle) * assignment.radius;
                  (node as any).vx = 0;
                  (node as any).vy = 0;
                }
                companyMemberAssignmentsRef.current.forEach((member, memberId) => {
                  if (member.companyId !== assignment.companyId) return;
                  const memberNode = graphNodeById.get(memberId) as any;
                  if (!memberNode) return;
                  memberNode.fx = null;
                  memberNode.fy = null;
                });
                rotatingCompanyIdRef.current = null;
                relaxedNodeIdsRef.current.delete(typed.id);
                relaxedAnchorPositionsRef.current.delete(typed.id);
              }
              if (Number.isFinite((node as any).x) && Number.isFinite((node as any).y)) {
                (node as any).ringAngle = Math.atan2((node as any).y, (node as any).x);
              }
              if (gridConfig.enabled && typed.type !== 'contact') {
                snapNodeToGrid(node as any, gridConfig);
                if (Number.isFinite((node as any).x) && Number.isFinite((node as any).y)) {
                  relaxedAnchorPositionsRef.current.set(typed.id, { x: Number((node as any).x), y: Number((node as any).y) });
                }
              } else {
                gridNodeKeyRef.current.delete(typed.id);
                Array.from(gridOccupancyRef.current.entries()).forEach(([key, val]) => {
                  if (val === typed.id) gridOccupancyRef.current.delete(key);
                });
              }
              scheduleLayoutSave();
            }}
            onNodeHover={(node: NodeObject | null) => {
                hoveredNodeRef.current = (node as GraphNode | null) || null;
                if (!ENABLE_NODE_HOVER_TOOLTIP) {
                  if (hoverTimerRef.current != null) {
                    window.clearTimeout(hoverTimerRef.current);
                    hoverTimerRef.current = null;
                  }
                  setHoveredNode(null);
                  setHoveredPos(null);
                  return;
                }
                if (hoverTimerRef.current != null) {
                  window.clearTimeout(hoverTimerRef.current);
                  hoverTimerRef.current = null;
                }
                if (!node || draggingNodeIdRef.current) {
                  setHoveredNode(null);
                  setHoveredPos(null);
                  return;
                }
                const typed = node as GraphNode;
                hoverTimerRef.current = window.setTimeout(() => {
                  if (draggingNodeIdRef.current) return;
                  setHoveredNode(typed);
                  if (graphRef.current && (node as any).x != null && (node as any).y != null) {
                    const coords = graphRef.current.graph2ScreenCoords((node as any).x, (node as any).y);
                    setHoveredPos({ x: coords.x, y: coords.y });
                  } else {
                    setHoveredPos(null);
                  }
                }, HOVER_TOOLTIP_DELAY_MS);
              }}
            />
          )}
          {ENABLE_NODE_HOVER_TOOLTIP && hoveredNode && hoveredPos && (
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
