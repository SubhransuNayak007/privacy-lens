# PrivacyLens 👁️🛡️

> **The ultimate real-time privacy, tracker detection, and network analysis dashboard for Google Chrome.**

![PrivacyLens Interface](https://raw.githubusercontent.com/subhransunayak007/privacy-lens/main/public/icon48.png) <!-- Update with actual screenshots -->

PrivacyLens is a powerful, beautifully designed Chrome Extension that lifts the veil on what websites are doing behind the scenes. Built for modern browsers, it monitors network requests, intercepts cross-site tracking, analyzes browser fingerprinting attempts, and provides AI-powered explanations for complex privacy threats.

## ✨ Features

- **Live Request Journey Mapping**: Visualizes the lifecycle of network requests, highlighting first-party, third-party, and identified tracker requests in a beautiful timeline.
- **Tracker Intelligence**: Integrates with robust databases (DuckDuckGo, Disconnect, EasyPrivacy) to detect and classify over 46,000 known trackers and 400+ security threats.
- **AI Explanation Engine**: Uses Google's Gemini AI to analyze trackers on the fly and explain *what* data they collect and *why*, in simple human terms.
- **Declarative Net Request Blocking**: Block malicious or invasive trackers instantly at the network level using Chrome's MV3 DeclarativeNetRequest API.
- **Advanced Cookie Dashboard**: Maps which domains are setting which cookies, monitoring their persistence and risk levels.
- **Site Permissions & Fingerprinting**: Scans the page for local storage usage (IndexedDB, Service Workers, Caches) and live permission requests (Camera, Location, etc.).
- **Premium UI/UX**: Built with React, Tailwind CSS, and Framer Motion, offering an experience that feels native, snappy, and delightfully smooth.

## 🛠 Tech Stack

- **Frontend:** React 18, Vite, Framer Motion, Tailwind CSS, Lucide React
- **Extension APIs:** Manifest V3, Service Workers, declarativeNetRequest, chrome.storage.session
- **Backend/AI:** Google Gemini API (for AI explanations)
- **Database:** Curated JSON databases built from multiple open-source blocklists via custom Node scripts.

## 🚀 Getting Started

Follow these steps to build and install PrivacyLens locally on your machine.

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Google Chrome browser

### Installation & Build

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/privacy-lens.git
   cd privacy-lens
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the Tracker Databases:**
   PrivacyLens uses a massive database of trackers. You must build the optimized JSON files before compiling the extension:
   ```bash
   npm run build:db
   ```
   *This fetches the latest lists from DuckDuckGo, AdGuard, EasyPrivacy, and URLhaus and compiles them into `public/trackerDatabase.json` and `public/securityDatabase.json`.*

4. **Build the Extension:**
   ```bash
   npm run build
   ```
   *This will generate a `dist` folder containing the compiled Chrome extension.*

### Loading into Chrome

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top right corner).
3. Click on **Load unpacked**.
4. Select the `dist` folder generated inside the `privacy-lens` directory.
5. 🎉 PrivacyLens is now installed! Pin it to your toolbar and open it on any webpage.

## 🧠 How It Works

1. **Content Script (`content.js`)**: Monitors page-level behavior like form interactions, canvas fingerprinting attempts, and API permission queries (`navigator.permissions`).
2. **Background Worker (`background.js`)**: Uses `chrome.webRequest` to intercept and analyze all network traffic in real-time, matching it against the compiled tracker databases. It stores this state in memory and persists to `chrome.storage.session` for MV3 lifecycle resilience.
3. **Block Engine (`blockEngine.js`)**: Translates user blocking preferences into dynamic `declarativeNetRequest` rules, stopping network requests before they even hit the browser engine.
4. **Popup UI (`App.jsx`)**: Connects 

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check the [issues page](https://github.com/yourusername/privacy-lens/issues).

