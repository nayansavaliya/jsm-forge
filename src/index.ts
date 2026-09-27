/**
 * src/index.ts — Forge app entry point
 * Exports handler for the main resolver function.
 */
export { handler } from './resolvers';
export { handler as syncEngine } from './engine/sync';
export { handler as issueEvents } from './triggers/issue-events';
