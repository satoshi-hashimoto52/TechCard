import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';

type GraphNode = {
  id: string;
  type: 'person' | 'company' | 'technology' | 'meeting';
  label: string;
};

type NodeObject = {
  id?: string;
  [key: string]: unknown;
};

type GraphLink = {
  source: string;
  target: string;
  type: 'works_at' | 'uses';
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const NetworkGraph: React.FC = () => {
  const navigate = useNavigate();
  const graphRef = useRef<any>(null);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [techFilter, setTechFilter] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [searchType, setSearchType] = useState<'technology' | 'company' | 'person'>('technology');
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    const params: Record<string, string | number> = {};
    if (techFilter) params.technology = techFilter;
    if (companyFilter) params.company = companyFilter;
    if (personFilter) params.person = personFilter;
    axios.get<GraphData>('http://localhost:8000/graph/network', { params }).then(response => {
      setGraph(response.data);
    });
  }, [techFilter, companyFilter, personFilter]);

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
      if (typed.type === 'person') return '#3b82f6';
      if (typed.type === 'company') return '#22c55e';
      if (typed.type === 'meeting') return '#a855f7';
      return '#f59e0b';
    };
  }, []);

  const nodeSize = useMemo(() => {
    return (node: NodeObject) => {
      const typed = node as GraphNode;
      if (typed.type === 'technology') return 10;
      if (typed.type === 'meeting') return 3;
      return 6;
    };
  }, []);

  const handleNodeClick = (node: NodeObject) => {
    const typed = node as GraphNode;
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
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          onNodeHover={(node: NodeObject | null) => setHoveredNode((node as GraphNode) || null)}
        />
        {hoveredNode && (
          <div className="absolute bottom-6 left-6 bg-gray-900 text-white text-xs px-3 py-2 rounded shadow">
            {hoveredNode.label} ({hoveredNode.type})
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkGraph;
