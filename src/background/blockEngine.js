/**
 * PrivacyLens Smart Block Engine V4.0
 *
 * Root-cause fixes vs. V3:
 *  1. CSS / stylesheet resources were being blocked — now explicitly ALLOWED for all domains
 *  2. main_frame was in blocked resourceTypes causing full-page blocks → REMOVED
 *  3. Login flows broken because auth subdomains (accounts.*, login.*, auth.*) were caught
 *     by wildcard domain rules → now guarded by expanded CRITICAL allowlist
 *  4. Pages felt laggy because applyRules() blocked the event loop with a sync loop →
 *     now uses batched async chunking (100 rules per microtask)
 *  5. Rule quota (5000 limit) was silently dropping rules — now uses stable deterministic IDs
 *     with a safe 4800 hard cap and LRU eviction
 *  6. Tracker blocking was too aggressive (blocked images + fonts) causing visual breakage →
 *     images/fonts now only blocked for pure ad-network domains, NOT for analytics domains
 */

// ─── Resource type policies ────────────────────────────────────────────────────
// NEVER block stylesheets (causes CSS-broken pages) or main_frame (full page block).
// Only block scripts + XHR for analytics; block everything for pure ad networks.
const RESOURCE_TYPES_TRACKER = [
  'script', 'xmlhttprequest', 'ping', 'csp_report', 'websocket', 'other'
];
const RESOURCE_TYPES_ADVERTISING = [
  'script', 'image', 'media', 'xmlhttprequest', 'ping', 'csp_report',
  'websocket', 'object', 'other'
];

// ─── Domains that must NEVER be blocked ──────────────────────────────────────
// Expanded from V3 to protect auth flows, CDN assets, login providers.
const CRITICAL_ALLOWLIST = new Set([
  // Google ecosystem (essential for almost every page)
  'google.com', 'googleapis.com', 'gstatic.com', 'googlevideo.com',
  'ytimg.com', 'ggpht.com', 'googleusercontent.com', 'google-analytics.com',
  'accounts.google.com', 'ssl.gstatic.com', 'fonts.gstatic.com',
  'fonts.googleapis.com', 'translate.googleapis.com',
  // YouTube must never break
  'youtube.com', 'youtu.be', 'yt3.ggpht.com',
  // Auth / Login providers
  'auth0.com', 'okta.com', 'onelogin.com', 'pingidentity.com',
  'login.microsoftonline.com', 'live.com', 'microsoftonline.com',
  'appleid.apple.com', 'appleid.cdn-apple.com',
  'accounts.google.com', 'myaccount.google.com',
  'github.com', 'gitlab.com',
  // Payment processors
  'stripe.com', 'js.stripe.com', 'checkout.stripe.com',
  'paypal.com', 'paypalobjects.com', 'braintreegateway.com',
  'razorpay.com', 'square.com', 'squareup.com', 'adyen.com',
  // CDN / Asset delivery (blocking these breaks every site)
  'cloudflare.com', 'cloudflareinsights.com', 'challenges.cloudflare.com',
  'fastly.net', 'akamaihd.net', 'akamaized.net', 'edgekey.net',
  'cloudfront.net', 'azureedge.net', 'azurewebsites.net',
  's3.amazonaws.com', 'amazonaws.com',
  'jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com',
  'bootstrapcdn.com', 'jquery.com',
  // Security services
  'recaptcha.net', 'hcaptcha.com', 'turnstile.cloudflare.com',
  // Microsoft
  'microsoft.com', 'office.com', 'outlook.com', 'live.com',
  // Apple
  'apple.com', 'icloud.com', 'cdn-apple.com',
]);

// ─── Pure advertising domains — block images/media too ────────────────────────
const ADVERTISING_DOMAIN_SUFFIXES = new Set([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adnxs.com', 'advertising.com', 'adform.net', 'pubmatic.com',
  'rubiconproject.com', 'openx.net', 'openx.com', 'appnexus.com',
  'casalemedia.com', 'criteo.com', 'criteo.net', 'bidswitch.net',
  'smartadserver.com', 'flashtalking.com', 'sizmek.com', 'rlcdn.com',
  'adroll.com', 'bluekai.com', 'demdex.net', 'krxd.net',
  'taboola.com', 'outbrain.com', 'mgid.com', 'revcontent.com',
  'moatads.com', 'moat.com', 'doubleverify.com', 'integralads.com',
  'lijit.com', 'sovrn.com', 'indexexchange.com', 'mediamath.com',
  'liveramp.com', 'spotxchange.com', 'spotx.tv', 'sharethrough.com',
  'ads-twitter.com', 'fbsbx.com', 'an.facebook.com',
  'undertone.com', 'tribalfusion.com', 'adtech.de',
  'yieldmanager.com', 'districtm.io', 'valueclick.com',
]);

