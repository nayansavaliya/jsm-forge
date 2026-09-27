/**
 * src/services/external-api.ts
 *
 * Secure proxy for outbound calls to external company APIs.
 * Enforces the allowedPaths whitelist from config before making any request.
 * Handles auth header injection via token-cache.ts.
 * Caches responses in Forge KV Storage with per-field TTL.
 */

import { fetch as forgeFetch, storage } from '@forge/api';
import { getConfig } from '../config-loader';
import { getAuthValue } from './token-cache';
import type { ApiSource } from '../config-loader/schema';

export interface FieldOption {
  value: string;
  label: string;
}

export interface ProxyResult {
  options: FieldOption[];
  cached: boolean;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function buildCacheKey(sourceId: string, apiPath: string, dependsOnValue?: string): string {
  const base = `fc::${sourceId}::${apiPath}`;
  return dependsOnValue ? `${base}::${dependsOnValue}` : base;
}

interface CachedOptions {
  options: FieldOption[];
  expiresAt: number;
}

// ─── Path whitelist enforcement ───────────────────────────────────────────────

function isPathAllowed(allowedPaths: string[], requestPath: string): boolean {
  return allowedPaths.some((pattern) => {
    // Simple glob: trailing /* allows any sub-path
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return requestPath === prefix || requestPath.startsWith(prefix + '/');
    }
    return requestPath === pattern;
  });
}

// ─── Auth header injection ────────────────────────────────────────────────────

async function buildHeaders(
  source: ApiSource,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...source.headers,
    ...extraHeaders,
  };

  const authValue = await getAuthValue(source);

  if (source.authType === 'api-key') {
    if (source.auth.placement === 'header' && source.auth.headerName) {
      headers[source.auth.headerName] = authValue;
    }
    // query placement is handled by appending to URL (see fetchOptions below)
  } else {
    headers['Authorization'] = authValue;
  }

  return headers;
}

function buildUrl(source: ApiSource, apiPath: string): string {
  const base = source.baseUrl.replace(/\/$/, '');
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  let url = `${base}${cleanPath}`;

  if (source.authType === 'api-key' && source.auth.placement === 'query' && source.auth.queryParam) {
    // We append a placeholder — the actual key is injected at fetch time
    // This is intentionally NOT done here to avoid leaking keys into logs.
    // The key is appended inside fetchWithAuth after headers are built.
  }

  return url;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchWithAuth(source: ApiSource, apiPath: string): Promise<unknown> {
  const headers = await buildHeaders(source);
  let url = buildUrl(source, apiPath);

  // For query-param API keys, append after building headers (key not in URL logs)
  if (source.authType === 'api-key' && source.auth.placement === 'query' && source.auth.queryParam) {
    const authValue = await getAuthValue(source);
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}${source.auth.queryParam}=${encodeURIComponent(authValue)}`;
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= source.retries; attempt++) {
    try {
      const res = await forgeFetch(url, {
        method: 'GET',
        headers,
        // Forge fetch doesn't support AbortSignal timeout natively,
        // but timeout config is available for future use
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${source.id}:${apiPath}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < source.retries) {
        // Exponential back-off: 200ms, 400ms, 800ms…
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${source.id}:${apiPath}`);
}

// ─── Option extraction ────────────────────────────────────────────────────────

function extractOptions(
  data: unknown,
  valueKey = 'value',
  labelKey = 'label',
): FieldOption[] {
  const arr = Array.isArray(data) ? data : (data as Record<string, unknown>)?.data;
  if (!Array.isArray(arr)) {
    throw new Error('External API response must be an array or have a "data" array property');
  }
  return arr.map((item: Record<string, unknown>) => ({
    value: String(item[valueKey] ?? ''),
    label: String(item[labelKey] ?? item[valueKey] ?? ''),
  }));
}

// ─── Public proxy function ────────────────────────────────────────────────────

export async function resolveFieldOptions(params: {
  apiSourceId: string;
  /** May contain {{fieldId}} template placeholders interpolated before calling */
  apiPath: string;
  dependsOnValue?: string;
  valueKey?: string;
  labelKey?: string;
  cacheTtlSeconds?: number;
}): Promise<ProxyResult> {
  const config = getConfig();
  const source = config.apiSources.find((s) => s.id === params.apiSourceId);

  if (!source) {
    throw new Error(`Unknown apiSourceId: "${params.apiSourceId}"`);
  }

  // Interpolate {{dependsOnValue}} placeholder in apiPath
  const resolvedPath = params.apiPath.replace(/\{\{[^}]+\}\}/g, params.dependsOnValue ?? '');

  // Extract just the path portion (strip base URL if accidentally included)
  const pathOnly = resolvedPath.startsWith('http')
    ? new URL(resolvedPath).pathname + new URL(resolvedPath).search
    : resolvedPath;

  // ── Security: whitelist check
  const pathForCheck = pathOnly.split('?')[0];
  if (!isPathAllowed(source.allowedPaths, pathForCheck)) {
    throw new Error(
      `[external-api] Path "${pathForCheck}" is not in the allowedPaths for source "${source.id}"`,
    );
  }

  // ── Cache check
  const cacheKey = buildCacheKey(source.id, resolvedPath, params.dependsOnValue);
  const cached = await storage.get(cacheKey) as CachedOptions | undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return { options: cached.options, cached: true };
  }

  // ── Fetch from external API
  const data = await fetchWithAuth(source, pathOnly);
  const options = extractOptions(data, params.valueKey, params.labelKey);

  // ── Store in cache
  const ttlMs = (params.cacheTtlSeconds ?? 300) * 1000;
  await storage.set(cacheKey, { options, expiresAt: Date.now() + ttlMs } as CachedOptions);

  return { options, cached: false };
}
