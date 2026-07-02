// ─────────────────────────────────────────────────────────────────────────────
// ESSENTIAL INFRASTRUCTURE ALLOWLIST
// These domains power fonts, CDNs, auth, payments, media, and core web infra.
// They will NEVER be recommended for blocking in ANY mode.
// Blocking these causes pages to break, fonts to vanish, and videos to stop.
// ─────────────────────────────────────────────────────────────────────────────
const ESSENTIAL_DOMAINS = new Set([
  // ── Google Infrastructure (fonts, CDN, storage, auth) ──
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "www.gstatic.com",
  "gstatic.com",
  "ajax.googleapis.com",
  "apis.google.com",
  "storage.googleapis.com",
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
  "googleusercontent.com",
  "accounts.google.com",
  "ssl.gstatic.com",
  "www.google.com",
  "google.com",
  "googleapis.com",
  // ── YouTube / Media ──
  "www.youtube.com",
  "youtube.com",
  "youtu.be",
  "yt3.ggpht.com",
  "ytimg.com",
  "i.ytimg.com",
  "s.ytimg.com",
  "googlevideo.com",
  "manifest.googlevideo.com",
  // ── Cloudflare CDN ──
  "cdnjs.cloudflare.com",
  "ajax.cloudflare.com",
  "cloudflare.com",
  "cloudflareinsights.com",
  // ── jsDelivr / unpkg / CDN ──
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.com",
  "rawgit.com",
  "raw.githubusercontent.com",
  // ── Payment Processors (always essential) ──
  "js.stripe.com",
  "stripe.com",
  "checkout.paypal.com",
  "paypal.com",
  "razorpay.com",
  "api.razorpay.com",
  // ── Auth / Single Sign On ──
  "auth0.com",
  "cdn.auth0.com",
  "login.microsoftonline.com",
  "accounts.google.com",
  "appleid.apple.com",
  // ── GitHub — full ecosystem (SPA assets, API, avatars, CDN, codeloading) ──
  "github.com",
  "githubassets.com",
  "githubusercontent.com",
  // ── Static / Image CDNs ──
  "images.unsplash.com",
  "upload.wikimedia.org",
  "i.imgur.com",
  "imgur.com",
  // ── Social Media Essential (login widgets, embeds) ──
  "platform.twitter.com",
  "platform.x.com",
  "staticxx.facebook.com",
  "connect.facebook.net",
  // ── Security / Certificate ──
  "ocsp.digicert.com",
  "crl.comodo.net",
  "ocsp.pki.goog",
  // ── Microsoft / Office / Azure ──
  "ajax.aspnetcdn.com",
  "az416426.vo.msecnd.net",
  "msft.bing.com",
  // ── Web Essentials ──
  "use.typekit.net",
  "p.typekit.net",
  "kit.fontawesome.com",
  "use.fontawesome.com",
  "maxcdn.bootstrapcdn.com",
  "stackpath.bootstrapcdn.com",
  "bootstrapcdn.com",
  // ── Recaptcha / Bot Protection ──
  "www.google.com/recaptcha",
  "recaptcha.net",
  "www.recaptcha.net",
  "hcaptcha.com",
  // ── Popular video / media hosts ──
  "vimeo.com",
  "player.vimeo.com",
  "f.vimeocdn.com",
  "i.vimeocdn.com",
  "fresnel.vimeocdn.com",
  "skyfire.vimeo.com",
  "av.vimeo.com",
  // ── Wikimedia / Wikipedia ──
  "en.wikipedia.org",
  "wikipedia.org",
  "wikimedia.org",
  "upload.wikimedia.org",
]);


// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY CLASSIFICATION
// Maps tracker categories/purposes to our simplified threat tiers.
// ─────────────────────────────────────────────────────────────────────────────

// Always block in ALL modes regardless of risk score
const ALWAYS_BLOCK_CATEGORIES = [
  "malware", "phishing", "cryptominer", "crypto miner",
  "keylogger", "exploit", "botnet", "spyware",
];

// Block in Balanced + Strict (pure advertising with no functional value)
const ADVERTISING_CATEGORIES = [
  "advertising", "ad serving", "ad network", "banner ads",
  "retargeting", "remarketing", "programmatic advertising",
  "affiliate tracking",
];

// Block in Strict only (analytics that don't break pages)
const ANALYTICS_CATEGORIES = [
  "analytics", "web analytics", "visitor analytics",
  "performance monitoring", "heatmap", "session recording",
  "behavioral analytics", "a/b testing",
];

// Never recommend blocking — these load assets, fonts, scripts
const FUNCTIONAL_CATEGORIES = [
  "cdn", "content delivery", "font delivery", "media", "video",
  "image delivery", "static assets", "storage", "auth", "authentication",
  "payment", "security", "captcha", "bot protection",
  "first-party", "essential",
];

