import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../public/trackerDatabase.json');
const outPath = path.join(__dirname, '../public/rules.json');

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const rules = [];
let id = 1;

const criticalServicesPath = path.join(__dirname, '../public/criticalServices.json');
let criticalServices = { criticalServices: {} };
if (fs.existsSync(criticalServicesPath)) {
  criticalServices = JSON.parse(fs.readFileSync(criticalServicesPath, 'utf8'));
}

for (const [domain, config] of Object.entries(criticalServices.criticalServices)) {
  rules.push({
    id: id++,
    priority: config.priority || 10,
    action: { type: 'allow' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'ping', 'websocket', 'image', 'stylesheet', 'font']
    }
  });
}

for (const [domain, data] of Object.entries(db.trackers)) {
  if (id > 28500) break; // Leave room for specific ad networks

  if (data.riskLevel === 'Essential' || data.riskLevel === 'Low') continue;

  rules.push({
    id: id++,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      domainType: 'thirdParty',
      resourceTypes: ['script', 'xmlhttprequest', 'ping', 'websocket', 'image', 'sub_frame']
    }
  });
}

// State of the Art Ad Network Blocking (Guaranteed 100% block for these)
const hardcoreAdNetworks = [
  'taboola.com', 'outbrain.com', 'mgid.com', 'revcontent.com', 'criteo.com',
  'rubiconproject.com', 'pubmatic.com', 'smartadserver.com', 'casalemedia.com',
  'advertising.com', 'amazon-adsystem.com', 'adnxs.com', 'adsrvr.org',
  'openx.net', 'indexexchange.com', 'bidswitch.net', 'adform.net',
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com'
];

for (const adDomain of hardcoreAdNetworks) {
  rules.push({
    id: id++,
    priority: 5, // Higher priority than standard trackers
    action: { type: 'block' },
    condition: {
      urlFilter: `||${adDomain}^`,
      resourceTypes: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'ping', 'websocket', 'image', 'stylesheet']
    }
  });
}

fs.writeFileSync(outPath, JSON.stringify(rules, null, 2));
console.log(`Wrote ${rules.length} DNR rules to rules.json`);
