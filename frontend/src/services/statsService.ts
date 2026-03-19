import { AxiosResponse } from 'axios';
import api from '../lib/api';

export type Summary = {
  counts: {
    contacts: number;
    companies: number;
    prefectures?: number;
    tags: number;
    meetings: number;
    connectable_contacts?: number;
    connected_contacts?: number;
    connection_rate?: number;
  };
  lists: {
    contacts: { id: number; name: string }[];
    companies: { name: string; count: number }[];
    prefectures?: { name: string; count: number }[];
    tags: { name: string; count: number }[];
    meetings: { id: number; contact_name: string | null; company_name?: string | null; overlap: number }[];
  };
};

export type CompanyMapPoint = {
  company_id: number;
  name: string;
  count: number;
  lat: number | null;
  lon: number | null;
  is_self: boolean;
  postal_code?: string | null;
  address?: string | null;
  city?: string | null;
  geocode_progress?: {
    success: number;
    total: number;
  };
};

export type CompanyDiagnostics = {
  missing_addresses: { company_id: number; name: string }[];
  invalidated_coords: { company_id: number; name: string; reason: string }[];
  short_addresses: { company_id: number; name: string }[];
};

export type RouteLine = {
  type: 'LineString';
  coordinates: [number, number][];
};

export type RouteStep = {
  lon: number;
  lat: number;
  kind: 'enter' | 'exit' | 'junction' | 'road' | 'other';
  label: string;
  road?: string | null;
  detail?: string | null;
};

export type CompanyRouteResponse = {
  from_company_id: number;
  from_company_name: string;
  to_company_id: number;
  to_company_name: string;
  to_company_address?: string | null;
  from_prefecture?: string | null;
  to_prefecture?: string | null;
  policy: string;
  effective_mode: string;
  distance_m: number;
  distance_km: number;
  duration_s?: number | null;
  duration_min?: number | null;
  geometry: RouteLine;
  route_steps?: RouteStep[];
  cached: boolean;
  provider: string;
  updated_at?: string | null;
};

export type GraphNode = {
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

export type GraphLink = {
  source: string | { id: string };
  target: string | { id: string };
  type:
    | 'event_attendance'
    | 'employment'
    | 'company_group'
    | 'company_tech'
    | 'group_tech'
    | 'contact_tech'
    | 'tech_bridge'
    | 'relation'
    | 'company_relation'
    | 'group_contact'
    | 'company_event'
    | 'relation_event';
  count?: number;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphLink[];
};

type RequestOptions = {
  signal?: AbortSignal;
};

type FetchNetworkFilters = {
  tech?: string | null;
  company?: string | null;
  contact?: string | null;
  signal?: AbortSignal;
};

type FetchCompanyRouteParams = {
  toCompanyId: number;
  toLat: number | null;
  toLon: number | null;
  toAddress?: string | null;
  signal?: AbortSignal;
};

export const fetchSummary = (options?: RequestOptions): Promise<AxiosResponse<Summary>> => {
  return api.get<Summary>('/stats/summary', { signal: options?.signal });
};

export const fetchCompanyMap = (
  refresh?: boolean,
  options?: RequestOptions,
): Promise<AxiosResponse<CompanyMapPoint[]>> => {
  return api.get<CompanyMapPoint[]>('/stats/company-map', {
    signal: options?.signal,
    params: refresh ? { refresh: 1 } : undefined,
  });
};

export const fetchCompanyDiagnostics = (options?: RequestOptions): Promise<AxiosResponse<CompanyDiagnostics>> => {
  return api.get<CompanyDiagnostics>('/stats/company-map/diagnostics', { signal: options?.signal });
};

export const fetchNetwork = (filters?: FetchNetworkFilters): Promise<AxiosResponse<GraphData>> => {
  const params: Record<string, string> = {};
  if (filters?.tech) params.technology = filters.tech;
  if (filters?.company) params.company = filters.company;
  if (filters?.contact) params.person = filters.contact;
  return api.get<GraphData>('/stats/network', { params, signal: filters?.signal });
};

export const fetchCompanyRoute = (
  params: FetchCompanyRouteParams,
): Promise<AxiosResponse<CompanyRouteResponse>> => {
  return api.get<CompanyRouteResponse>('/stats/company-route', {
    signal: params.signal,
    params: {
      to_company_id: params.toCompanyId,
      to_lat: params.toLat,
      to_lon: params.toLon,
      to_address: params.toAddress,
    },
  });
};
