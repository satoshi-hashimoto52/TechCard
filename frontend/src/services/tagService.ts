import { AxiosResponse } from 'axios';
import api from '../lib/api';

export type TagOption = {
  id: number;
  name: string;
  type?: string;
};

export type TagUpdatePayload = {
  name: string;
  type: 'tech' | 'event' | 'relation' | string;
};

export type TagExtractResponse = {
  tags: string[];
};

type RequestOptions = {
  signal?: AbortSignal;
};

export const fetchTags = (options?: RequestOptions): Promise<AxiosResponse<TagOption[]>> => {
  return api.get<TagOption[]>('/tags', { signal: options?.signal });
};

export const extractTags = (text: string): Promise<AxiosResponse<TagExtractResponse>> => {
  return api.post<TagExtractResponse>('/tags/extract', { text });
};

export const updateTag = (id: number, payload: TagUpdatePayload): Promise<AxiosResponse<void>> => {
  return api.put(`/tags/${id}`, payload);
};

export const deleteTag = (id: number): Promise<AxiosResponse<void>> => {
  return api.delete(`/tags/${id}`);
};
