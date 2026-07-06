import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_PATH = path.join(__dirname, '../public/trackerDatabase.json');

const DISCONNECT_URL = 'https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json';
const DDG_URL = 'https://staticcdn.duckduckgo.com/trackerblocking/v3/tds.json';
const EASYPRIVACY_URL = 'https://easylist.to/easylist/easyprivacy.txt';
const ADGUARD_URL = 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt'; // AdGuard DNS filter

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

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err.message);
    return null;
  }
}

// --------------------------------------------------------
// Schema defaults & Helpers
// --------------------------------------------------------
function createDefaultEntry(domain) {
  return {
    domain,
    company: 'Unknown Entity',
    parentCompany: 'Unknown Entity',
    country: 'Unknown',
    category: 'Unknown',
    subCategory: 'Unknown',
    purpose: 'Unknown',
    knownBehaviors: [],
    cookies: [],
    fingerprinting: false,
    riskLevel: 'Unknown',
    confidence: 0,
    sources: [],
    lastUpdated: new Date().toISOString()
  };
}


// Source tier weights based on methodology research:
// - DuckDuckGo Tracker Radar: crawl-verified, prevalence-scored (Tier-1)
// - Disconnect: formally peer-reviewed tracker definitions (Tier-1)
// - EasyPrivacy: community-maintained tracking-focused list (Tier-1)
// - AdGuard DNS Filter: good but more aggressive (Tier-2)
const SOURCE_TIER_WEIGHTS = {
  'DuckDuckGo Tracker Radar': 0.50,
  'Disconnect':                0.50,
  'EasyPrivacy':               0.45,
  'AdGuard DNS Filter':        0.30,
};

function calculateConfidence(sources) {
  // Tiered weighted confidence: matches urlIntelligenceEngine.js SOURCE_TIER_WEIGHTS
  // This ensures DB confidence is consistent with runtime classification.
  let score = 0;
  for (const source of sources) {
    score += SOURCE_TIER_WEIGHTS[source] || 0.15;
  }
  // Multi-source consensus bonus: 2+ Tier-1 sources = very high confidence
  const tier1Count = sources.filter(s => SOURCE_TIER_WEIGHTS[s] >= 0.45).length;
  if (tier1Count >= 2) score = Math.min(score + 0.10, 1.0);
  return Number(Math.min(score, 1.0).toFixed(2));
}

function calculateRiskLevel(entry) {
  // Heuristic risk based on category and behaviors.
  // IMPORTANT: Essential must be checked before High to prevent blocking auth/payment.
  const lowerCat = entry.category.toLowerCase();
  const lowerBehaviors = entry.knownBehaviors.map(b => b.toLowerCase());

  // ── Essential: user-critical services that break sites if blocked ──
  if (
    lowerCat.includes('payment') ||
    lowerCat.includes('sso') ||
    lowerCat.includes('auth') ||
    lowerCat.includes('captcha') ||
    lowerCat.includes('federated login') ||
    lowerCat.includes('bot detection') ||
    lowerCat.includes('non-tracking cdn') ||
    lowerCat.includes('cdn') ||
    lowerCat.includes('fonts') ||
    lowerCat.includes('embedded media')
  ) {
    return 'Essential';
  }

  // ── High: active fingerprinting, session replay, invasive tracking ──
  if (
    entry.fingerprinting === true ||
    lowerCat.includes('fingerprinting') ||
    lowerBehaviors.includes('fingerprinting') ||
    lowerBehaviors.includes('session replay') ||
    lowerCat.includes('session replay')
  ) {
    return 'High';
  }

  // ── High: confirmed advertising / ad-motivated tracking ──
  if (
    lowerCat.includes('advertising') ||
    lowerCat.includes('ad targeting') ||
    lowerCat.includes('ad motivated tracking')
  ) {
    return 'High';
  }

  // ── Medium: analytics, audience measurement, social tracking ──
  if (
    lowerBehaviors.includes('advertising') ||
    lowerCat.includes('analytics') ||
    lowerCat.includes('audience measurement') ||
    lowerBehaviors.includes('analytics') ||
    lowerCat.includes('tracking') ||
    lowerCat.includes('social')
  ) {
    return 'Medium';
  }

  // ── Low: content delivery, assets, video ──
  if (
    lowerCat.includes('assets') ||
    lowerCat.includes('video') ||
    lowerCat.includes('content delivery') ||
    lowerCat.includes('content')
  ) {
    return 'Low';
  }

  return 'Review'; // Default fallback — needs human review
}


// --------------------------------------------------------
// Parsers
// --------------------------------------------------------

function normalizeDDG(data, db) {
  if (!data || !data.trackers) return;

  for (const [domain, meta] of Object.entries(data.trackers)) {
    const company = meta.owner && meta.owner.name ? meta.owner.name : 'Unknown Entity';
    const category = meta.categories && meta.categories.length > 0 ? meta.categories[0] : 'Advertising / Tracking';
    
    if (!db.has(domain)) {
      db.set(domain, createDefaultEntry(domain));
    }
    
    const entry = db.get(domain);
    entry.company = company !== 'Unknown Entity' ? company : entry.company;
    entry.parentCompany = company !== 'Unknown Entity' ? company : entry.parentCompany;
    entry.category = category !== 'Unknown' ? category : entry.category;
    entry.purpose = category;
    
    // Add DDG-specific fingerprinting data if available
    if (meta.fingerprinting !== undefined) {
      entry.fingerprinting = meta.fingerprinting > 1 ? true : false;
    }
    
    const behaviors = meta.categories || [];
    entry.knownBehaviors = [...new Set([...entry.knownBehaviors, ...behaviors])];
    
    if (!entry.sources.includes('DuckDuckGo Tracker Radar')) {
      entry.sources.push('DuckDuckGo Tracker Radar');
    }
  }
}

