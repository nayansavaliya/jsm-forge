/**
 * src/types/forge.d.ts
 *
 * Ambient type declarations for Forge runtime globals.
 *
 * `storage` and `secrets` are injected by the Forge platform at runtime
 * and are not importable from @forge/api in v8. These declarations let
 * TypeScript understand their shapes without requiring a real import.
 *
 * At runtime inside a Forge function, these globals ARE available.
 * Outside Forge (e.g. local scripts), they will be undefined — which
 * is why scripts/validate-config.ts does not call any storage APIs.
 */

interface ForgeStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface ForgeSecrets {
  get(key: string): Promise<string | undefined>;
}

declare const storage: ForgeStorage;
declare const secrets: ForgeSecrets;
