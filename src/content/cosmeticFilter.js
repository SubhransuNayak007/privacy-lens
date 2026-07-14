/**
 * PrivacyLens Cosmetic Filter Engine v3
 * ======================================
 * State-of-the-art DOM-based ad blocking.
 * 
 * Instead of huge CSS selector lists, we use:
 * Layer 1: Minimal critical CSS for layout collapsing
 * Layer 2: Ultra-fast TreeWalker heuristic text-scanning
 */

const GENERIC_SELECTORS = [
  '.ad-container', '.ad-wrapper', '.ad-slot', '.ad-box',
  '[data-ad]', 'ins.adsbygoogle', 'div[id^="div-gpt-ad"]',
  'div[id^="google_ads_"]', '.OUTBRAIN', '[id^="taboola"]'
];

function injectCSSHiding(selectors) {
  if (document.getElementById('__pl_cosmetic_v3')) return;
  const style = document.createElement('style');
  style.id = '__pl_cosmetic_v3';
  style.textContent = selectors.join(',\n') +
    ' { display: none !important; visibility: hidden !important; ' +
    'opacity: 0 !important; max-height: 0 !important; ' +
    'overflow: hidden !important; pointer-events: none !important; }';
  (document.head || document.documentElement)?.appendChild(style);
}

function scanAndRemoveHeuristicAds() {
  // TreeWalker is the absolute fastest way to scan all text nodes in a document.
  // It completely bypasses the CSS query engine.
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const adKeywords = /^(Sponsored|Promoted|Advertisement|Ad)$/i;
  let node;
  let removals = 0;

  while ((node = walker.nextNode())) {
    const text = node.nodeValue.trim();
    if (text.length > 20 || text.length < 2) continue; // Optimization: skip long text blocks
    
    if (adKeywords.test(text)) {
      // We found a text node explicitly declaring "Sponsored" or "Ad".
      // Now we walk up the DOM to find the structural container to remove.
      let container = node.parentElement;
      let depth = 0;
      
      while (container && depth < 8) {
        // Stop if we hit a major layout element to avoid breaking the page
        if (container.tagName === 'BODY' || container.tagName === 'MAIN') break;
        
        // Typical container footprints on X, Reddit, Facebook, News sites
        if (
          container.getAttribute('data-testid') === 'cellInnerDiv' || 
          container.tagName === 'ARTICLE' ||
          container.className.includes('ad-') ||
          container.className.includes('sponsor') ||
          (container.getBoundingClientRect().height > 50 && depth > 2)
        ) {
          if (!container.dataset.plRemoved) {
            container.dataset.plRemoved = '1';
            container.style.setProperty('display', 'none', 'important');
            removals++;
          }
          break; // Move to next node
        }
        container = container.parentElement;
        depth++;
      }
    }
  }
  return removals;
}

let mainObserver = null;
let debounceTimer = null;

export function startCosmeticFilter() {
  // Layer 1
  injectCSSHiding(GENERIC_SELECTORS);

  // Layer 2
  scanAndRemoveHeuristicAds();

  // Layer 3 (Mutation Observer)
  const target = document.body || document.documentElement;
  if (!target) {
    document.addEventListener('DOMContentLoaded', () => startCosmeticFilter(), { once: true });
    return;
  }

  if (mainObserver) return;

  mainObserver = new MutationObserver((mutations) => {
    let hasAdditions = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        hasAdditions = true;
        break;
      }
    }
    
    if (hasAdditions) {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        scanAndRemoveHeuristicAds();
      }, 100);
    }
  });

  mainObserver.observe(target, { childList: true, subtree: true });
}
