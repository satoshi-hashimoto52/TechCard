import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';

type GraphNode = {
  id: string;
  type: 'person' | 'company' | 'technology' | 'meeting';
  label: string;
  role?: string;
  email?: string;
  phone?: string;
  mobile?: string;
};

type NodeObject = {
  id?: string;
  [key: string]: unknown;
};

type GraphLink = {
  source: string | { id: string };
  target: string | { id: string };
  type: 'works_at' | 'uses' | 'met_at' | 'company_uses';
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
  const [searchType, setSearchType] = useState<'technology' | 'company' | 'person'>('technology');
  const [searchValue, setSearchValue] = useState('');
  const [visibleTypes, setVisibleTypes] = useState({
    person: true,
    company: true,
    technology: true,
    meeting: true,
  });
  const [highlightMode, setHighlightMode] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
    const nodes = rawGraph.nodes.filter(node => allowedTypes.has(node.type));
    const nodeIds = new Set(nodes.map(node => node.id));
    const links = rawGraph.links.filter(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });
    return { nodes, links };
  }, [rawGraph, visibleTypes]);

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
    const charge = fg.d3Force('charge') as any;
    if (charge && typeof charge.strength === 'function') {
      charge.strength(-120);
    }
    const linkForce = fg.d3Force('link') as any;
    if (linkForce && typeof linkForce.distance === 'function') {
      linkForce.distance(120);
    }
    fg.d3ReheatSimulation();
  }, [graph]);

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
      const base =
        typed.type === 'person'
          ? '#3b82f6'
          : typed.type === 'company'
          ? '#22c55e'
          : typed.type === 'meeting'
          ? '#a855f7'
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
      if (typed.type === 'technology') return 10;
      if (typed.type === 'meeting') return 3;
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
    ctx.save();
    ctx.font = `${fontSize}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111827';
    ctx.shadowColor = 'rgba(15, 23, 42, 0.35)';
    ctx.shadowBlur = 4 / globalScale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1 / globalScale;
    ctx.fillText(typed.label, x, y);
    ctx.restore();
  }, [nodeColor]);

  const handleNodeClick = (node: NodeObject) => {
    const typed = node as GraphNode;
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
                checked={visibleTypes.technology}
                onChange={event => setVisibleTypes(prev => ({ ...prev, technology: event.target.checked }))}
                className="mr-1"
              />
              技術
            </label>
            <label className="text-xs text-gray-600">
              <input
                type="checkbox"
                checked={visibleTypes.meeting}
                onChange={event => setVisibleTypes(prev => ({ ...prev, meeting: event.target.checked }))}
                className="mr-1"
              />
              ミーティング
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
        {personFilter && (
          <p className="text-xs text-gray-500 mt-2">氏名で絞り込み: "{personFilter}"</p>
        )}
      </div>
      <div className="bg-white rounded-lg shadow h-[calc(100%-3.5rem)]">
        <ForceGraph2D
          ref={graphRef}
          graphData={graph}
          nodeLabel={(node: NodeObject) => {
            const typed = node as GraphNode;
            return `${typed.label} (${typed.type})`;
          }}
          nodeColor={nodeColor}
          nodeVal={nodeSize}
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={drawNodeLabel}
          linkColor={(link: any) => {
            if (!highlightMode || !selectedNodeId) return 'rgba(148, 163, 184, 0.5)';
            const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
            const targetId = typeof link.target === 'string' ? link.target : link.target.id;
            return highlightedLinkKeys.has(`${sourceId}->${targetId}`)
              ? 'rgba(59, 130, 246, 0.8)'
              : 'rgba(203, 213, 225, 0.25)';
          }}
          linkWidth={(link: any) => {
            if (!highlightMode || !selectedNodeId) return 1;
            const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
            const targetId = typeof link.target === 'string' ? link.target : link.target.id;
            return highlightedLinkKeys.has(`${sourceId}->${targetId}`) ? 2 : 1;
          }}
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          onNodeHover={(node: NodeObject | null) => setHoveredNode((node as GraphNode) || null)}
          onBackgroundClick={() => setSelectedNodeId(null)}
        />
        {hoveredNode && (
          <div className="absolute bottom-6 left-6 bg-gray-900 text-white text-xs px-3 py-2 rounded shadow space-y-1">
            <div className="font-semibold">{hoveredNode.label}</div>
            {hoveredNode.type === 'person' ? (
              <>
                <div>役職・部署: {hoveredNode.role || '-'}</div>
                <div>電話: {hoveredNode.mobile || hoveredNode.phone || '-'}</div>
                <div>メール: {hoveredNode.email || '-'}</div>
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
