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

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ZodError } from 'zod';
import {
  GlobalConfigSchema,
  ApiSourceSchema,
  DepartmentSchema,
  RequestTypeSchema,
  QueueSchema,
  LoadedConfigSchema,
  type LoadedConfig,
  type ApiSource,
} from './schema';

// Root of the config directory, relative to this file
const CONFIG_ROOT = path.resolve(__dirname, '../../config');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readYaml<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(raw) as T;
}

function formatZodError(error: ZodError, file: string): string {
  const issues = error.issues
    .map((i) => `  • [${i.path.join('.')}] ${i.message}`)
    .join('\n');
  return `Config validation failed in ${file}:\n${issues}`;
}

function globYaml(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => path.join(dir, f));
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export function loadConfig(): LoadedConfig {
  // 1. Global config
  const globalFile = path.join(CONFIG_ROOT, 'global.yaml');
  const globalRaw = readYaml(globalFile);
  const globalResult = GlobalConfigSchema.safeParse(globalRaw);
  if (!globalResult.success) {
    throw new Error(formatZodError(globalResult.error, 'config/global.yaml'));
  }

  // 2. API sources
  const apiSourcesDir = path.join(CONFIG_ROOT, 'api-sources');
  const apiSources: ApiSource[] = [];
  for (const file of globYaml(apiSourcesDir)) {
    const raw = readYaml(file);
    const result = ApiSourceSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(formatZodError(result.error, path.relative(CONFIG_ROOT, file)));
    }
    apiSources.push(result.data);
  }

  // 3. Departments + their request types + queues
  const deptsDir = path.join(CONFIG_ROOT, 'departments');
  const departments: LoadedConfig['departments'] = [];

  if (fs.existsSync(deptsDir)) {
    for (const deptName of fs.readdirSync(deptsDir)) {
      const deptDir = path.join(deptsDir, deptName);
      if (!fs.statSync(deptDir).isDirectory()) continue;

      // department.yaml
      const deptFile = path.join(deptDir, 'department.yaml');
      const deptRaw = readYaml(deptFile);
      const deptResult = DepartmentSchema.safeParse(deptRaw);
      if (!deptResult.success) {
        throw new Error(formatZodError(deptResult.error, `departments/${deptName}/department.yaml`));
      }

      // request-types/
      const rtDir = path.join(deptDir, 'request-types');
      const requestTypes: LoadedConfig['departments'][0]['requestTypes'] = [];
      for (const file of globYaml(rtDir)) {
        const raw = readYaml(file);
        const result = RequestTypeSchema.safeParse(raw);
        if (!result.success) {
          throw new Error(
            formatZodError(result.error, `departments/${deptName}/request-types/${path.basename(file)}`),
          );
        }
        requestTypes.push(result.data);
      }

      // queues/
      const queuesDir = path.join(deptDir, 'queues');
      const queues: LoadedConfig['departments'][0]['queues'] = [];
      for (const file of globYaml(queuesDir)) {
        const raw = readYaml(file);
        const result = QueueSchema.safeParse(raw);
        if (!result.success) {
          throw new Error(
            formatZodError(result.error, `departments/${deptName}/queues/${path.basename(file)}`),
          );
        }
        queues.push(result.data);
      }

      departments.push({
        ...deptResult.data,
        requestTypes,
        queues,
      });
    }
  }

  // 4. Final assembled config — validate the whole shape
  const assembled = { global: globalResult.data, apiSources, departments };
  const finalResult = LoadedConfigSchema.safeParse(assembled);
  if (!finalResult.success) {
    throw new Error(formatZodError(finalResult.error, '<assembled config>'));
  }

  return finalResult.data;
}

/** Singleton — loaded once per Forge function cold start */
let _cachedConfig: LoadedConfig | null = null;
export function getConfig(): LoadedConfig {
  if (!_cachedConfig) {
    _cachedConfig = loadConfig();
  }
  return _cachedConfig;
}
