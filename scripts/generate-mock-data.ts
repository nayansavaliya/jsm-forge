import fs from 'fs';
import path from 'path';
import { loadConfig } from '../src/config-loader/loader';

async function main() {
  const config = loadConfig();
  
  // We'll write the raw config out to the React app's src folder so the local 
  // mock can read it directly instead of using hardcoded mock values.
  const destPath = path.join(__dirname, '../static/customer-portal/src/mock-config.json');
  fs.writeFileSync(destPath, JSON.stringify(config, null, 2));
  
  const backendDestPath = path.join(__dirname, '../src/config-loader/mock-config.ts');
  const tsContent = `// AUTO-GENERATED FILE. DO NOT EDIT.\nexport const mockConfig = ${JSON.stringify(config, null, 2)};\n`;
  fs.writeFileSync(backendDestPath, tsContent);
  
  console.log(`Successfully generated mock-config files for local UI dev and backend`);
}

main().catch(console.error);
