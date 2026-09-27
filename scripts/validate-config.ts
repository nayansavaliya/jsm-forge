#!/usr/bin/env ts-node
/**
 * scripts/validate-config.ts
 *
 * Validates every config YAML file against the Zod schemas.
 * Run locally: npx ts-node scripts/validate-config.ts
 * Run in CI:   npx ts-node scripts/validate-config.ts
 *
 * Exits with code 0 on success, 1 on any validation error.
 * Prints a clear, human-readable report of all issues found.
 */

import * as path from 'path';
import { loadConfig } from '../src/config-loader';

const CONFIG_ROOT = path.resolve(__dirname, '../config');

console.log('\n📋 JSM Forge — Config Validation\n' + '─'.repeat(50));

// Check config directory exists
import * as fs from 'fs';
if (!fs.existsSync(CONFIG_ROOT)) {
  console.error(`\n❌ Config directory not found: ${CONFIG_ROOT}`);
  console.error('   Create it with: mkdir config && mkdir config/departments config/api-sources');
  process.exit(1);
}

try {
  const config = loadConfig();

  console.log(`\n✅ global.yaml — OK`);
  console.log(`✅ api-sources/ — ${config.apiSources.length} source(s) valid`);

  for (const dept of config.departments) {
    console.log(`\n✅ departments/${dept.id}/`);
    console.log(`   ├── department.yaml — OK (${dept.name}, project: ${dept.jsmProjectKey})`);
    console.log(`   ├── request-types/  — ${dept.requestTypes.length} type(s)`);
    for (const rt of dept.requestTypes) {
      const status = rt.jsmRequestTypeId ? `linked: ${rt.jsmRequestTypeId}` : '⚠ new — will create on sync';
      console.log(`   │   ├── ${rt.id} (${status})`);
      // Check that dynamic fields reference valid apiSourceIds
      for (const field of rt.form.fields) {
        if (field.apiSourceId) {
          const sourceExists = config.apiSources.some((s) => s.id === field.apiSourceId);
          if (!sourceExists) {
            throw new Error(
              `Field "${field.id}" in request type "${rt.id}" references unknown apiSourceId: "${field.apiSourceId}". ` +
              `Available: ${config.apiSources.map((s) => s.id).join(', ')}`,
            );
          }
        }
        // Check cascading field references
        if (field.dependsOn) {
          const depField = rt.form.fields.find((f) => f.id === field.dependsOn);
          if (!depField) {
            throw new Error(
              `Cascading field "${field.id}" in "${rt.id}" depends on unknown field "${field.dependsOn}"`,
            );
          }
        }
      }
    }
    console.log(`   └── queues/         — ${dept.queues.length} queue(s)`);
    for (const queue of dept.queues) {
      console.log(`       ├── ${queue.id} — "${queue.name}"`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`✅ All config files are valid!`);
  console.log(`   Departments : ${config.departments.length}`);
  console.log(`   API Sources : ${config.apiSources.length}`);
  console.log(`   Request Types: ${config.departments.reduce((acc, d) => acc + d.requestTypes.length, 0)}`);
  console.log(`   Queues       : ${config.departments.reduce((acc, d) => acc + d.queues.length, 0)}`);
  console.log();

  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('\n' + '─'.repeat(50));
  console.error('❌ Validation FAILED\n');
  console.error(message);
  console.error('\n' + '─'.repeat(50) + '\n');
  process.exit(1);
}
