import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(__dirname, '../public/securityDatabase.json');

const URLHAUS_URL = 'https://urlhaus.abuse.ch/downloads/hostfile/';

async function fetchText(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (err) {
    console.error(`Failed to fetch text from ${url}:`, err.message);
    return null;
  }
}

async function buildSecurityDatabase() {
  console.log('Fetching security threat datasets...');
  const urlhausText = await fetchText(URLHAUS_URL);

  const securityMap = new Map();

  if (urlhausText) {
    console.log('Normalizing URLhaus Malware Hosts...');
    const lines = urlhausText.split('\n');
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      
      // URLhaus hostfile format: 127.0.0.1\t<domain>
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && parts[0] === '127.0.0.1') {
        const domain = parts[1];
        if (!securityMap.has(domain)) {
          securityMap.set(domain, {
            domain,
            source: 'URLhaus',
            threatType: 'Malware Distribution',
            riskLevel: 'Ultra High',
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  } else {
    console.error('Failed to fetch URLhaus data.');
  }

  const finalDatabase = {
    metadata: {
      version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
      generatedAt: new Date().toISOString(),
      sources: ['URLhaus (abuse.ch)'],
      threatCount: securityMap.size
    },
    threats: Object.fromEntries(securityMap)
  };

  console.log(`Writing compiled security database with ${finalDatabase.metadata.threatCount} entries...`);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(finalDatabase, null, 2));
  console.log(`Success! Security database saved to ${OUTPUT_PATH}`);
}

buildSecurityDatabase().catch(console.error);
