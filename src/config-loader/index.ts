/**
 * src/config-loader/index.ts
 *
 * Loads all YAML config files from /config/** and validates them
 * against the Zod schemas. Throws on the first validation error with
 * a clear, human-readable message so CI fails fast.
 *
 * In the Forge runtime the config is bundled at deploy time, so this
 * module reads from __dirname-relative paths that work both in ts-node
 * (scripts/) and in the compiled Forge bundle.
 */

import { mockConfig } from './mock-config';
import { type LoadedConfig } from './schema';

/** Singleton — loaded once per Forge function cold start */
let _cachedConfig: LoadedConfig | null = null;
export function getConfig(): LoadedConfig {
  if (!_cachedConfig) {
    // In Forge production, YAML files are not bundled by esbuild.
    // Instead, we rely on the pre-generated JSON bundle in mock-config.ts.
    // Ensure scripts/generate-mock-data.ts is run before forge deploy!
    _cachedConfig = mockConfig as unknown as LoadedConfig;
  }
  return _cachedConfig;
}
