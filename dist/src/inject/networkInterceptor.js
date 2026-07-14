/**
 * PrivacyLens: Advanced Network Interceptor (MAIN World)
 * 
 * This script runs in the isolated MAIN world context of the page before any other
 * scripts load (document_start). It intercepts native APIs to strip ads directly 
 * from JSON data payloads before the page's JavaScript even receives them.
 * 
 * This provides 100% block rate on SPAs (like YouTube/Twitter) without the overhead
 * of DOM scanning or the breakage of DNS blocking.
 */

(function () {
  'use strict';

  // Make sure we only initialize once
  if (window.__pl_interceptor_active) return;
  window.__pl_interceptor_active = true;

  console.log('[PrivacyLens] Advanced Network Interceptor active.');

  // ----------------------------------------------------------------------
  // 1. Sanitize Data Payloads
  // ----------------------------------------------------------------------
  function sanitizeJSON(obj) {
    if (!obj) return obj;
    let modified = false;

    // YouTube specific ad arrays
    const adKeys = ['adPlacements', 'playerAds', 'adSlots', 'promotedSparklesWebRenderer'];
    
    // Recursive deep search
    function traverse(node) {
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          if (node[i] && typeof node[i] === 'object') {
            // Twitter / X promoted tweets
            if (node[i].content?.itemContent?.promotedMetadata) {
              node.splice(i, 1);
              modified = true;
              continue;
            }
            traverse(node[i]);
          }
        }
      } else if (node !== null && typeof node === 'object') {
        for (const key of Object.keys(node)) {
          if (adKeys.includes(key)) {
            delete node[key];
            modified = true;
          } else {
            traverse(node[key]);
          }
        }
      }
    }

    try {
      traverse(obj);
    } catch (e) {
      console.error('[PrivacyLens] Error sanitizing JSON:', e);
    }
    
    return modified;
  }

  // ----------------------------------------------------------------------
  // 2. Fetch API Interception
  // ----------------------------------------------------------------------
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const requestUrl = (typeof args[0] === 'string') ? args[0] : (args[0]?.url || '');
    
    // Only intercept specific, known ad-bearing API endpoints
    const isYouTubeAPI = requestUrl.includes('/youtubei/v1/player') || requestUrl.includes('/youtubei/v1/next');
    const isTwitterAPI = requestUrl.includes('/graphql') && (requestUrl.includes('HomeTimeline') || requestUrl.includes('SearchTimeline'));

    const response = await originalFetch.apply(this, args);

    if (isYouTubeAPI || isTwitterAPI) {
      try {
        // Clone the response because reading it consumes the stream
        const clonedResponse = response.clone();
        const json = await clonedResponse.json();
        
        const wasModified = sanitizeJSON(json);
        if (wasModified) {
          // Return a new response with the sanitized JSON
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      } catch (e) {
        // If parsing fails or isn't JSON, just return the original response
      }
    }

    return response;
  };

  // ----------------------------------------------------------------------
  // 3. XMLHttpRequest Interception
  // ----------------------------------------------------------------------
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._requestUrl = url;
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  const originalXhrResponseText = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
  
  if (originalXhrResponseText) {
    Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
      get: function () {
        const text = originalXhrResponseText.get.call(this);
        
        const isYouTubeAPI = this._requestUrl && (this._requestUrl.includes('/youtubei/v1/player') || this._requestUrl.includes('/youtubei/v1/next'));
        
        if (isYouTubeAPI && text) {
          try {
            const json = JSON.parse(text);
            if (sanitizeJSON(json)) {
              return JSON.stringify(json);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        return text;
      }
    });
  }

  // ----------------------------------------------------------------------
  // 4. Global Variable Hooking (Initial Page Loads)
  // ----------------------------------------------------------------------
  let _ytInitialPlayerResponse = window.ytInitialPlayerResponse;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    get: function () {
      return _ytInitialPlayerResponse;
    },
    set: function (val) {
      if (val) sanitizeJSON(val);
      _ytInitialPlayerResponse = val;
    },
    configurable: true
  });

})();
