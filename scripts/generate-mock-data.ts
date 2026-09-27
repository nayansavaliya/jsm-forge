import fs from 'fs';
import path from 'path';
import { getConfig } from '../src/config-loader';

async function main() {
  const config = getConfig();
  
  // We'll write the raw config out to the React app's src folder so the local 
  // mock can read it directly instead of using hardcoded mock values.
  const destPath = path.join(__dirname, '../static/customer-portal/src/mock-config.json');
  fs.writeFileSync(destPath, JSON.stringify(config, null, 2));
  
  console.log(`Successfully generated mock-config.json for local UI dev`);
}

main().catch(console.error);
