/**
 * src/services/token-cache.ts
 *
 * Centralized auth token management for all three auth strategies:
 *   - login-bearer  (POST username+password → receive token)
 *   - api-key       (static key — no token lifecycle)
 *   - oauth2-client-credentials (standard OAuth2 M2M)
 *
 * Tokens are cached in Forge KV Storage, keyed by apiSourceId.
 * A 30-second safety buffer ensures we re-fetch before actual expiry.
 */

import { fetch as forgeFetch, storage } from '@forge/api';
import type { ApiSource } from '../config-loader/schema';

interface CachedToken {
  token: string;
  expiresAt: number; // unix ms — Infinity-equivalent stored as 9999999999999
}

const TOKEN_BUFFER_MS = 30_000; // 30 seconds before expiry, refresh proactively
const DEFAULT_TTL_MS = 3_600_000; // 1 hour fallback

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the correct auth header value for the given API source.
 * For api-key sources this is the raw key (caller decides placement).
 * For token-based sources this is "Bearer <token>".
 */
export async function getAuthValue(source: ApiSource): Promise<string> {
  switch (source.authType) {
    case 'api-key': {
      // Static key — fetch from environment variables, no caching
      return process.env[source.auth.credentialSecretKey] as string;
    }
    case 'login-bearer':
    case 'oauth2-client-credentials': {
      const cached = await storage.get(`token::${source.id}`) as CachedToken | undefined;
      if (cached && cached.expiresAt - Date.now() > TOKEN_BUFFER_MS) {
        return buildAuthHeader(source.auth.tokenPrefix ?? 'Bearer', cached.token);
      }
      return await fetchFreshToken(source);
    }
  }
}

// ─── Token fetching ───────────────────────────────────────────────────────────

async function fetchFreshToken(
  source: ApiSource & { authType: 'login-bearer' | 'oauth2-client-credentials' },
): Promise<string> {
  switch (source.authType) {
    case 'login-bearer':
      return fetchLoginBearerToken(source);
    case 'oauth2-client-credentials':
      return fetchOAuth2Token(source);
  }
}

async function fetchLoginBearerToken(
  source: ApiSource & { authType: 'login-bearer' },
): Promise<string> {
  const username = process.env[source.auth.usernameSecretKey] as string;
  const password = process.env[source.auth.passwordSecretKey] as string;

  const res = await forgeFetch(source.auth.loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`[token-cache] Login failed for ${source.id}: HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const token = extractPath(data, source.auth.tokenPath ?? 'access_token');

  const ttlMs = source.auth.expiresInPath
    ? Number(extractPath(data, source.auth.expiresInPath)) * 1000
    : DEFAULT_TTL_MS;

  await storeToken(source.id, token, ttlMs);
  return buildAuthHeader(source.auth.tokenPrefix ?? 'Bearer', token);
}

async function fetchOAuth2Token(
  source: ApiSource & { authType: 'oauth2-client-credentials' },
): Promise<string> {
  const clientId = process.env[source.auth.clientIdSecretKey] as string;
  const clientSecret = process.env[source.auth.clientSecretSecretKey] as string;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (source.auth.scope) params.set('scope', source.auth.scope);
  if (source.auth.audience) params.set('audience', source.auth.audience);

  const res = await forgeFetch(source.auth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    throw new Error(`[token-cache] OAuth2 token request failed for ${source.id}: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (data.expires_in ?? 3600) * 1000;

  await storeToken(source.id, data.access_token, ttlMs);
  return buildAuthHeader(source.auth.tokenPrefix ?? 'Bearer', data.access_token);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function storeToken(sourceId: string, token: string, ttlMs: number): Promise<void> {
  await storage.set(`token::${sourceId}`, {
    token,
    expiresAt: Date.now() + ttlMs,
  } as CachedToken);
}

function buildAuthHeader(prefix: string, token: string): string {
  return `${prefix} ${token}`;
}

/** Resolve a dot-path like "data.accessToken" into a nested value */
function extractPath(obj: Record<string, unknown>, dotPath: string): string {
  const value = dotPath
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], obj);

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`[token-cache] Could not extract token at path "${dotPath}"`);
  }
  return String(value);
}
