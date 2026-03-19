import axios, { AxiosError } from 'axios';

export type ApiError = Error & {
  status: number | null;
  code: string | null;
  detail: unknown;
  isTimeout: boolean;
  isNetworkError: boolean;
  isAborted: boolean;
};

const DEFAULT_BASE_URL = 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 15000;

const normalizeBaseUrl = (value?: string): string => {
  const trimmed = (value || '').trim();
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/, '');
};

const resolveTimeout = (): number => {
  const raw = Number(process.env.REACT_APP_API_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return raw;
};

const extractMessageFromDetail = (detail: unknown): string | null => {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return null;
};

const toApiError = (error: unknown): ApiError => {
  const fallback = new Error('API request failed') as ApiError;
  fallback.name = 'ApiError';
  fallback.status = null;
  fallback.code = null;
  fallback.detail = null;
  fallback.isTimeout = false;
  fallback.isNetworkError = false;
  fallback.isAborted = false;

  if (!axios.isAxiosError(error)) {
    fallback.message = error instanceof Error ? error.message : fallback.message;
    return fallback;
  }

  const axiosError = error as AxiosError<{ detail?: unknown; message?: string }>;
  const detail = axiosError.response?.data?.detail ?? axiosError.response?.data ?? null;
  const detailMessage = extractMessageFromDetail(detail);
  const status = axiosError.response?.status ?? null;
  const code = axiosError.code ?? null;
  const isAborted = code === 'ERR_CANCELED';
  const isTimeout = code === 'ECONNABORTED';
  const isNetworkError = !status && !isAborted && !isTimeout;
  const message = detailMessage || axiosError.message || 'API request failed';

  const apiError = new Error(message) as ApiError;
  apiError.name = 'ApiError';
  apiError.status = status;
  apiError.code = code;
  apiError.detail = detail;
  apiError.isTimeout = isTimeout;
  apiError.isNetworkError = isNetworkError;
  apiError.isAborted = isAborted;
  return apiError;
};

export const createAbortController = () => new AbortController();

export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  return Boolean((error as Partial<ApiError>).isAborted);
};

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const api = axios.create({
  baseURL: normalizeBaseUrl(process.env.REACT_APP_API_BASE_URL),
  timeout: resolveTimeout(),
});

api.interceptors.response.use(
  response => response,
  error => Promise.reject(toApiError(error)),
);

export default api;
