import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,

  name: "Privacy Lens",

  description: "The Browser Knows Too Much",

  version: "1.0.0",

  action: {
    default_popup: "index.html",
    default_title: "Privacy Lens",
    default_icon: {
      "16": "icon.png",
      "32": "icon.png",
      "48": "icon.png",
      "128": "icon.png"
    }
  },

  icons: {
    "16": "icon.png",
    "32": "icon.png",
    "48": "icon.png",
    "128": "icon.png"
  },

  permissions: [
    "storage",
    "unlimitedStorage",
    "tabs",
    "activeTab",
    "scripting",
    "webRequest",
    "webNavigation",
    "cookies",
    "declarativeNetRequest",
    "offscreen"
  ],

  host_permissions: [
    "<all_urls>"
  ],

  background: {
    service_worker: "src/background/background.js",
    type: "module"
  },

  content_scripts: [
    // ── MAIN world: fingerprint & network interceptors — runs BEFORE any page script ──
    {
      matches: ["<all_urls>"],
      js: ["src/inject/fingerprintInterceptor.js", "src/inject/networkInterceptor.js"],
      run_at: "document_start",
      world: "MAIN"
    },
    // ── Isolated world: cosmetic filter + content script bridge ──
    // document_start = CSS injected BEFORE ads can render (no ad flash)
    // all_frames = also applies inside iframes (ad containers)
    {
      matches: ["<all_urls>"],
      js: ["src/content/content.js"],
      run_at: "document_start",
      all_frames: true
    }
  ],

  // Required for MAIN world script to be accessible
  web_accessible_resources: [
    {
      resources: ["src/inject/fingerprintInterceptor.js", "src/inject/networkInterceptor.js"],
      matches: ["<all_urls>"]
    }
  ],

  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
});