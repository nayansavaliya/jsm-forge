/**
 * src/types/index.ts
 * Shared ambient types not generated from Zod schemas
 */

// Forge invocation context (simplified — real type is from @forge/api)
export interface ForgeContext {
  accountId: string;
  cloudId: string;
  environmentId: string;
  moduleKey: string;
}
