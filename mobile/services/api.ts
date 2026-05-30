import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { CONFIG } from '../constants/config';
import { ApiError } from '../types';
import { crashReporting } from './crashReporting';
import { tokenStorage } from './tokenStorage';

// ------------------------------------------------------------------
// API CLIENT — Production-grade Axios instance
// ------------------------------------------------------------------

const api = axios.create({
    baseURL: CONFIG.API_BASE_URL,
    timeout: 15000, // 15s default (media uploads may need more)
    headers: {
        'Content-Type': 'application/json',
    },
});

// ------------------------------------------------------------------
// Debug logging helpers — redact sensitive data
// ------------------------------------------------------------------

const redactHeaders = (headers: Record<string, any> | undefined): Record<string, any> | undefined => {
    if (!headers) return headers;
    const safe = { ...headers };
    if (safe.Authorization) {
        safe.Authorization = 'Bearer [REDACTED]';
    }
    return safe;
};

const redactBody = (data: any): any => {
    if (!data || typeof data !== 'object') return data;
    const safe = { ...data };
    const sensitiveFields = ['password', 'hashed_password', 'token', 'push_token', 'wifi_password'];
    for (const field of sensitiveFields) {
        if (field in safe) {
            safe[field] = '[REDACTED]';
        }
    }
    return safe;
};

// ------------------------------------------------------------------
// Request Interceptor — attach Bearer token + debug logging
// ------------------------------------------------------------------

api.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
        const token = await tokenStorage.get();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        if (CONFIG.IS_DEBUG) {
            console.log(
                `[API] >> ${config.method?.toUpperCase()} ${config.url}`,
                config.params ? `params=${JSON.stringify(config.params)}` : '',
                config.data ? `body=${JSON.stringify(redactBody(config.data))}` : ''
            );
        }

        return config;
    },
    (error) => Promise.reject(error)
);

// ------------------------------------------------------------------
// Response Interceptor — structured errors, auth redirect, logging
// ------------------------------------------------------------------

api.interceptors.response.use(
    (response: AxiosResponse) => {
        if (CONFIG.IS_DEBUG) {
            console.log(
                `[API] << ${response.status} ${response.config?.method?.toUpperCase()} ${response.config?.url}`
            );
        }
        return response;
    },
    async (error: AxiosError<{ detail?: string | { msg: string; type: string }[] }>) => {
        const isNetworkError = !error.response && !!error.request;
        const statusCode = error.response?.status || 0;

        // ----------------------------------------------------------
        // 1. Parse the backend error message.
        //    FastAPI returns { detail: string } or { detail: [{msg, type, loc}] }
        // ----------------------------------------------------------
        let message: string;

        if (isNetworkError) {
            message = 'Network error. Please check your connection and try again.';
        } else if (error.response?.data?.detail) {
            const detail = error.response.data.detail;
            if (typeof detail === 'string') {
                message = detail;
            } else if (Array.isArray(detail)) {
                // FastAPI validation errors: [{msg, type, loc}, ...]
                message = detail.map((e) => e.msg).join('; ');
            } else {
                message = String(detail);
            }
        } else if (error.code === 'ECONNABORTED') {
            message = 'Request timed out. The server may be slow or unreachable.';
        } else {
            message = error.message || 'Something went wrong. Please try again.';
        }

        // ----------------------------------------------------------
        // 2. Handle 401 — clear token, auth guard will redirect to login
        // ----------------------------------------------------------
        if (statusCode === 401) {
            console.warn('[API] 401 Unauthorized -- clearing token');
            await tokenStorage.remove();
        }

        // ----------------------------------------------------------
        // 3. Debug logging (redact sensitive data)
        // ----------------------------------------------------------
        if (CONFIG.IS_DEBUG) {
            console.warn(
                `[API] !! ${statusCode || 'NETWORK'} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
                `| ${message}`,
                isNetworkError ? '(network error)' : ''
            );
        }

        // ----------------------------------------------------------
        // 4. Report server errors (5xx) to crash reporting
        // ----------------------------------------------------------
        if (statusCode >= 500) {
            crashReporting.captureException(
                new Error(`API ${statusCode}: ${message}`),
                { url: error.config?.url, method: error.config?.method }
            );
        }

        // ----------------------------------------------------------
        // 5. Return structured ApiError
        // ----------------------------------------------------------
        return Promise.reject(
            new ApiError(
                message,
                statusCode,
                undefined,
                isNetworkError
            )
        );
    }
);

// ------------------------------------------------------------------
// Retry wrapper — retry once on network timeout/error
// ------------------------------------------------------------------

export async function apiWithRetry<T>(
    requestFn: () => Promise<T>,
    retries: number = 1
): Promise<T> {
    try {
        return await requestFn();
    } catch (error) {
        if (
            retries > 0
            && error instanceof ApiError
            && (error.isNetworkError || error.statusCode === 408 || error.statusCode === 0)
        ) {
            console.log(`[API] Retrying request... (${retries} retries left)`);
            // Wait 1s before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            return apiWithRetry(requestFn, retries - 1);
        }
        throw error;
    }
}

export default api;
