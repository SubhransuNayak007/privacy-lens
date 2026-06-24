import { TrackerClassifier, resetTabRateLimit } from "./trackerClassifier.js";
import { blockEngine } from "./blockEngine.js";
import { isEssentialService, isStrictThirdParty, computeURLTrackerScore, isPixelBeacon } from './urlIntelligenceEngine.js';


/**
 * PrivacyLens Telemetry Engine
 * Hardened for production: all chrome API calls wrapped in try/catch,
 * guard against closed tabs, closed windows, and missing APIs.
 */

// ── Safe chrome API wrappers ─────────────────────────────────────────────────

function safeTabGet(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(tab || null);
      });
    } catch (_e) { resolve(null); }
  });
}

function safeQueryActiveTabs() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) { resolve([]); return; }
        resolve(tabs || []);
      });
    } catch (_e) { resolve([]); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

class TelemetryEngine {
  constructor() {
    this.tabTelemetry = new Map();
    this.activeRequests = new Map();

    // ── UPGRADE 8a: LRU Cache for domain lookups ──
    // Avoids re-parsing eTLD+1 for the same domain (saves ~80% CPU on domain parsing)
    this._etldCache = new Map();  // domain string → eTLD+1
    this._etldCacheMax = 500;     // Keep max 500 entries (covers any normal browsing session)

    this.trackerData = null;
    this.securityData = null;
    this.isInitialized = false;

    // ── Active blocking mode (synced with chrome.storage) ──
    this.blockingMode = 'balanced';
    chrome.storage.local.get(['blockingMode'], (res) => {
      if (res.blockingMode) this.blockingMode = res.blockingMode.toLowerCase();
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.blockingMode) {
        this.blockingMode = (changes.blockingMode.newValue || 'balanced').toLowerCase();
      }
    });

    this.isPaused = false; // For Temporary Override feature

    this.initListeners();
    this.initDatabases();
  }

  // ── Cached eTLD+1 lookup ──────────────────────────────────────────────────
  _getCachedFirstParty(targetUrlOrDomain, tabId) {
    const cacheKey = `${tabId}::${targetUrlOrDomain}`;
    if (this._etldCache.has(cacheKey)) {
      // Re-insert to move to the end (refresh LRU status)
      const val = this._etldCache.get(cacheKey);
      this._etldCache.delete(cacheKey);
      this._etldCache.set(cacheKey, val);
      return val;
    }
    
    const result = this.isFirstParty(targetUrlOrDomain, tabId);
    
    // Evict oldest entry if we're at the limit
    if (this._etldCache.size >= this._etldCacheMax) {
      const oldestKey = this._etldCache.keys().next().value;
      this._etldCache.delete(oldestKey);
    }
    
    this._etldCache.set(cacheKey, result);
    return result;
  }

  async initDatabases() {
    try {
      const trackerRes = await fetch(chrome.runtime.getURL("trackerDatabase.json"));
      this.trackerData = await trackerRes.json();

      const securityRes = await fetch(chrome.runtime.getURL("securityDatabase.json"));
      this.securityData = await securityRes.json();

      this.isInitialized = true;
    } catch (_e) {
      // Databases failed to load — extension still functions, just without tracker data
    }
  }

  createEmptyTelemetry(url, title = "") {
    return {
      page: { url, title, lifecycle: [] },
      network: [],
      detectedTrackersMap: new Map(),
      detectedTrackers: [],
      cookies: [],
      cookieTimeline: [],
      storage: {},
      permissions: {},
      security: {
        isHttps: url.startsWith("https://"),
        mixedContent: false,
        certificateValid: true,
        knownMalware: false,
        downloadedExecutable: false,
        multipleRedirects: false,
      },
      metadata: { tabOpenTime: Date.now() },
      // ── Behavioral Fingerprint Detection ──────────────────────────
      fpDetection: {
        signals: [],            // all raw signals
        totalScore: 0,
        techniques: [],         // unique technique names detected
        confidence: 'CLEAN',    // CLEAN | SUSPICIOUS | LIKELY | CONFIRMED
        summary: null,
        lastUpdated: null,
        // Hybrid classification:
        listHits: [],           // callerDomains already in our tracker database
        zeroDayDiscoveries: [], // callerDomains NOT in database — caught only behaviorally
        // FP-Inspector (CCS 2021) per-script API group profiles:
        scriptProfiles: [],           // [{ domain, apiGroups, groupCount, isConfirmed }]
        confirmedFingerprinters: [],  // domains confirmed by ≥4 API group rule
      },
      // ── O(1) Incremental Privacy Scoring ───────────────────────
      liveScore: {
        privacyScore: 100,
        trackerCount: 0,
        trackersBlocked: 0,
        cookieCount: 0,
        fingerprintScore: 0,
        companies: new Set(),
        privacyGrade: 'A+',
        trustScore: { privacy: 100, security: 100, transparency: 100 }
      },
      // ── UPGRADE 8b: Capped network request buffer ──
      // Rolling cap of 500 prevents RAM growth on heavy pages (news/social).
      // Old requests are dropped when the buffer is full.
      _networkMaxSize: 500,
    };
  }

  // ── Fast domain lookup: is this domain in our tracker database? ──
  // Delegates to TrackerClassifier so there's a single source of truth.
  isDomainKnown(domain) {
    if (!domain || !this.isInitialized || !this.trackerData) return false;
    return TrackerClassifier.identifyTracker(domain, this.trackerData) !== null;
  }

  // ── Record a single fingerprint signal — hybrid classification ──
  recordFingerprintSignal(tabId, payload) {
    try {
      const telemetry = this.tabTelemetry.get(tabId);
      if (!telemetry) return;

      const fp = telemetry.fpDetection;
      fp.signals.push(payload);
      if (fp.signals.length > 50) fp.signals.shift();

      fp.totalScore = Math.min(100, payload.totalScore || fp.totalScore);

      const techSet = new Set(fp.techniques);
      (payload.techniques || []).forEach(t => techSet.add(t));
      fp.techniques = Array.from(techSet);

      fp.confidence =
        fp.totalScore >= 90 ? 'CONFIRMED' :
        fp.totalScore >= 60 ? 'LIKELY'    :
        fp.totalScore >= 30 ? 'SUSPICIOUS' : 'CLEAN';

      // ── Hybrid classification ──────────────────────────────────────
      const callerDomain = payload.callerDomain || '';
      if (callerDomain) {
        const isKnown = this.isDomainKnown(callerDomain);
        const entry = {
          domain: callerDomain,
          url: payload.callerUrl || '',
          type: payload.type,
          score: payload.score,
          timestamp: payload.timestamp,
          detectionSource: isKnown ? 'list' : 'behavioral',
        };

        if (isKnown) {
          // Domain already in our database — list-confirmed, skip deep scan
          const already = fp.listHits.find(h => h.domain === callerDomain);
          if (!already) fp.listHits.push(entry);
        } else if (callerDomain !== 'inline' && fp.totalScore >= 30) {
          // Unknown domain caught ONLY by behavioral interception = zero-day
          const already = fp.zeroDayDiscoveries.find(d => d.domain === callerDomain);
          if (!already) fp.zeroDayDiscoveries.push(entry);
        }
      }
      // ─────────────────────────────────────────────────────────

      fp.lastUpdated = Date.now();
      telemetry.liveScore.fingerprintScore = Math.min(100, fp.totalScore);
      this.recalculatePrivacyScore(telemetry);
    } catch (_e) {}
  }

  // ── Record the final page-load summary from the MAIN world interceptor ──
  recordFingerprintSummary(tabId, payload) {
    try {
      const telemetry = this.tabTelemetry.get(tabId);
      if (!telemetry) return;
      const fp = telemetry.fpDetection;
      fp.summary = payload;
      fp.totalScore = Math.max(fp.totalScore, payload.totalScore || 0);
      fp.confidence = payload.confidence || fp.confidence;
      const techSet = new Set(fp.techniques);
      (payload.techniques || []).forEach(t => techSet.add(t));
      fp.techniques = Array.from(techSet);

      // ── Save FP-Inspector per-script group profiles (UPGRADE 5) ──
      // These arrive from the MAIN world interceptor's final summary.
      if (payload.scriptProfiles?.length) {
        fp.scriptProfiles = payload.scriptProfiles;
      }
      if (payload.confirmedFingerprinters?.length) {
        fp.confirmedFingerprinters = payload.confirmedFingerprinters;
      }

      fp.lastUpdated = Date.now();
      telemetry.liveScore.fingerprintScore = Math.min(100, fp.totalScore);
      this.recalculatePrivacyScore(telemetry);
    } catch (_e) {}
  }


  // ── Badge update — fully guarded against "No tab with id" ──
  async updateBadge(tabId) {
    if (!chrome.action) return;
    if (!tabId || tabId === -1) return;

    // Verify tab still exists before touching the badge
    const tab = await safeTabGet(tabId);
    if (!tab) return;

    try {
      const telemetry = this.tabTelemetry.get(tabId);
      if (!telemetry) {
        chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
        return;
      }
      const count = telemetry.detectedTrackersMap.size;
      if (count > 0) {
        chrome.action.setBadgeText({ text: String(count), tabId }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: "#4f46e5", tabId }).catch(() => {});
      } else {
        chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
      }
    } catch (_e) {
      // Tab may have been closed between the guard check and the API call — ignore
    }
  }

  getTelemetry(tabId) {
    if (!this.tabTelemetry.has(tabId)) {
      this.tabTelemetry.set(tabId, this.createEmptyTelemetry(""));
    }
    const telemetry = this.tabTelemetry.get(tabId);
    if (this.isInitialized && this.trackerData) {
      telemetry.detectedTrackers = Array.from(telemetry.detectedTrackersMap.values());
      telemetry.databaseMetadata = this.trackerData.metadata;
    }
    return telemetry;
  }

  // ── O(1) Live Scoring Engine ──
  recalculatePrivacyScore(telemetry) {
    if (!telemetry || !telemetry.liveScore) return;
    const score = telemetry.liveScore;
    
    // O(1) lookups
    score.trackerCount = telemetry.detectedTrackersMap.size;
    score.cookieCount = telemetry.cookies.length;
    
    // Base score calculation: Evaluate on harm and data extraction, not raw counts
    let pScore = 100;
    
    // Track exact deductions for UI explanation ("Why isn't this A+?")
    score.deductions = [];
    
    // 1. Tracker Risk (Max 35 deduction)
    let trackerPenalty = 0;
    telemetry.detectedTrackersMap.forEach(t => {
      let penalty = 0;
      if (t.riskLevel === 'Ultra High') penalty = 8;
      else if (t.riskLevel === 'High') penalty = 5;
      else if (t.riskLevel === 'Medium') penalty = 2;
      else if (t.riskLevel === 'Low') penalty = 0.5;
      else if (t.riskLevel === 'Essential') penalty = 0;
      
      // If collects PII, increase penalty slightly
      if (t.collectsPII) penalty += 2;
      
      if (trackerPenalty + penalty > 35) penalty = 35 - trackerPenalty; // Cap
      if (penalty > 0) {
        trackerPenalty += penalty;
        score.deductions.push({ reason: t.company || t.domain, amount: penalty, category: 'tracker' });
      }
    });
    pScore -= trackerPenalty;

    // 2. Fingerprinting (Max 30 deduction)
    let fingerprintPenalty = Math.min(30, score.fingerprintScore * 0.5);
    if (fingerprintPenalty > 0) {
      pScore -= fingerprintPenalty;
      score.deductions.push({ reason: 'Browser Fingerprinting', amount: fingerprintPenalty, category: 'fingerprint' });
    }
    
    // 3. Cookies (Max 20 deduction)
    let cookiePenalty = 0;
    let thirdPartyCookies = 0;
    let advertisingCookies = 0;
    // Guard: page.url may be empty string (e.g. new tabs, chrome:// pages) — catch parse errors
    let pageHostname = '';
    try { if (telemetry.page.url) pageHostname = new URL(telemetry.page.url).hostname; } catch (_e) {}
    telemetry.cookies.forEach(c => {
       if (c.domain && pageHostname && !c.domain.includes(pageHostname)) {
           thirdPartyCookies++;
           if (/_ga|_fbp|_gid|ad|track|pixel/i.test(c.name)) advertisingCookies++;
       }
    });
    let cPenalty = Math.min(20, (advertisingCookies * 3) + (thirdPartyCookies * 1));
    if (cPenalty > 0) {
      pScore -= cPenalty;
      score.deductions.push({ reason: advertisingCookies > 0 ? 'Advertising Cookies' : 'Third-Party Cookies', amount: cPenalty, category: 'cookie' });
    }
    
    // 4. Permissions (Max 10 deduction)
    let permPenalty = 0;
    Object.entries(telemetry.permissions || {}).forEach(([perm, state]) => {
       if (state === 'granted') {
          if (perm === 'geolocation' || perm === 'camera' || perm === 'microphone') {
             let penalty = Math.min(10 - permPenalty, 5);
             if (penalty > 0) {
                permPenalty += penalty;
                score.deductions.push({ reason: `${perm} Permission`, amount: penalty, category: 'permission' });
             }
          }
       }
    });
    pScore -= permPenalty;
    
    // 5. Security (Max 5 deduction)
    let secPenalty = 0;
    if (!telemetry.security.isHttps) {
       secPenalty = Math.min(5, 2);
       score.deductions.push({ reason: 'Insecure Connection (HTTP)', amount: secPenalty, category: 'security' });
    }
    if (telemetry.security.knownMalware || telemetry.security.downloadedExecutable) {
       let diff = Math.min(5 - secPenalty, 5);
       if (diff > 0) {
          secPenalty += diff;
          score.deductions.push({ reason: 'Malicious Content', amount: diff, category: 'security' });
       }
    }
    pScore -= secPenalty;
    
    // Health breakdown scores (out of 100 for UI)
    score.health = {
       tracker: Math.round(((35 - trackerPenalty) / 35) * 100),
       cookie: Math.round(((20 - cPenalty) / 20) * 100),
       fingerprint: Math.round(((30 - fingerprintPenalty) / 30) * 100),
       permission: Math.round(((10 - permPenalty) / 10) * 100),
       security: Math.round(((5 - secPenalty) / 5) * 100)
    };
    
    score.privacyScore = Math.max(0, Math.round(pScore));
    
    // Grade calculation
    if (score.privacyScore >= 97) score.privacyGrade = 'A+';
    else if (score.privacyScore >= 90) score.privacyGrade = 'A';
    else if (score.privacyScore >= 80) score.privacyGrade = 'B';
    else if (score.privacyScore >= 65) score.privacyGrade = 'C';
    else if (score.privacyScore >= 45) score.privacyGrade = 'D';
    else score.privacyGrade = 'F';
    
    // Trust Score calculation
    score.trustScore.privacy = score.privacyScore;
    score.trustScore.security = telemetry.security.isHttps ? (telemetry.security.certificateValid ? 100 : 50) : 10;
    if (telemetry.security.knownMalware) score.trustScore.security = 0;
    
    // Transparency evaluates based on whether data collection is proportionate
    score.trustScore.transparency = Math.max(0, 100 - (Math.min(50, score.trackerCount * 5)));
    
    // Calculate blocked & companies
    let blocked = 0;
    telemetry.detectedTrackersMap.forEach(t => {
      if (t.riskLevel !== 'Essential') blocked += t.requestCount;
      if (t.company) score.companies.add(t.company);
    });
    score.trackersBlocked = blocked;
  }

  initListeners() {
    // ── Tab lifecycle ──
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === "loading" && changeInfo.url) {
        // Clear LRU cache entries for this tab
        for (const key of this._etldCache.keys()) {
          if (key.startsWith(`${tabId}::`)) this._etldCache.delete(key);
        }
        // Reset the per-tab rate limiter on navigation
        try { resetTabRateLimit(tabId); } catch (_e) {}
        this.tabTelemetry.set(tabId, this.createEmptyTelemetry(changeInfo.url, tab?.title || ""));
        this.getTelemetry(tabId).page.lifecycle.push({ event: "Navigation", time: Date.now(), url: changeInfo.url });
        this.updateBadge(tabId);
      } else if (changeInfo.status === "complete") {
        const telemetry = this.tabTelemetry.get(tabId);
        if (telemetry) telemetry.page.lifecycle.push({ event: "LoadComplete", time: Date.now() });
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      const telemetry = this.tabTelemetry.get(tabId);
      if (telemetry && telemetry.liveScore) {
        chrome.storage.local.get(['weeklyStats'], (res) => {
          let stats = res.weeklyStats || {
            trackersBlocked: 0,
            cookiesRemoved: 0,
            fingerprintsPrevented: 0,
            companiesPrevented: 0,
            weekStart: Date.now()
          };
          
          if (Date.now() - stats.weekStart > 7 * 24 * 60 * 60 * 1000) {
            stats = { trackersBlocked: 0, cookiesRemoved: 0, fingerprintsPrevented: 0, companiesPrevented: 0, weekStart: Date.now() };
          }
          
          stats.trackersBlocked += telemetry.liveScore.trackersBlocked || 0;
          stats.cookiesRemoved += telemetry.liveScore.cookieCount || 0;
          if (telemetry.liveScore.fingerprintScore > 50) stats.fingerprintsPrevented += 1;
          stats.companiesPrevented += (telemetry.liveScore.companies ? telemetry.liveScore.companies.size : 0);
          
          chrome.storage.local.set({ weeklyStats: stats });
        });
      }
      this.tabTelemetry.delete(tabId);
      // Clear badge safely — tab is gone so badge call will throw; just skip it
    });

    // ── Cookie timeline ──
    if (chrome.cookies && chrome.cookies.onChanged) {
      chrome.cookies.onChanged.addListener(async (changeInfo) => {
        try {
          const { cookie, cause, removed } = changeInfo;
          const tabs = await safeQueryActiveTabs();
          if (!tabs.length) return;
          const telemetry = this.getTelemetry(tabs[0].id);
          telemetry.cookieTimeline.unshift({
            name: cookie.name,
            domain: cookie.domain,
            action: removed ? "removed" : "created/updated",
            cause,
            timestamp: Date.now(),
            session: cookie.session,
          });
          if (telemetry.cookieTimeline.length > 50) telemetry.cookieTimeline.pop();
          
          if (!removed) {
            telemetry.cookies.push(cookie);
            this.recalculatePrivacyScore(telemetry);
          }
        } catch (_e) {}
      });
    }

    // ── Network request lifecycle ──
    const filter = { urls: ["<all_urls>"] };
    const recentRequests = new Map();
    // Periodic cleanup of recentRequests and activeRequests to prevent memory growth
    setInterval(() => {
      const cutoff = Date.now() - 5000;
      for (const [k, ts] of recentRequests) { if (ts < cutoff) recentRequests.delete(k); }
      if (this.activeRequests.size > 1500) this.activeRequests.clear();
    }, 10000);

    chrome.webRequest.onBeforeRequest.addListener((details) => {
      if (details.tabId === -1) return;

      // Dedup requests within 200ms
      const reqKey = `${details.tabId}-${details.frameId || 0}-${details.method}-${details.type}-${details.url}`;
      const now = Date.now();
      const lastSeen = recentRequests.get(reqKey);
      if (lastSeen && now - lastSeen < 200) return;
      recentRequests.set(reqKey, now);

      let domain;
      try { domain = new URL(details.url).hostname; }
      catch (_e) { return; } // Skip malformed URLs

      const isFirstParty = this._getCachedFirstParty(details.url, details.tabId);

      const requestDetails = {
        requestId: details.requestId,
        tabId: details.tabId,
        frameId: details.frameId,
        parentFrame: details.parentFrameId,
        timestamp: details.timeStamp,
        url: details.url,
        domain,
        initiator: details.initiator || "unknown",
        resourceType: details.type,
        requestMethod: details.method,
        status: "pending",
        isFirstParty,
        isThirdParty: !isFirstParty,
        firstSeen: details.timeStamp,
        lastSeen: details.timeStamp,
        duration: 0,
        redirectChain: [domain],
      };

      this.activeRequests.set(details.requestId, requestDetails);

      const telemetry = this.getTelemetry(details.tabId);

      // ── UPGRADE 8b: Enforce rolling buffer cap on network array ──
      if (telemetry.network.length >= telemetry._networkMaxSize) {
        telemetry.network.shift(); // Drop oldest request to stay within cap
      }
      telemetry.network.push(requestDetails);

      if (this.isInitialized && this.trackerData) {
        const beforeSize = telemetry.detectedTrackersMap.size;
        
        // Pass tabId so the rate limiter in TrackerClassifier can cap per-tab processing
        TrackerClassifier.processSingleRequest(
          requestDetails, this.trackerData, telemetry.detectedTrackersMap,
          this.blockingMode, details.tabId
        );
        
        const afterSize = telemetry.detectedTrackersMap.size;
        if (afterSize > beforeSize && this.blockingMode === 'strict' && !this.isPaused) {
          const newTracker = Array.from(telemetry.detectedTrackersMap.values()).pop();
          blockEngine.blockMultiple([newTracker.domain], 'permanent').catch(() => {});
        }
        
        this.updateBadge(details.tabId); // async fire-and-forget
      }

      if (telemetry.security.isHttps && requestDetails.url.startsWith("http://")) {
        telemetry.security.mixedContent = true;
      }

      const cleanDomain = domain.replace(/^www\./, "");
      if (this.isInitialized && this.securityData?.threats?.[cleanDomain]) {
        telemetry.security.knownMalware = true;
        requestDetails.threatData = this.securityData.threats[cleanDomain];
      }
    }, filter);

    chrome.webRequest.onBeforeRedirect.addListener((details) => {
      const req = this.activeRequests.get(details.requestId);
      if (!req) return;
      try {
        const nextDomain = new URL(details.redirectUrl).hostname;
        req.redirectChain.push(nextDomain);
        if (new Set(req.redirectChain).size >= 3) {
          const telemetry = this.getTelemetry(details.tabId);
          if (telemetry) telemetry.security.multipleRedirects = true;
        }
      } catch (_e) {}
    }, filter);

    chrome.webRequest.onHeadersReceived.addListener((details) => {
      const req = this.activeRequests.get(details.requestId);
      if (!req) return;
      req.statusCode = details.statusCode;
      req.responseHeaders = details.responseHeaders;
      req.lastSeen = details.timeStamp;
      req.duration = req.lastSeen - req.firstSeen;

      const ct = details.responseHeaders?.find(h => h.name.toLowerCase() === "content-type");
      req.contentType = ct ? ct.value : "unknown";

      const cl = details.responseHeaders?.find(h => h.name.toLowerCase() === "content-length");
      req.responseSize = cl ? parseInt(cl.value, 10) : 0;

      // ── UPGRADE 4: Pixel Beacon Detection ──
      // Detect 1x1 tracking pixels (common in email tracking, ad impression counting).
      // Pattern: tiny image (<500B) + tracking URL signals = pixel beacon.
      // Research: DuckDuckGo blocks 1x1 GIFs by default; this catches hidden beacons.
      if (req.isThirdParty && isPixelBeacon(req.url, req.contentType, req.responseSize)) {
        req.isPixelBeacon = true;
        const telemetry = this.getTelemetry(details.tabId);
        if (telemetry && this.isInitialized && this.trackerData) {
          const key = `PixelBeacon-${req.domain}`;
          if (!telemetry.detectedTrackersMap.has(key)) {
            telemetry.detectedTrackersMap.set(key, {
              domain: req.domain,
              company: req.domain,
              parentCompany: null,
              category: 'Pixel Tracker',
              country: null,
              purpose: 'Invisible pixel tracking (1x1 image beacon)',
              knownBehaviors: ['pixel_beacon', 'impression_tracking'],
              confidence: 0.85,
              riskLevel: 'High',
              fingerprinting: false,
              collectsPII: true,
              sources: ['Pixel Beacon Heuristic'],
              detectionMethod: 'pixel_beacon',
              requestCount: 1,
            });
            this.updateBadge(details.tabId);
          } else {
            telemetry.detectedTrackersMap.get(key).requestCount++;
          }
        }
      }
    }, filter, ["responseHeaders"]);


    chrome.webRequest.onCompleted.addListener((details) => {
      const req = this.activeRequests.get(details.requestId);
      if (!req) return;
      req.status = "success";
      req.lastSeen = details.timeStamp;
      req.duration = req.lastSeen - req.firstSeen;
      this.activeRequests.delete(details.requestId);
    }, filter);

    chrome.webRequest.onErrorOccurred.addListener((details) => {
      const req = this.activeRequests.get(details.requestId);
      if (!req) return;
      req.status = "failed";
      req.error = details.error;
      req.lastSeen = details.timeStamp;
      req.duration = req.lastSeen - req.firstSeen;
      this.activeRequests.delete(details.requestId);
    }, filter);

    // ── Threat Intelligence Engine (Downloads) ──
    if (chrome.downloads && chrome.downloads.onCreated) {
      chrome.downloads.onCreated.addListener(async (downloadItem) => {
        try {
          const risky = [".exe", ".msi", ".apk", ".scr", ".bat", ".cmd", ".ps1", ".jar", ".vbs", ".dmg"];
          const isExecutable = risky.some(ext => (downloadItem.filename || "").toLowerCase().endsWith(ext));
          
          const tabs = await safeQueryActiveTabs();
          if (!tabs.length) return;
          const telemetry = this.getTelemetry(tabs[0].id);
          
          if (isExecutable) telemetry.security.downloadedExecutable = true;
          
          if (this.securityData && this.securityData.maliciousDomains) {
            try {
              const dlDomain = new URL(downloadItem.url).hostname;
              if (this.securityData.maliciousDomains.includes(dlDomain)) {
                telemetry.security.knownMalware = true;
              }
            } catch (_e) {}
          }
          
          this.recalculatePrivacyScore(telemetry);
        } catch (_e) {}
      });
    }
  }

  // ── Cookie fetch ──
  async updateCookies(tabId, url) {
    if (!url || !url.startsWith("http")) return;
    try {
      const telemetry = this.getTelemetry(tabId);
      const domainsToCheck = new Set();
      try { domainsToCheck.add(new URL(url).hostname); } catch (_e) {}
      for (const req of telemetry.network) {
        if (req.domain) domainsToCheck.add(req.domain);
      }

      const allCookies = [];
      const seenCookies = new Set();

      for (const domain of domainsToCheck) {
        try {
          const searchUrl =
            domain.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(domain)
              ? `http://${domain}`
              : `https://${domain}`;
          const cookies = await chrome.cookies.getAll({ url: searchUrl });
          for (const c of cookies) {
            const key = `${c.domain}-${c.name}`;
            if (!seenCookies.has(key)) {
              seenCookies.add(key);
              allCookies.push(c);
            }
          }
        } catch (_e) {}
      }

      telemetry.cookies = allCookies.map(c => ({
        name: c.name,
        domain: c.domain,
        expiry: c.session ? "session" : c.expirationDate,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        isFirstParty: this.isFirstParty(c.domain, tabId),
      }));
    } catch (_e) {}
  }

  // ── First-party check ──
  isFirstParty(targetUrlOrDomain, tabId) {
    const telemetry = this.tabTelemetry.get(tabId);
    if (!telemetry?.page?.url) return true;
    try {
      const pageDomain = new URL(telemetry.page.url).hostname.replace(/^www\./, "");
      let targetDomain = targetUrlOrDomain;
      if (targetUrlOrDomain.startsWith("http")) {
        targetDomain = new URL(targetUrlOrDomain).hostname;
      }
      targetDomain = targetDomain.replace(/^www\./, "");
      return targetDomain === pageDomain || targetDomain.endsWith(`.${pageDomain}`);
    } catch (_e) {
      return false;
    }
  }

  // ── Process past performance resources ──
  async processPastResources(tabId, pageUrl, resources) {
    if (!this.isInitialized || !this.trackerData || !resources) return;

    const telemetry = this.getTelemetry(tabId);
    if (!telemetry.page.url) {
      telemetry.page.url = pageUrl;
      try {
        const tab = await safeTabGet(tabId);
        if (tab) telemetry.page.title = tab.title || "";
      } catch (_e) {}
    }

    const seenUrls = new Set(telemetry.network.map(req => req.url));

    for (const r of resources) {
      if (!r.url || !r.url.startsWith("http")) continue;
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);

      let domain;
      try { domain = new URL(r.url).hostname; }
      catch (_e) { continue; }

      const isFirstParty = this.isFirstParty(r.url, tabId);
      const requestDetails = {
        requestId: `perf-${Math.random().toString(36).substr(2, 9)}`,
        tabId,
        frameId: 0,
        parentFrame: -1,
        timestamp: Date.now(),
        url: r.url,
        domain,
        initiator: r.type || "unknown",
        resourceType: r.type || "other",
        requestMethod: "GET",
        status: "success",
        isFirstParty,
        isThirdParty: !isFirstParty,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        duration: r.timestamp || 0,
        redirectChain: [domain],
      };

      if (telemetry.network.length >= telemetry._networkMaxSize) telemetry.network.shift();
      telemetry.network.push(requestDetails);
      // Pass tabId to rate limiter; also avoid per-item badge updates in batch — update once after loop
      TrackerClassifier.processSingleRequest(
        requestDetails, this.trackerData, telemetry.detectedTrackersMap,
        this.blockingMode, tabId
      );

      if (telemetry.security.isHttps && requestDetails.url.startsWith("http://")) {
        telemetry.security.mixedContent = true;
      }
      const cleanDomain = domain.replace(/^www\./, "");
      if (this.securityData?.threats?.[cleanDomain]) {
        telemetry.security.knownMalware = true;
        requestDetails.threatData = this.securityData.threats[cleanDomain];
      }
    }
    // Single badge update after processing all past resources (was O(N) badge spam)
    this.updateBadge(tabId);
  }
}

export const telemetryEngine = new TelemetryEngine();
