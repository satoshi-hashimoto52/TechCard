import { AxiosResponse } from 'axios';
import api from '../lib/api';
import { TagOption } from './tagService';

export type CompanyGroup = {
  id: number;
  name: string;
  tags?: { name: string; type?: string }[];
};

export type CompanyTagResolveResponse = {
  company_id: number | null;
  group_id: number | null;
  group_name: string | null;
  company_tags: TagOption[];
  group_tags: TagOption[];
};

export type CompanyTagPayload = {
  tag_items: Array<{ name: string; type: string }>;
};

type RequestOptions = {
  signal?: AbortSignal;
};

export const fetchCompanyGroups = (options?: RequestOptions): Promise<AxiosResponse<CompanyGroup[]>> => {
  return api.get<CompanyGroup[]>('/company-groups', { signal: options?.signal });
};

export const resolveCompanyTags = (
  name: string,
  options?: RequestOptions,
): Promise<AxiosResponse<CompanyTagResolveResponse>> => {
  return api.get<CompanyTagResolveResponse>('/companies/resolve', {
    params: { name },
    signal: options?.signal,
  });
};

export const fetchCompanyTags = (companyId: number, options?: RequestOptions): Promise<AxiosResponse<TagOption[]>> => {
  return api.get<TagOption[]>(`/companies/${companyId}/tags`, { signal: options?.signal });
};

export const updateCompanyTags = (
  companyId: number,
  payload: CompanyTagPayload,
): Promise<AxiosResponse<TagOption[]>> => {
  return api.put<TagOption[]>(`/companies/${companyId}/tags`, payload);
};

export const fetchCompanyGroupTags = (
  groupId: number,
  options?: RequestOptions,
): Promise<AxiosResponse<TagOption[]>> => {
  return api.get<TagOption[]>(`/company-groups/${groupId}/tags`, { signal: options?.signal });
};

export const updateCompanyGroupTags = (
  groupId: number,
  payload: CompanyTagPayload,
): Promise<AxiosResponse<TagOption[]>> => {
  return api.put<TagOption[]>(`/company-groups/${groupId}/tags`, payload);
};
