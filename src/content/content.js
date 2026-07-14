import { scanStorage } from "../privacy/storageScanner";
import { MESSAGE_TYPES } from "../constants/messages";
import { startCosmeticFilter } from "./cosmeticFilter";

// ── Cosmetic Filter Engine ──────────────────────────────────────────────────
// Runs immediately at document_idle.
// Handles YouTube ads, Twitter promoted tweets, news site banners —
// all DOM-based ads that cannot be caught by network-level blocking.
//
// Mode logic:
//  - AdBlock: Full cosmetic filtering (ALL sites)
//  - Strict:  Full cosmetic filtering (ALL sites)  
//  - Balanced: Cosmetic filtering on ad-heavy social/video sites
//  - Safe:    No cosmetic filtering
(function initCosmeticFilter() {
  try {
    chrome.storage.local.get(['blockingMode'], (result) => {
      const mode = (result.blockingMode || 'Balanced').toLowerCase();
      const hostname = window.location.hostname.toLowerCase();

      const alwaysFilterSites = [
        'youtube.com', 'youtu.be',
        'twitter.com', 'x.com',
        'instagram.com', 'facebook.com',
        'reddit.com', 'linkedin.com',
      ];

      const isAdHeavySite = alwaysFilterSites.some(s => hostname.includes(s));

      if (mode === 'adblock' || mode === 'strict') {
        // Block everywhere
        startCosmeticFilter();
      } else if (mode === 'balanced' && isAdHeavySite) {
        // Block on major ad-heavy social/video platforms only
        startCosmeticFilter();
      }
      // Safe mode: no cosmetic filtering
    });
  } catch (_e) {
    // chrome API unavailable (test env) — run anyway
    startCosmeticFilter();
  }
})();

// ── Fingerprint Signal Bridge ──────────────────────────────────────────────
window.addEventListener('__pl_fp_signal', (event) => {
  try {
    chrome.runtime.sendMessage({
      type: 'FP_SIGNAL',
      payload: event.detail,
    }, () => { if (chrome.runtime.lastError) {} });
  } catch (_e) {}
});

window.addEventListener('__pl_fp_summary', (event) => {
  try {
    chrome.runtime.sendMessage({
      type: 'FP_SUMMARY',
      payload: event.detail,
    }, () => { if (chrome.runtime.lastError) {} });
  } catch (_e) {}
});

let lastFileUploadTime = 0;
document.addEventListener('change', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'file') {
    lastFileUploadTime = Date.now();
  }
});

function detectUserActivity() {
  const videos = document.querySelectorAll('video');
  for (const v of videos) {
    if (!v.paused && v.currentTime > 0 && v.offsetWidth > 0 && v.offsetHeight > 0) {
      if (v.srcObject) return "Video Meeting";
      return "Watching Video";
    }
  }
  if (Date.now() - lastFileUploadTime < 5 * 60 * 1000) return "Uploading File";

  const active = document.activeElement;
  if (active) {
    if (active.tagName === 'INPUT' && active.type === 'password') return "Logging In / Signing Up";
    if (active.tagName === 'INPUT' && (active.type === 'search' || active.name?.toLowerCase().includes('q') || active.id?.toLowerCase().includes('search'))) return "Searching";
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable) return "Filling Form";
  }

  const ccInput = document.querySelector('input[autocomplete="cc-number"], input[name*="card"], input[id*="card"]');
  if (ccInput) return "Making Payment";

  const iframes = document.querySelectorAll('iframe');
  for (const f of iframes) {
    if (f.src?.includes('stripe.com') || f.src?.includes('paypal.com') || f.src?.includes('braintree')) return "Making Payment";
  }

  if (document.querySelector('.ProseMirror, .ql-editor, [contenteditable="true"]')) return "Editing Document";

  return "Idle Browsing";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MESSAGE_TYPES.SCAN_STORAGE) {
    scanStorage().then(result => { sendResponse(result); }).catch(_e => { sendResponse({ storage: {}, permissions: {} }); });
    return true;
  }
  if (message.type === MESSAGE_TYPES.GET_USER_ACTIVITY) {
    sendResponse({ activity: detectUserActivity() });
    return true;
  }
  if (message.type === 'GET_PERFORMANCE_RESOURCES') {
    try {
      const resources = performance.getEntriesByType('resource').map(r => ({
        url: r.name, type: r.initiatorType,
        timestamp: Date.now() - (performance.now() - r.startTime)
      }));
      sendResponse({ resources });
    } catch (_e) { sendResponse({ resources: [] }); }
    return true;
  }
  // Restart cosmetic filter when mode changes to AdBlock/Strict
  if (message.type === 'MODE_CHANGED') {
    if (message.mode === 'AdBlock' || message.mode === 'Strict') {
      startCosmeticFilter();
    }
    return false;
  }
});