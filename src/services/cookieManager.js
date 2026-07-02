// src/services/cookieManager.js
import { TrackerClassifier } from '../background/trackerClassifier.js';

class CookieManager {
  constructor() {
    this.trackerData = null;
    this.init();
  }

  async init() {
    try {
      const res = await fetch('/trackerDatabase.json');
      this.trackerData = await res.json();
    } catch (e) {
      console.error("Failed to load trackerData in CookieManager", e);
    }
  }

  /**
   * Deterministic mapping for Cookie Purposes based on Name, Domain Classification, and Session.
   */
  classifyCookie(cookie, trackerMeta) {
    let purpose = "Unknown";
    let risk = "Low";
    let category = "Unknown";
    
    // 1. If we have tracker metadata, use it as baseline
    if (trackerMeta) {
      purpose = trackerMeta.purpose || "Advertising / Analytics";
      category = trackerMeta.category || "Tracking";
      risk = trackerMeta.riskLevel || "Medium";
    }

    // 2. Name-based heuristics (overrides)
    const name = cookie.name.toLowerCase();
    
    // Analytics
    if (name.startsWith('_ga') || name.startsWith('_gid') || name === '_gat' || name === 'vuid') {
      purpose = "Analytics";
      category = "Analytics";
      risk = "Medium";
    }
    // Advertising / Tracking
    else if (name === '_fbp' || name === 'fr' || name === 'tr' || name === 'nid' || name === 'ide' || name === 'uuid2') {
      purpose = "Advertising";
      category = "Advertising";
      risk = "Medium";
    }
    // Essential / Session / Auth
    else if (name.includes('session') || name.includes('sess') || name.includes('auth') || name.includes('token') || name === 'csrf' || name === 'xsrf') {
      purpose = "Authentication / Session";
      category = "Essential";
      risk = "Essential";
    }
    // Consent
    else if (name.includes('consent') || name.includes('euconsent') || name.includes('cmp')) {
      purpose = "Consent Preferences";
      category = "Essential";
      risk = "Essential";
    }
    // Default fallback based on session
    else if (purpose === "Unknown") {
      if (cookie.session) {
        purpose = "Temporary Session Data";
        category = "Essential";
        risk = "Essential";
      } else if (!cookie.isFirstParty) {
        purpose = "Third-Party Tracking";
        category = "Tracking";
        risk = "Medium";
      } else {
        purpose = "Site Preferences / State";
        category = "Essential";
        risk = "Low";
      }
    }

    return { purpose, category, risk };
  }

  /**
   * Deterministic mapping for Cookie Impact if deleted.
   */
  getCookieImpact(category, isSession) {
    if (category === "Essential" || isSession) {
      return "Logout possible. Site features may break.";
    }
    if (category === "Analytics") {
      return "Analytics reset. Website still works.";
    }
    if (category === "Advertising" || category === "Tracking") {
      return "Personalized ads reset. Privacy improved.";
    }
    return "Preferences may reset. Website still works.";
  }

  /**
   * Annotates raw cookies with intelligence data.
   */
  enrichCookies(cookies) {
    if (!cookies) return [];
    
    return cookies.map(cookie => {
      const trackerMeta = this.trackerData ? TrackerClassifier.identifyTracker(cookie.domain, this.trackerData) : null;
      const intelligence = this.classifyCookie(cookie, trackerMeta);
      
      return {
        ...cookie,
        company: trackerMeta ? trackerMeta.company : "Unknown",
        parentCompany: trackerMeta ? trackerMeta.parentCompany : "Unknown",
        purpose: intelligence.purpose,
        category: intelligence.category,
        risk: intelligence.risk,
        impact: this.getCookieImpact(intelligence.category, cookie.expiry === 'session')
      };
    });
  }

  // Helper to construct a URL for chrome.cookies.remove
  _buildUrl(domain, secure) {
    let cleanDomain = domain;
    if (cleanDomain.startsWith('.')) {
      cleanDomain = cleanDomain.substring(1);
    }
    return (secure ? "https://" : "http://") + cleanDomain;
  }

  async deleteCookie(cookie) {
    try {
      const url = this._buildUrl(cookie.domain, cookie.secure);
      await chrome.cookies.remove({ url: url, name: cookie.name });
      return true;
    } catch (e) {
      console.error("Failed to delete cookie", cookie, e);
      return false;
    }
  }

  async clearSelected(cookies) {
    const promises = cookies.map(c => this.deleteCookie(c));
    await Promise.all(promises);
  }

  async clearThirdParty(cookies) {
    const thirdParty = cookies.filter(c => !c.isFirstParty);
    await this.clearSelected(thirdParty);
  }

  async clearAdvertising(cookies) {
    const adCookies = cookies.filter(c => c.category === 'Advertising' || c.category === 'Tracking');
    await this.clearSelected(adCookies);
  }

  async clearAll(cookies) {
    await this.clearSelected(cookies);
  }
}

export const cookieManager = new CookieManager();