function categorizeThreat(node) {
  const raw = [
    node.trackerData?.category || "",
    node.trackerData?.purpose || "",
    node.trackerData?.subCategory || "",
    ...(node.trackerData?.knownBehaviors || []),
  ].join(" ").toLowerCase();

  if (ALWAYS_BLOCK_CATEGORIES.some(c => raw.includes(c))) return "malware";
  if (FUNCTIONAL_CATEGORIES.some(c => raw.includes(c))) return "functional";
  if (ADVERTISING_CATEGORIES.some(c => raw.includes(c))) return "advertising";
  if (ANALYTICS_CATEGORIES.some(c => raw.includes(c))) return "analytics";
  if (node.trackerData?.fingerprinting) return "fingerprinting";
  return "unknown";
}

function isEssentialDomain(domain) {
  if (!domain) return false;
  if (ESSENTIAL_DOMAINS.has(domain)) return true;
  // Check if any essential domain is a suffix match
  for (const essential of ESSENTIAL_DOMAINS) {
    if (domain.endsWith(`.${essential}`) || domain === essential) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE DEFINITIONS
//
// SAFE:      Educate only. Block absolute worst offenders (malware, extreme
//            fingerprinters). Let most trackers through. Goal: zero page breaks.
//
// BALANCED:  Block advertising trackers + fingerprinters. Allow analytics and
//            functional CDNs. Some pages may load slightly faster.
//
// STRICT:    Block advertising + analytics + unknown 3rd parties. Allow only
//            confirmed functional/CDN domains and media needed for playback.
//            Designed so pages still load and videos still play.
// ─────────────────────────────────────────────────────────────────────────────

export function getRecommendation(node, currentTabUrl, mode = "Balanced") {
  let currentHost = "";
  try {
    currentHost = new URL(currentTabUrl).hostname.replace(/^www\./, "");
  } catch (_e) {}

  const domain = node.domain || "";

  // ── Rule 1: Malware / known threat → Block in ALL modes ──
  if (node.threatData) {
    return {
      action: "Block",
      tag: "THREAT",
      tagColor: "#7f1d1d",
      tagBg: "#fee2e2",
      reasons: ["Confirmed malware / phishing domain", "Blocks harmful content delivery"],
    };
  }

  // ── Rule 2: First-party resource → Always allow ──
  const isFirstParty =
    currentHost &&
    (domain === currentHost ||
      domain.endsWith(`.${currentHost}`) ||
      currentHost.endsWith(`.${domain}`));

  if (!node.isThirdParty || isFirstParty) {
    return {
      action: "Allow",
      tag: "FIRST PARTY",
      tagColor: "#065f46",
      tagBg: "#d1fae5",
      reasons: ["First-party resource", "Required for site core functionality"],
    };
  }

  // ── Rule 3: Essential infrastructure → Always allow regardless of mode ──
  if (isEssentialDomain(domain)) {
    return {
      action: "Allow",
      tag: "ESSENTIAL",
      tagColor: "#1e40af",
      tagBg: "#dbeafe",
      reasons: [
        "Critical web infrastructure (CDN / fonts / auth / media)",
        "Blocking will break page layout or functionality",
      ],
    };
  }

  // ── Classify the threat tier ──
  const tier = categorizeThreat(node);
  const risk = node.trackerData?.riskLevel || "Unknown";
  const hasFingerprinting = !!node.trackerData?.fingerprinting;
  const collectsPII = !!node.trackerData?.collectsPII;

  // ── SAFE MODE ──
  // Only block confirmed malware (handled above) and extreme fingerprinters with High risk
  if (mode === "Safe") {
    if (tier === "malware") {
      return {
        action: "Block",
        tag: "MALWARE",
        tagColor: "#7f1d1d",
        tagBg: "#fee2e2",
        reasons: ["Malware or exploit distribution", "No legitimate use case"],
      };
    }
    if (hasFingerprinting && risk === "High") {
      return {
        action: "Review",
        tag: "FINGERPRINTER",
        tagColor: "#92400e",
        tagBg: "#fef3c7",
        reasons: [
          "Uses aggressive browser fingerprinting",
          "Tracks you across sites without cookies",
          "Tip: Allow only if this site needs it to work",
        ],
      };
    }
    // Everything else: educate but allow
    const label = tier === "advertising" ? "AD TRACKER"
      : tier === "analytics" ? "ANALYTICS"
      : tier === "fingerprinting" ? "FINGERPRINTER"
      : "3RD PARTY";
    return {
      action: "Allow",
      tag: label,
      tagColor: "#475569",
      tagBg: "#f1f5f9",
      reasons: [
        "Allowed in Safe mode (education only)",
        tier === "advertising" ? "Serves targeted advertisements" :
        tier === "analytics"   ? "Collects anonymous usage statistics" :
        "Third-party resource — monitor if suspicious",
      ],
    };
  }

  // ── BALANCED MODE ──
  // Block pure advertising trackers and high-risk fingerprinters.
  // Allow analytics, CDNs, media, and anything functional.
  if (mode === "Balanced") {
    if (tier === "malware") {
      return {
        action: "Block",
        tag: "MALWARE",
        tagColor: "#7f1d1d",
        tagBg: "#fee2e2",
        reasons: ["Malware or exploit distribution"],
      };
    }
    if (tier === "advertising") {
      return {
        action: "Block",
        tag: "AD TRACKER",
        tagColor: "#7c2d12",
        tagBg: "#ffedd5",
        reasons: [
          "Pure advertising tracker with no functional value",
          "Blocked to reduce cross-site profiling",
          "Page will load normally without this",
        ],
      };
    }
    if (tier === "fingerprinting" || (hasFingerprinting && risk === "High")) {
      return {
        action: "Block",
        tag: "FINGERPRINTER",
        tagColor: "#7f1d1d",
        tagBg: "#fee2e2",
        reasons: [
          "Aggressive fingerprinting — tracks you without cookies",
          "Cannot be opted out of with cookie settings",
        ],
      };
    }
    if (tier === "analytics") {
      return {
        action: "Allow",
        tag: "ANALYTICS",
        tagColor: "#1e40af",
        tagBg: "#dbeafe",
        reasons: [
          "Analytics — collects aggregate usage data",
          "Allowed in Balanced mode (low page impact)",
          collectsPII ? "⚠️ May collect personal identifiers" : "Generally anonymous statistics",
        ],
      };
    }
    if (tier === "functional") {
      return {
        action: "Allow",
        tag: "CONTENT DELIVERY",
        tagColor: "#065f46",
        tagBg: "#d1fae5",
        reasons: ["Delivers functional content (fonts, media, scripts)", "Required for normal page display"],
      };
    }
    // Unknown 3rd party — allow in balanced, just flag it
    if (risk === "High") {
      return {
        action: "Review",
        tag: "HIGH RISK",
        tagColor: "#92400e",
        tagBg: "#fef3c7",
        reasons: [
          "High-risk third party — purpose unclear",
          "Consider blocking if site works without it",
        ],
      };
    }
    return {
      action: "Allow",
      tag: "3RD PARTY",
      tagColor: "#475569",
      tagBg: "#f1f5f9",
      reasons: ["Low-risk third-party resource", "Allowed in Balanced mode"],
    };
  }

  // ── STRICT MODE ──
  // Block advertising, analytics, unknown 3rd parties.
  // Allow: CDN / functional / media for playback / auth / payments.
  if (mode === "Strict") {
    if (tier === "functional") {
      return {
        action: "Allow",
        tag: "ESSENTIAL CDN",
        tagColor: "#065f46",
        tagBg: "#d1fae5",
        reasons: [
          "Delivers essential content (fonts, media, scripts)",
          "Blocking this will break page layout or video playback",
        ],
      };
    }
    if (tier === "malware") {
      return {
        action: "Block",
        tag: "MALWARE",
        tagColor: "#7f1d1d",
        tagBg: "#fee2e2",
        reasons: ["Malware or exploit distribution"],
      };
    }
    if (tier === "advertising") {
      return {
        action: "Block",
        tag: "AD TRACKER",
        tagColor: "#7c2d12",
        tagBg: "#ffedd5",
        reasons: ["Advertising tracker", "No functional role in page loading", "Safe to block in Strict mode"],
      };
    }
    if (tier === "analytics") {
      return {
        action: "Block",
        tag: "ANALYTICS",
        tagColor: "#4c1d95",
        tagBg: "#ede9fe",
        reasons: [
          "Analytics tracker blocked in Strict mode",
          "Page will load normally without this",
          "You can switch to Balanced to allow analytics",
        ],
      };
    }
    if (tier === "fingerprinting" || hasFingerprinting) {
      return {
        action: "Block",
        tag: "FINGERPRINTER",
        tagColor: "#7f1d1d",
        tagBg: "#fee2e2",
        reasons: ["Browser fingerprinting tracker", "Tracks across sites — blocked in Strict mode"],
      };
    }
    // Unknown 3rd party in Strict:
    // Block only confirmed risky (High/Medium). Never auto-block "Unknown"
    // — unknown could be a CDN or first-load asset we can't classify yet.
    if (risk === "High") {
      return {
        action: "Block",
        tag: "HIGH RISK",
        tagColor: "#7f1d1d",
        tagBg: "#fee2e2",
        reasons: [
          "High-risk unknown third party",
          "Blocked in Strict mode",
          "Switch to Balanced if this breaks the page",
        ],
      };
    }
    if (risk === "Medium") {
      return {
        action: "Review",
        tag: "MEDIUM RISK",
        tagColor: "#92400e",
        tagBg: "#fef3c7",
        reasons: [
          "Medium-risk third party — purpose unclear",
          "Review before blocking — may affect page layout",
        ],
      };
    }
    // Unknown risk → educate, let user decide — never auto-break pages
    return {
      action: "Allow",
      tag: "UNCLASSIFIED",
      tagColor: "#374151",
      tagBg: "#f3f4f6",
      reasons: [
        "Could not classify this domain",
        "Allowed in Strict mode to prevent page breakage",
        "Enable Block manually if you confirm it is a tracker",
      ],
    };
  }

  // Fallback
  return { action: "Allow", tag: "UNKNOWN", tagColor: "#475569", tagBg: "#f1f5f9", reasons: ["Could not classify"] };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY PARSER (unchanged from before)
// ─────────────────────────────────────────────────────────────────────────────
export function parseRequestJourney(telemetry) {
  if (!telemetry || !telemetry.network || telemetry.network.length === 0) return [];

  const tabOpenTime = telemetry.metadata?.tabOpenTime || 0;
  const domainMap = new Map();

  telemetry.network.forEach(req => {
    if (!req.domain) return;

    let requestedBy = "Browser";
    if (req.initiator && req.initiator !== "unknown") {
      try {
        requestedBy = new URL(req.initiator).hostname.replace(/^www\./, "");
      } catch (_e) {
        requestedBy = req.initiator;
      }
    }

    if (!domainMap.has(req.domain)) {
      domainMap.set(req.domain, {
        domain: req.domain,
        firstSeen: req.firstSeen || tabOpenTime,
        requests: 0,
        cookies: 0,
        requestedBy,
        isThirdParty: req.isThirdParty,
        types: new Set(),
        trackerData: null,
      });
    }

    const info = domainMap.get(req.domain);
    info.requests += 1;
    if (req.firstSeen && req.firstSeen < info.firstSeen) info.firstSeen = req.firstSeen;
    if (req.resourceType) info.types.add(req.resourceType);
    if (requestedBy !== "Browser" && info.requestedBy === "Browser") info.requestedBy = requestedBy;
    if (req.threatData && !info.threatData) info.threatData = req.threatData;
  });

  (telemetry.cookies || []).forEach(cookie => {
    let d = cookie.domain;
    if (d.startsWith(".")) d = d.slice(1);
    if (domainMap.has(d)) {
      domainMap.get(d).cookies += 1;
    } else {
      for (const [key, info] of domainMap.entries()) {
        if (key.endsWith(d)) { info.cookies += 1; break; }
      }
    }
  });

  const trackers = telemetry.detectedTrackers || [];
  trackers.forEach(tracker => {
    for (const [domainKey, info] of domainMap.entries()) {
      if (domainKey === tracker.domain || domainKey.endsWith(`.${tracker.domain}`)) {
        info.trackerData = tracker;
      }
    }
  });

  const journey = Array.from(domainMap.values()).map(info => {
    let timeOffset = 0;
    if (tabOpenTime && info.firstSeen >= tabOpenTime) {
      timeOffset = (info.firstSeen - tabOpenTime) / 1000;
    }

    let purpose = "Essential/Unknown";
    let company = info.domain;

    if (info.threatData) {
      purpose = info.threatData.threatType || "Malware Distribution";
      company = info.threatData.source || info.domain;
    } else if (info.trackerData) {
      purpose = info.trackerData.purpose || "Advertising/Tracking";
      company = info.trackerData.company || info.domain;
    } else if (!info.isThirdParty) {
      purpose = "First-Party";
    } else {
      if (info.types.has("image") || info.types.has("media")) purpose = "CDN/Media";
      else if (info.types.has("font")) purpose = "Font Delivery";
      else if (info.types.has("script")) purpose = "External Script";
      else if (info.types.has("stylesheet")) purpose = "Styling";
    }

    return {
      domain: info.domain,
      company,
      purpose,
      timeOffset: timeOffset.toFixed(1),
      requests: info.requests,
      cookies: info.cookies,
      requestedBy: info.requestedBy,
      isThirdParty: info.isThirdParty,
      trackerData: info.trackerData,
      threatData: info.threatData,
      types: Array.from(info.types),
    };
  });

  journey.sort((a, b) => parseFloat(a.timeOffset) - parseFloat(b.timeOffset));
  return journey;
}