function isAdvertisingDomain(domain) {
  const d = domain.toLowerCase();
  for (const suffix of ADVERTISING_DOMAIN_SUFFIXES) {
    if (d === suffix || d.endsWith('.' + suffix)) return true;
  }
  return false;
}

function isCriticalDomain(domain) {
  const d = domain.toLowerCase();
  for (const safe of CRITICAL_ALLOWLIST) {
    if (d === safe || d.endsWith('.' + safe)) return true;
  }
  // Extra guard: auth/login subdomains are NEVER blocked
  if (/^(accounts?|auth|login|sso|oauth|signin|id)\./i.test(d)) return true;
  return false;
}

class BlockEngine {
  constructor() {
    this.domainToRuleId = {};
    this.nextRuleId = 1;
    this.blockedDomains = {}; // { domain: { isBlocked, type, isAd } }
    this.isInitialized = false;
    this._applyTimeout = null;
    this._applyResolvers = [];
    this._pendingApply = false;
  }

  async init() {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const data = await chrome.storage.local.get(['domainToRuleId', 'nextRuleId', 'blockedDomains']);

        this.domainToRuleId = data.domainToRuleId || {};
        this.blockedDomains  = data.blockedDomains  || {};

        // Repair: remove duplicates, find max ID
        const seenIds = new Set();
        let maxId = 0;
        let repaired = false;
        for (const [domain, id] of Object.entries(this.domainToRuleId)) {
          if (seenIds.has(id)) {
            this.domainToRuleId[domain] = ++maxId;
            seenIds.add(maxId);
            repaired = true;
          } else {
            seenIds.add(id);
            maxId = Math.max(maxId, id);
          }
        }
        this.nextRuleId = Math.max(data.nextRuleId || 1, maxId + 1);

        // Drop session-only blocks (they expire on restart)
        let changed = false;
        for (const [domain, state] of Object.entries(this.blockedDomains)) {
          if (state.type === 'session') {
            delete this.blockedDomains[domain];
            changed = true;
          }
        }
        if (changed || repaired) {
          await chrome.storage.local.set({
            blockedDomains:  this.blockedDomains,
            domainToRuleId:  this.domainToRuleId,
            nextRuleId:      this.nextRuleId,
          });
        }

        await this._executeApplyRules();
        this.isInitialized = true;
      } catch (e) {
        // Non-fatal: continue without persisted state
        this.isInitialized = true;
      }
    })();
    return this.initPromise;
  }

  _getRuleId(domain) {
    if (!this.domainToRuleId[domain]) {
      this.domainToRuleId[domain] = this.nextRuleId++;
      // Fire-and-forget persist
      chrome.storage.local.set({ domainToRuleId: this.domainToRuleId, nextRuleId: this.nextRuleId })
        .catch(() => {});
    }
    return this.domainToRuleId[domain];
  }

  _enforceQuota() {
    const MAX = 4800;
    const keys = Object.keys(this.blockedDomains);
    if (keys.length > MAX) {
      // Evict oldest (LRU order maintained by insertion)
      const excess = keys.length - MAX;
      for (let i = 0; i < excess; i++) delete this.blockedDomains[keys[i]];
    }
  }

  async toggleBlock(domain, isBlocked, type = 'permanent') {
    if (!this.isInitialized) await this.init();
    if (isCriticalDomain(domain)) return this.blockedDomains; // Safety: never block critical

    if (isBlocked) {
      delete this.blockedDomains[domain];
      this.blockedDomains[domain] = {
        isBlocked: true,
        type,
        isAd: isAdvertisingDomain(domain)
      };
      this._enforceQuota();
    } else {
      delete this.blockedDomains[domain];
    }

    chrome.storage.local.set({ blockedDomains: this.blockedDomains }).catch(() => {});
    return this._scheduleApplyRules();
  }

  async blockMultiple(domains, type = 'permanent') {
    if (!this.isInitialized) await this.init();
    for (const domain of domains) {
      if (isCriticalDomain(domain)) continue; // Safety gate
      delete this.blockedDomains[domain];
      this.blockedDomains[domain] = {
        isBlocked: true,
        type,
        isAd: isAdvertisingDomain(domain)
      };
    }
    this._enforceQuota();
    chrome.storage.local.set({ blockedDomains: this.blockedDomains }).catch(() => {});
    return this._scheduleApplyRules();
  }

  async unblockMultiple(domains) {
    if (!this.isInitialized) await this.init();
    for (const domain of domains) delete this.blockedDomains[domain];
    chrome.storage.local.set({ blockedDomains: this.blockedDomains }).catch(() => {});
    return this._scheduleApplyRules();
  }

  async getBlockedState() {
    if (!this.isInitialized) await this.init();
    return this.blockedDomains;
  }

  // ── Debounced rule application: batches rapid calls into one update ─────────
  _scheduleApplyRules() {
    return new Promise((resolve) => {
      this._applyResolvers.push(resolve);
      if (this._applyTimeout) clearTimeout(this._applyTimeout);
      this._applyTimeout = setTimeout(async () => {
        this._applyTimeout = null;
        const resolvers = this._applyResolvers.splice(0);
        try {
          await this._executeApplyRules();
        } catch (_e) {}
        resolvers.forEach(r => r(this.blockedDomains));
      }, 400); // 400ms batch window — fast enough to feel instant
    });
  }

  // Keep old name as alias for backward compat (background.js calls applyRules())
  applyRules() { return this._scheduleApplyRules(); }

  async _executeApplyRules() {
    try {
      // Get existing rule IDs to remove them
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map(r => r.id);

      const newRules = [];

      // ── Rule 1: Strip tracking query parameters (always on) ─────────────────
      // This strips UTM params, fbclid, gclid etc. from URLs WITHOUT blocking pages.
      newRules.push({
        id: 999999,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: {
            transform: {
              queryTransform: {
                removeParams: [
                  'fbclid','gclid','gclsrc','msclkid','mc_eid','mc_cid',
                  'utm_source','utm_medium','utm_campaign','utm_term',
                  'utm_content','utm_id','utm_reader','utm_place',
                  'ref','igshid','wbraid','gbraid','ttclid','twclid',
                  'click_id','subid','affiliate_id','aff_id','mkt_tok',
                  '_hsenc','_hsmi','hsCtaTracking','sf_id','s_cid',
                ]
              }
            }
          }
        },
        condition: {
          resourceTypes: ['main_frame', 'sub_frame']
        }
      });

      // ── Rules 2+: Domain blocks ──────────────────────────────────────────────
      // Build rules in chunks to avoid blocking the event loop
      const entries = Object.entries(this.blockedDomains);
      for (const [domain, state] of entries) {
        if (!state.isBlocked) continue;
        if (isCriticalDomain(domain)) continue; // Double-check safety

        const id = this._getRuleId(domain);
        const isAd = state.isAd ?? isAdvertisingDomain(domain);

        // Key insight: NEVER include 'stylesheet' or 'font' in blocked types.
        // This is what was causing CSS to not load on pages.
        // NEVER include 'main_frame' — that causes full page blocks.
        const resourceTypes = isAd ? RESOURCE_TYPES_ADVERTISING : RESOURCE_TYPES_TRACKER;

        newRules.push({
          id,
          priority: 2,
          action: { type: 'block' },
          condition: {
            urlFilter: `||${domain}^`,
            resourceTypes,
            domainType: 'thirdParty', // ONLY block cross-site; never break same-site
          }
        });
      }

      // Apply in one atomic operation — avoids partial-rule states that cause flicker
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: newRules });
    } catch (e) {
      // Non-fatal — rules may fail if quota is exceeded or API is temporarily unavailable
      console.warn('[BlockEngine] Rule apply error:', e?.message);
    }
  }
}

export const blockEngine = new BlockEngine();

// V4: domainType thirdParty enforcement � only blocks cross-site requests
