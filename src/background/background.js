import { telemetryEngine } from './telemetryEngine.js';
import { blockEngine } from './blockEngine.js';

// ── Initialize block engine ──
blockEngine.init().catch(() => {});

// ── Safe helper: send a message to a tab, silently ignoring closed tabs ──
function safeTabMessage(tabId, message) {
  return new Promise((resolve) => {
    if (!tabId || tabId === -1) { resolve(null); return; }
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(response || null);
      });
    } catch (_e) { resolve(null); }
  });
}

// ── Persist telemetry state to chrome.storage.session every 10 s ──
async function flushTelemetryToSession() {
  try {
    const snapshot = {};
    for (const [tabId, data] of telemetryEngine.tabTelemetry.entries()) {
      snapshot[String(tabId)] = {
        page: data.page,
        network: data.network.slice(-200),
        detectedTrackers: Array.from(data.detectedTrackersMap.values()),
        cookies: data.cookies,
        cookieTimeline: data.cookieTimeline,
        security: data.security,
        permissions: data.permissions || {},
        metadata: data.metadata,
        fpDetection: data.fpDetection || null,
      };
    }
    await chrome.storage.session.set({ telemetrySnapshot: snapshot });
  } catch (_e) {
    // storage.session may not be available — fail silently
  }
}

// ── Rehydrate telemetry from session after service worker restart ──
async function rehydrateTelemetryFromSession() {
  try {
    const result = await chrome.storage.session.get('telemetrySnapshot');
    const snapshot = result.telemetrySnapshot || {};
    for (const [tabIdStr, data] of Object.entries(snapshot)) {
      const tabId = parseInt(tabIdStr, 10);
      // Only restore if the tab still exists
      try {
        await new Promise((resolve, reject) => {
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) reject(new Error('Tab gone'));
            else resolve(tab);
          });
        });

        const t = telemetryEngine.getTelemetry(tabId);
        t.page           = data.page           || t.page;
        t.network        = data.network        || t.network;
        t.cookies        = data.cookies        || t.cookies;
        t.cookieTimeline = data.cookieTimeline || t.cookieTimeline;
        t.security       = data.security       || t.security;
        t.permissions    = data.permissions    || t.permissions;
        t.metadata       = data.metadata       || t.metadata;
        if (data.fpDetection) t.fpDetection = data.fpDetection;
        if (Array.isArray(data.detectedTrackers)) {
          for (const tracker of data.detectedTrackers) {
            t.detectedTrackersMap.set(tracker.domain, tracker);
          }
        }
      } catch (_e) {
        // Tab no longer exists — skip silently
      }
    }
  } catch (_e) {
    // storage.session unavailable — skip silently
  }
}

rehydrateTelemetryFromSession();
setInterval(flushTelemetryToSession, 10000);

// ── Message Handler ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "GET_CURRENT_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) { sendResponse(null); return; }
      sendResponse({
        title: tabs[0]?.title || "",
        url:   tabs[0]?.url   || "",
      });
    });
    return true;
  }

  if (message.type === "GET_TELEMETRY_DATA" || message.type === "RESCAN_TELEMETRY") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (chrome.runtime.lastError) { sendResponse(null); return; }
      const activeTab = tabs?.[0];
      if (!activeTab?.id) { sendResponse(null); return; }

      // Verify tab still exists before doing async work
      try {
        await new Promise((resolve, reject) => {
          chrome.tabs.get(activeTab.id, (tab) => {
            if (chrome.runtime.lastError || !tab) reject(new Error('Tab gone'));
            else resolve(tab);
          });
        });
      } catch (_e) {
        sendResponse(null);
        return;
      }

      if (message.type === "RESCAN_TELEMETRY") {
        const result = await safeTabMessage(activeTab.id, { type: 'GET_PERFORMANCE_RESOURCES' });
        if (result?.resources) {
          try {
            await telemetryEngine.processPastResources(activeTab.id, activeTab.url, result.resources);
          } catch (_e) {}
        }
      }

      try {
        await telemetryEngine.updateCookies(activeTab.id, activeTab.url);
      } catch (_e) {}

      const telemetry    = telemetryEngine.getTelemetry(activeTab.id);
      const blockedState = await blockEngine.getBlockedState().catch(() => ({}));

      flushTelemetryToSession().catch(() => {});

      sendResponse({ ...telemetry, blockedState });
    });
    return true;
  }

  if (message.type === "TOGGLE_BLOCK") {
    blockEngine.toggleBlock(message.domain, message.isBlocked, message.blockType || 'permanent')
      .then(state => sendResponse(state))
      .catch(() => sendResponse({}));
    return true;
  }

  if (message.type === "BLOCK_MULTIPLE") {
    blockEngine.blockMultiple(message.domains, message.blockType || 'permanent')
      .then(state => sendResponse(state))
      .catch(() => sendResponse({}));
    return true;
  }

  if (message.type === "UNBLOCK_MULTIPLE") {
    blockEngine.unblockMultiple(message.domains)
      .then(state => sendResponse(state))
      .catch(() => sendResponse({}));
    return true;
  }

  if (message.type === "TOGGLE_GLOBAL_PROTECTION") {
    const isEnabled = message.isEnabled;
    telemetryEngine.isPaused = !isEnabled;
    
    // When protection is toggled OFF, clear all dynamic rules
    // When toggled ON, re-apply the blockEngine rules based on its state
    if (!isEnabled) {
      chrome.declarativeNetRequest.getDynamicRules().then(rules => {
        const existingRuleIds = rules.map(r => r.id);
        chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingRuleIds });
      });
    } else {
      blockEngine.applyRules().catch(() => {});
    }

    sendResponse({ isProtectionEnabled: !telemetryEngine.isPaused });
    return true;
  }
  
  if (message.type === "GET_PROTECTION_STATE") {
    sendResponse({ isProtectionEnabled: !telemetryEngine.isPaused });
    return true;
  }

  // ── Behavioral Fingerprint Signals from MAIN world (via content script bridge) ──
  if (message.type === "FP_SIGNAL") {
    const tabId = sender?.tab?.id;
    if (tabId && tabId !== -1) {
      try { telemetryEngine.recordFingerprintSignal(tabId, message.payload); } catch (_e) {}
    }
    // No sendResponse needed — fire and forget
    return false;
  }

  if (message.type === "FP_SUMMARY") {
    const tabId = sender?.tab?.id;
    if (tabId && tabId !== -1) {
      try { telemetryEngine.recordFingerprintSummary(tabId, message.payload); } catch (_e) {}
    }
    return false;
  }
});