function normalizeDisconnect(data, db) {
  if (!data || !data.categories) return;

  for (const [category, entitiesArray] of Object.entries(data.categories)) {
    for (const entityObj of entitiesArray) {
      for (const [companyName, companyData] of Object.entries(entityObj)) {
        for (const [_companyUrl, domains] of Object.entries(companyData)) {
          for (const domain of domains) {
            if (!db.has(domain)) {
              db.set(domain, createDefaultEntry(domain));
            }
            const entry = db.get(domain);
            
            entry.company = entry.company === 'Unknown Entity' ? companyName : entry.company;
            entry.parentCompany = entry.parentCompany === 'Unknown Entity' ? companyName : entry.parentCompany;
            entry.category = entry.category === 'Unknown' ? category : entry.category;
            
            if (category === 'Advertising') entry.purpose = 'Ad Targeting';
            else if (category === 'Analytics') entry.purpose = 'Analytics';
            else entry.purpose = entry.purpose === 'Unknown' ? 'Tracking' : entry.purpose;

            entry.knownBehaviors = [...new Set([...entry.knownBehaviors, category])];

            if (!entry.sources.includes('Disconnect')) {
              entry.sources.push('Disconnect');
            }
          }
        }
      }
    }
  }
}

function normalizeAdblockFilter(text, db, sourceName) {
  if (!text) return;
  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim();
    // Look for strict domain blocks like ||tracker.com^
    if (line.startsWith('||') && line.endsWith('^')) {
      const domain = line.slice(2, -1);
      // Validate simple domain (very basic regex)
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        if (!db.has(domain)) {
          db.set(domain, createDefaultEntry(domain));
        }
        const entry = db.get(domain);
        
        if (entry.category === 'Unknown') {
          entry.category = 'Advertising / Tracking';
          entry.purpose = 'Blocklist Match';
        }
        
        if (!entry.sources.includes(sourceName)) {
          entry.sources.push(sourceName);
        }
      }
    }
  }
}

// --------------------------------------------------------
// Main Builder
// --------------------------------------------------------

async function buildDatabase() {
  console.log('Fetching tracker datasets...');
  const [ddgData, disconnectData, easyPrivacyText, adguardText] = await Promise.all([
    fetchJson(DDG_URL),
    fetchJson(DISCONNECT_URL),
    fetchText(EASYPRIVACY_URL),
    fetchText(ADGUARD_URL)
  ]);

  const trackerMap = new Map();

  console.log('Normalizing DuckDuckGo...');
  normalizeDDG(ddgData, trackerMap);

  console.log('Normalizing Disconnect...');
  normalizeDisconnect(disconnectData, trackerMap);
  
  console.log('Normalizing EasyPrivacy...');
  normalizeAdblockFilter(easyPrivacyText, trackerMap, 'EasyPrivacy');

  console.log('Normalizing AdGuard DNS Filter...');
  normalizeAdblockFilter(adguardText, trackerMap, 'AdGuard DNS Filter');

  // Curate database: Drop domains that ONLY appear in AdGuard (low-quality one-offs)
  console.log('Curating database (dropping one-off AdGuard domains)...');
  for (const [domain, entry] of trackerMap.entries()) {
    if (entry.sources.length === 1 && entry.sources[0] === 'AdGuard DNS Filter') {
      trackerMap.delete(domain);
    }
  }

  // Second pass: Calculate heuristics
  console.log('Calculating Risk Levels and Confidence...');
  for (const [_domain, entry] of trackerMap.entries()) {
    entry.confidence = calculateConfidence(entry.sources);
    entry.riskLevel = calculateRiskLevel(entry);
  }

  // Fallback if APIs fail
  if (trackerMap.size === 0) {
    console.error('Failed to fetch from sources. Creating fallback mock data.');
    trackerMap.set('google-analytics.com', {
        domain: 'google-analytics.com',
        company: 'Google',
        parentCompany: 'Alphabet Inc.',
        category: 'Analytics',
        subCategory: 'Audience Measurement',
        purpose: 'Analytics',
        country: 'USA',
        knownBehaviors: ['Audience measurement', 'Analytics'],
        cookies: [],
        fingerprinting: false,
        riskLevel: 'Medium',
        confidence: 0.99,
        sources: ['Fallback'],
        lastUpdated: new Date().toISOString()
    });
  }

  // Compile final DB object with Metadata
  const finalDatabase = {
    metadata: {
      version: new Date().toISOString().split('T')[0].replace(/-/g, '.'), // e.g., 2026.07.05
      generatedAt: new Date().toISOString(),
      sources: ['DuckDuckGo Tracker Radar', 'Disconnect', 'EasyPrivacy', 'AdGuard DNS Filter'],
      trackerCount: trackerMap.size
    },
    trackers: Object.fromEntries(trackerMap)
  };

  console.log(`Writing compiled database with ${finalDatabase.metadata.trackerCount} entries...`);
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(finalDatabase, null, 2));
  console.log(`Success! Database saved to ${OUTPUT_PATH}`);
}

buildDatabase().catch(console.error);

// Updated: EasyPrivacy and AdGuard DNS added as additional sources - 2026-07-14T23:07:26Z
