import { AxiosResponse } from 'axios';
import api from '../lib/api';

export type Contact = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: {
    id: number;
    name: string;
    group_id?: number | null;
    postal_code?: string | null;
    address?: string | null;
    tech_tags?: { name: string; type?: string }[];
  };
  tags: { name: string; type?: string }[];
  first_met_at?: string;
  notes?: string;
  postal_code?: string;
  address?: string;
  mobile?: string;
  branch?: string;
};

export type ContactRegisterResponse = {
  id: number;
};

export type CardDetectResponse = {
  points?: { x: number; y: number }[] | null;
  source?: 'contour' | 'fallback';
  score?: number;
};

export type OcrRegionResponse = {
  field: string;
  text: string;
};

export type MobileUploadInfoResponse = {
  base_url: string;
};

export type MobileUploadLatestResponse = {
  success: boolean;
  filename?: string;
  url?: string;
  timestamp?: number;
};

export type ContactRegisterPayload = {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  mobile: string | null;
  postal_code: string | null;
  address: string | null;
  branch: string | null;
  company_name: string | null;
  first_met_at: string | null;
  tags: string[];
  tag_items: Array<{ name: string; type: string }>;
  company_tag_items: Array<{ name: string; type: string }> | null;
  group_tag_items: Array<{ name: string; type: string }> | null;
  notes: string | null;
  card_filename: string | null;
  ocr_text: string | null;
};

type RequestOptions = {
  signal?: AbortSignal;
};

type FetchContactsParams = {
  limit?: number;
  signal?: AbortSignal;
};

export const fetchContacts = (params?: FetchContactsParams): Promise<AxiosResponse<Contact[]>> => {
  return api.get<Contact[]>('/contacts/', {
    params: { limit: params?.limit ?? 100 },
    signal: params?.signal,
  });
};

export const fetchContactById = (id: number, options?: RequestOptions): Promise<AxiosResponse<Contact>> => {
  return api.get<Contact>(`/contacts/${id}`, { signal: options?.signal });
};

export const registerContact = (
  payload: ContactRegisterPayload,
): Promise<AxiosResponse<ContactRegisterResponse>> => {
  return api.post<ContactRegisterResponse>('/contacts/register', payload);
};

export const updateContactRegistration = (
  id: number,
  payload: ContactRegisterPayload,
): Promise<AxiosResponse<ContactRegisterResponse>> => {
  return api.put<ContactRegisterResponse>(`/contacts/${id}/register`, payload);
};

export const detectCard = (
  image: string,
  options?: RequestOptions & { timeout?: number },
): Promise<AxiosResponse<CardDetectResponse>> => {
  return api.post<CardDetectResponse>(
    '/card/detect',
    { image },
    { signal: options?.signal, timeout: options?.timeout ?? 15000 },
  );
};

export const ocrRegion = (formData: FormData): Promise<AxiosResponse<OcrRegionResponse>> => {
  return api.post<OcrRegionResponse>('/cards/ocr-region', formData);
};

export const fetchMobileUploadInfo = (): Promise<AxiosResponse<MobileUploadInfoResponse>> => {
  return api.get<MobileUploadInfoResponse>('/api/mobile-upload/info');
};

export const fetchMobileUploadLatest = (options?: RequestOptions): Promise<AxiosResponse<MobileUploadLatestResponse>> => {
  return api.get<MobileUploadLatestResponse>('/api/mobile-upload/latest', { signal: options?.signal });
};
