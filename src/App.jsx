import { Suspense, lazy, useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { explainTracker } from "./services/aiExplanationEngine";
import { ShieldCheck, Globe, Activity, Search, AlertTriangle, Eye, Server, MapPin, RefreshCw, Settings, GitMerge, List, ToggleLeft, ToggleRight, Cookie, BarChart2 } from "lucide-react";
const RequestJourney = lazy(() => import("./components/RequestJourney"));
const CookieDashboard = lazy(() => import("./components/CookieDashboard"));
const PermissionDetails = lazy(() => import("./components/PermissionDetails"));
import { parseRequestJourney, getRecommendation } from "./services/requestJourneyParser";

// ── Hard-coded color palette – immune to Chrome extension CSS-variable overrides ──
const C = {
  // Backgrounds
  pageBg:       "#f8fafc",  // slate-50
  cardBg:       "#ffffff",  // white
  surfaceBg:    "#f1f5f9",  // slate-100
  surfaceMid:   "#e2e8f0",  // slate-200
  indigoBg:     "#eef2ff",  // indigo-50
  indigoBgHov:  "#e0e7ff",  // indigo-100
  emeraldBg:    "#ecfdf5",  // emerald-50
  roseBg:       "#fff1f2",  // rose-50
  amberBg:      "#fffbeb",  // amber-50
  // Text
  textPrimary:  "#0f172a",  // slate-900
  textSecond:   "#475569",  // slate-600
  textTertiary: "#94a3b8",  // slate-400
  textInverted: "#ffffff",  // white
  // Brand
  indigo:       "#4f46e5",  // indigo-600
  indigoD:      "#4338ca",  // indigo-700
  // Status
  emerald:      "#10b981",  // emerald-500
  amber:        "#f59e0b",  // amber-500
  rose:         "#ef4444",  // rose-500
  roseD:        "#dc2626",  // rose-600
  // Borders
  borderLight:  "#f1f5f9",  // slate-100
  borderDef:    "#e2e8f0",  // slate-200
  borderIndigo: "#c7d2fe",  // indigo-200
  borderRose:   "#fecaca",  // rose-200
};

const pageVariants = {
  initial: { opacity: 0, y: 10, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, y: -10, scale: 0.96, transition: { duration: 0.2, ease: "easeIn" } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 }
};

function App() {
  const [tab, setTab] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [blockedState, setBlockedState] = useState({});
  const [blockingMode, setBlockingMode] = useState("Balanced");
  const [expandedTracker, setExpandedTracker] = useState(null);
  const [explanations, setExplanations] = useState({});
  const [isExplaining, setIsExplaining] = useState({});
  const [userActivity, setUserActivity] = useState("Idle Browsing");
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState("list");
  const [apiKey, setApiKey] = useState("");
  const [toast, setToast] = useState(null);
  const [selectedPermission, setSelectedPermission] = useState(null);
  const [aiProgress, setAiProgress] = useState("");
  const [diff, setDiff] = useState(null);
  const [weeklyStats, setWeeklyStats] = useState(null);
  const [isProtectionEnabled, setIsProtectionEnabled] = useState(true);

  useEffect(() => {
    chrome.storage.local.get(["geminiApiKey", "blockingMode", "weeklyStats"], (res) => {
      if (res.geminiApiKey) setApiKey(res.geminiApiKey);
      if (res.blockingMode) setBlockingMode(res.blockingMode);
      if (res.weeklyStats) setWeeklyStats(res.weeklyStats);
    });
    
    // Check protection state
    chrome.runtime.sendMessage({ type: "GET_PROTECTION_STATE" }, (res) => {
      if (res && res.isProtectionEnabled !== undefined) setIsProtectionEnabled(res.isProtectionEnabled);
    });
  }, []);

  const saveApiKey = () => {
    chrome.storage.local.set({ geminiApiKey: apiKey.trim() });
    setShowSettings(false);
  };
  
  const handleToggleProtection = () => {
    const newState = !isProtectionEnabled;
    chrome.runtime.sendMessage({ type: "TOGGLE_GLOBAL_PROTECTION", isEnabled: newState }, (res) => {
      if (res && res.isProtectionEnabled !== undefined) {
        setIsProtectionEnabled(res.isProtectionEnabled);
        setToast({ message: `Protection ${res.isProtectionEnabled ? 'Enabled' : 'Disabled'}.` });
        setTimeout(() => setToast(null), 3000);
      }
    });
  };

  const handleModeChange = (mode) => {
    setBlockingMode(mode);
    chrome.storage.local.set({ blockingMode: mode });
  };

  const handleExplain = async (idx, tracker) => {
    setIsExplaining(prev => ({ ...prev, [idx]: true }));
    setAiProgress("Initializing...");
    try {
      const result = await explainTracker({
        tab, telemetry, tracker,
        onProgress: (status) => setAiProgress(status)
      });
      setExplanations(prev => ({ ...prev, [idx]: result }));
    } catch (err) {
      setExplanations(prev => ({
        ...prev,
        [idx]: { error: err.message, source: "Error", purpose: "N/A", context: "N/A", impact: "Failed", recommendation: "Review" }
      }));
    } finally {
      setIsExplaining(prev => ({ ...prev, [idx]: false }));
      setAiProgress("");
    }
  };

  const fetchTelemetryData = async (isRescan = false) => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    if (!currentTab) return;
    setTab(currentTab);

    const messageType = isRescan ? "RESCAN_TELEMETRY" : "GET_TELEMETRY_DATA";

    // Fetch background telemetry + content-script permissions in parallel
    const [bgData, contentData] = await Promise.all([
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: messageType }, (data) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(data || null);
        });
      }),
      new Promise((resolve) => {
        chrome.tabs.sendMessage(currentTab.id, { type: "SCAN_STORAGE" }, (res) => {
          if (chrome.runtime.lastError) resolve({ permissions: {}, storage: {} });
          else resolve(res || { permissions: {}, storage: {} });
        });
      })
    ]);

    if (!bgData) return;

    // Merge permissions from content script (filter out "unsupported" entries)
    const rawPerms = contentData.permissions || {};
    const permissions = Object.fromEntries(
      Object.entries(rawPerms).filter(([, v]) => v !== "unsupported")
    );
    const merged = { ...bgData, permissions, storage: contentData.storage || {} };

    setTelemetry((prevTelemetry) => {
      if (isRescan && prevTelemetry) {
        const newTrackers = merged.detectedTrackers.length - prevTelemetry.detectedTrackers.length;
        const newCookies  = merged.cookies.length  - prevTelemetry.cookies.length;
        setDiff({ trackers: newTrackers, cookies: newCookies, timestamp: Date.now() });
        setTimeout(() => setDiff(null), 3000);
      }
      return merged;
    });

    if (merged.blockedState) setBlockedState(merged.blockedState);

    // Also fetch user activity
    chrome.tabs.sendMessage(currentTab.id, { type: "GET_USER_ACTIVITY" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.activity) setUserActivity(res.activity);
    });
  };


  useEffect(() => {
    fetchTelemetryData();
    const messageListener = (msg) => {
      if (msg.type === "BLOCK_STATE_UPDATED") setBlockedState(msg.state);
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, []);

  const journeyNodes = useMemo(() => parseRequestJourney(telemetry), [telemetry]);
  const actionables = useMemo(() => journeyNodes.filter(n => (n.trackerData || n.threatData) && !(n.company && n.company.includes("Unknown"))), [journeyNodes]);

  const handleToggleBlock = (domain, isBlocked, type = "permanent") => {
    chrome.runtime.sendMessage({ type: "TOGGLE_BLOCK", domain, isBlocked, blockType: type }, (newState) => {
      if (newState) setBlockedState(newState);
    });
  };

  const handleBlockAllRecommended = () => {
    const toBlock = [];
    actionables.forEach(node => {
      const rec = getRecommendation(node, tab?.url, blockingMode);
      if (rec.action === "Block" && !blockedState[node.domain]?.isBlocked) toBlock.push(node.domain);
    });
    if (toBlock.length > 0) {
      chrome.runtime.sendMessage({ type: "BLOCK_MULTIPLE", domains: toBlock, blockType: "permanent" }, (newState) => {
        if (newState) {
          setBlockedState(newState);
          setToast({
            message: `Blocked ${toBlock.length} recommended trackers.`,
            actionLabel: "Undo",
            onAction: () => {
              chrome.runtime.sendMessage({ type: "UNBLOCK_MULTIPLE", domains: toBlock }, (undoneState) => {
                if (undoneState) setBlockedState(undoneState);
                setToast(null);
              });
            }
          });
          setTimeout(() => setToast(null), 5000);
        }
      });
    }
  };

  const domain = tab ? new URL(tab.url).hostname.replace("www.", "") : "";

  // ── Settings Screen ──
  if (showSettings) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
        style={{ width: 450, height: 600, background: C.pageBg, padding: 16, fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: "column", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <button
            onClick={() => setShowSettings(false)}
            style={{ color: C.indigo, fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
          >← Back</button>
          <h2 style={{ color: C.textPrimary, fontSize: 18, fontWeight: 800, marginLeft: 16 }}>Settings</h2>
        </div>
        <div style={{ background: C.cardBg, borderRadius: 20, padding: 24, border: `1px solid ${C.borderDef}`, flex: 1, boxShadow: "0 4px 20px -2px rgba(15,23,42,0.07)" }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.textSecond, marginBottom: 8 }}>Cloud AI Provider</label>
          <select disabled style={{ width: "100%", background: C.pageBg, border: `1px solid ${C.borderDef}`, borderRadius: 12, padding: "12px 16px", fontSize: 14, marginBottom: 24, color: C.textPrimary }}>
            <option>Google Gemini API</option>
          </select>

          <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.textSecond, marginBottom: 8 }}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Paste your API key here..."
            style={{ width: "100%", border: `1px solid ${C.borderDef}`, borderRadius: 12, padding: "12px 16px", fontSize: 14, marginBottom: 24, outline: "none", background: C.pageBg, color: C.textPrimary, boxSizing: "border-box" }}
          />
          <button
            onClick={saveApiKey}
            style={{ width: "100%", background: C.indigo, color: C.textInverted, fontWeight: 700, padding: "12px 0", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 14, boxShadow: "0 4px 15px rgba(79,70,229,0.3)" }}
          >Save Settings</button>
        </div>
      </motion.div>
    );
  }

  // ── Main Screen ──
  return (
    <div style={{ width: 450, height: 600, background: C.pageBg, padding: 16, overflowY: "auto", fontFamily: "'Inter', sans-serif", position: "relative", boxSizing: "border-box", colorScheme: "light", color: C.textPrimary }}>
      <div style={{ background: C.cardBg, borderRadius: 24, padding: 20, minHeight: "calc(100% - 0px)", border: `1px solid ${C.borderLight}`, boxShadow: "0 4px 20px -2px rgba(15,23,42,0.06)", overflow: "hidden", position: "relative" }}>

        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 16, background: "linear-gradient(135deg,#4f46e5,#7c3aed)", boxShadow: "0 8px 20px rgba(79,70,229,0.3)" }}>
              <ShieldCheck style={{ width: 24, height: 24, color: "#fff" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: 0, letterSpacing: "-0.5px" }}>PrivacyLens</h1>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <button
                  onClick={() => fetchTelemetryData(true)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: C.indigoBg, color: C.indigo, border: `1px solid ${C.borderIndigo}`, borderRadius: 8, fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em" }}
                >
                  <RefreshCw style={{ width: 11, height: 11 }} />
                  Rescan
                </button>
                <AnimatePresence>
                  {diff && (
                    <motion.span initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} style={{ fontSize: 10, fontWeight: 700, color: C.emerald }}>
                      {diff.trackers > 0 ? `+${diff.trackers} Trackers` : diff.trackers < 0 ? `${diff.trackers} Trackers` : ""}
                      {diff.cookies > 0 ? ` +${diff.cookies} Cookies` : diff.cookies < 0 ? ` ${diff.cookies} Cookies` : ""}
                      {diff.trackers === 0 && diff.cookies === 0 ? " No changes" : ""}
                    </motion.span>
                  )}
                </AnimatePresence>
                {!diff && <p style={{ fontSize: 10, fontWeight: 700, color: C.textTertiary, letterSpacing: "0.08em", textTransform: "uppercase" }}>Tracker Intelligence</p>}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", background: C.surfaceBg, borderRadius: 12, padding: 4 }}>
              <button
                onClick={() => { setViewMode("flow"); setSelectedPermission(null); }}
                style={{ padding: 8, borderRadius: 8, border: "none", cursor: "pointer", background: viewMode === "flow" ? C.cardBg : "transparent", color: viewMode === "flow" ? C.indigo : C.textTertiary, boxShadow: viewMode === "flow" ? "0 1px 4px rgba(0,0,0,0.08)" : "none", display: "flex", alignItems: "center" }}
              >
                <GitMerge style={{ width: 16, height: 16 }} />
              </button>
              <button
                onClick={() => { setViewMode("list"); setSelectedPermission(null); }}
                style={{ padding: 8, borderRadius: 8, border: "none", cursor: "pointer", background: viewMode === "list" && !selectedPermission ? C.cardBg : "transparent", color: viewMode === "list" && !selectedPermission ? C.indigo : C.textTertiary, boxShadow: viewMode === "list" && !selectedPermission ? "0 1px 4px rgba(0,0,0,0.08)" : "none", display: "flex", alignItems: "center" }}
              >
                <List style={{ width: 16, height: 16 }} />
              </button>
              <button
                onClick={() => { setViewMode("cookies"); setSelectedPermission(null); }}
                style={{ padding: 8, borderRadius: 8, border: "none", cursor: "pointer", background: viewMode === "cookies" ? C.cardBg : "transparent", color: viewMode === "cookies" ? C.indigo : C.textTertiary, boxShadow: viewMode === "cookies" ? "0 1px 4px rgba(0,0,0,0.08)" : "none", display: "flex", alignItems: "center" }}
              >
                <Cookie style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div 
              onClick={handleToggleProtection}
              style={{ display: "flex", alignItems: "center", cursor: "pointer", gap: 8, background: isProtectionEnabled ? C.emeraldBg : C.roseBg, padding: "6px 12px", borderRadius: 100, border: `1px solid ${isProtectionEnabled ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`, transition: "all 0.2s ease", boxShadow: "0 2px 5px rgba(0,0,0,0.02)" }}
            >
              <div style={{ width: 34, height: 20, background: isProtectionEnabled ? C.emerald : C.rose, borderRadius: 100, position: "relative", transition: "all 0.3s ease" }}>
                 <motion.div 
                   initial={false}
                   animate={{ x: isProtectionEnabled ? 16 : 2 }}
                   style={{ width: 16, height: 16, background: "#fff", borderRadius: "50%", position: "absolute", top: 2, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} 
                 />
              </div>
              <span style={{ fontSize: 11, fontWeight: 800, color: isProtectionEnabled ? C.emerald : C.rose, textTransform: "uppercase", letterSpacing: "0.05em", width: 24, textAlign: "center" }}>
                {isProtectionEnabled ? "ON" : "OFF"}
              </span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              style={{ padding: 10, background: C.surfaceBg, color: C.textSecond, borderRadius: 12, border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <Settings style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        {/* Views */}
        <AnimatePresence mode="wait" initial={false}>
          {viewMode === "flow" && !selectedPermission && (
            <motion.div key="flow" variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ height: 480, margin: "0 -20px -20px", borderRadius: "0 0 24px 24px", overflow: "hidden", position: "relative", borderTop: `1px solid ${C.borderLight}`, background: C.pageBg }}>
              <Suspense fallback={<div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: C.textTertiary }}><RefreshCw style={{ width: 24, height: 24 }} /></div>}>
                <RequestJourney telemetry={telemetry} />
              </Suspense>
            </motion.div>
          )}

          {viewMode === "cookies" && !selectedPermission && (
            <motion.div key="cookies" variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ paddingBottom: 40 }}>
              <Suspense fallback={<div style={{ display: "flex", height: 160, alignItems: "center", justifyContent: "center", color: C.textTertiary }}><RefreshCw style={{ width: 24, height: 24 }} /></div>}>
                <CookieDashboard telemetry={telemetry} updateData={() => fetchTelemetryData(true)} />
              </Suspense>
            </motion.div>
          )}

          {selectedPermission && (
            <motion.div key="permissions" variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ margin: "0 -20px -20px" }}>
              <Suspense fallback={<div style={{ display: "flex", height: 160, alignItems: "center", justifyContent: "center", color: C.textTertiary }}><RefreshCw style={{ width: 24, height: 24 }} /></div>}>
                <PermissionDetails permission={selectedPermission.permission} state={selectedPermission.state} url={selectedPermission.url} onBack={() => setSelectedPermission(null)} />
              </Suspense>
            </motion.div>
          )}

          {viewMode === "list" && !selectedPermission && (
            <motion.div key="list" variants={pageVariants} initial="initial" animate="animate" exit="exit">

              {/* Security Signals */}
              {telemetry && (telemetry.security.knownMalware || telemetry.security.downloadedExecutable || telemetry.security.multipleRedirects || telemetry.security.mixedContent) && (
                <motion.section layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ marginBottom: 20, borderRadius: 20, background: C.cardBg, border: `1px solid rgba(239,68,68,0.2)`, padding: 16, boxShadow: "0 2px 8px rgba(239,68,68,0.05)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid rgba(239,68,68,0.1)` }}>
                    <AlertTriangle style={{ width: 18, height: 18, color: C.rose }} />
                    <h3 style={{ fontSize: 12, fontWeight: 800, color: "#7f1d1d", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>Security Signals Detected</h3>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {telemetry.security.knownMalware && (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fff1f2", padding: 12, borderRadius: 12, border: `1px solid #fecaca` }}>
                        <ShieldCheck style={{ width: 18, height: 18, color: C.rose, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 700, color: "#7f1d1d", margin: "0 0 2px" }}>Verified Malware Domain</p>
                          <p style={{ fontSize: 11, color: "#b91c1c", margin: 0, lineHeight: 1.5 }}>This site is present in the URLhaus threat intelligence database.</p>
                        </div>
                      </div>
                    )}
                    {telemetry.security.downloadedExecutable && (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fffbeb", padding: 12, borderRadius: 12, border: `1px solid #fde68a` }}>
                        <AlertTriangle style={{ width: 18, height: 18, color: C.amber, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 700, color: "#78350f", margin: "0 0 2px" }}>Executable Download Initiated</p>
                          <p style={{ fontSize: 11, color: "#92400e", margin: 0, lineHeight: 1.5 }}>The site initiated a download of an executable file.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.section>
              )}

              {/* Tracker Intelligence List */}
              {telemetry ? (
                <motion.div layout>
                  {/* Mode Selector */}
                  <div style={{ display: "flex", background: C.surfaceBg, borderRadius: 14, padding: 6, marginBottom: 16, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.04)" }}>
                    {["Safe", "Balanced", "Strict"].map(m => (
                      <button
                        key={m}
                        onClick={() => handleModeChange(m)}
                        style={{
                          flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer",
                          fontSize: 11, fontWeight: 700, letterSpacing: "0.03em",
                          background: blockingMode === m ? C.cardBg : "transparent",
                          color: blockingMode === m ? C.indigo : C.textTertiary,
                          boxShadow: blockingMode === m ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                          transform: blockingMode === m ? "scale(1.02)" : "scale(1)",
                          transition: "all 0.2s ease"
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* Block All Button */}
                  {actionables.some(n => getRecommendation(n, tab?.url, blockingMode).action === "Block" && !blockedState[n.domain]?.isBlocked) && (
                    <motion.button
                      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                      onClick={handleBlockAllRecommended}
                      whileHover={{ scale: 1.01, y: -1 }}
                      whileTap={{ scale: 0.99 }}
                      style={{ width: "100%", padding: "12px 0", background: C.indigo, color: C.textInverted, borderRadius: 14, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, boxShadow: "0 6px 20px rgba(79,70,229,0.35)", marginBottom: 20 }}
                    >
                      Block All Recommended
                    </motion.button>
                  )}

                  {/* Tracker List */}
                  {actionables.length === 0 ? (
                    <div style={{ borderRadius: 20, border: `2px dashed ${C.borderDef}`, background: C.pageBg, padding: 32, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                      <ShieldCheck style={{ width: 48, height: 48, color: "#6ee7b7", marginBottom: 12 }} />
                      <p style={{ fontSize: 14, fontWeight: 700, color: C.textSecond, margin: "0 0 4px" }}>No known trackers detected yet.</p>
                      <p style={{ fontSize: 12, color: C.textTertiary, margin: 0 }}>Telemetry engine is actively monitoring.</p>
                    </div>
                  ) : (
                    <motion.div layout style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <AnimatePresence initial={false}>
                        {actionables.map((node, idx) => {
                          const isExpanded = expandedTracker === idx;
                          const rec = getRecommendation(node, tab?.url, blockingMode);
                          const isBlocked = !!blockedState[node.domain]?.isBlocked;
                          const blockType = blockedState[node.domain]?.type || "permanent";

                          const recColor = rec.action === "Allow"
                            ? { bg: "#ecfdf5", text: "#065f46", border: "#a7f3d0" }
                            : rec.action === "Review"
                            ? { bg: "#fffbeb", text: "#78350f", border: "#fde68a" }
                            : { bg: "#fff1f2", text: "#7f1d1d", border: "#fecaca" };

                          const riskColor = node.trackerData?.riskLevel === "High"
                            ? { bg: "#fff1f2", text: "#b91c1c", border: "#fecaca" }
                            : node.trackerData?.riskLevel === "Medium"
                            ? { bg: "#fffbeb", text: "#92400e", border: "#fde68a" }
                            : { bg: "#ecfdf5", text: "#065f46", border: "#a7f3d0" };

                          return (
                            <motion.div
                              layout
                              key={idx}
                              variants={itemVariants}
                              initial="hidden"
                              animate="visible"
                              style={{
                                borderRadius: 16,
                                border: `1px solid ${isExpanded ? C.borderIndigo : C.borderDef}`,
                                background: C.cardBg,
                                overflow: "hidden",
                                boxShadow: isExpanded ? "0 8px 30px rgba(79,70,229,0.12)" : "0 1px 4px rgba(15,23,42,0.04)",
                                outline: isExpanded ? `3px solid rgba(79,70,229,0.08)` : "none",
                                transition: "all 0.25s ease"
                              }}
                            >
                              {/* Tracker Row */}
                              <div
                                style={{ padding: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                                onClick={() => setExpandedTracker(isExpanded ? null : idx)}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                  <div style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: 40, height: 40, borderRadius: 12, fontWeight: 700, fontSize: 14,
                                    background: isBlocked ? "#fff1f2" : C.surfaceBg,
                                    color: isBlocked ? "#b91c1c" : C.textSecond,
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
                                  }}>
                                    {node.company.charAt(0)}
                                  </div>
                                  <div>
                                    <p style={{ fontSize: 14, fontWeight: 700, color: isBlocked ? C.textTertiary : C.textPrimary, margin: "0 0 2px", textDecoration: isBlocked ? "line-through" : "none" }}>
                                      {node.company}
                                    </p>
                                    <p style={{ fontSize: 11, color: C.textTertiary, fontFamily: "monospace", margin: 0, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {node.domain}
                                    </p>
                                  </div>
                                </div>
                                <span style={{
                                  display: "inline-block", padding: "4px 10px", borderRadius: 8,
                                  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                                  background: isBlocked ? C.roseBg
                                    : node.trackerData?.purpose ? C.indigoBg : C.surfaceBg,
                                  color: isBlocked ? C.roseD
                                    : node.trackerData?.purpose ? C.indigo : C.textSecond,
                                  border: `1px solid ${isBlocked ? C.borderRose
                                    : node.trackerData?.purpose ? C.borderIndigo : C.borderDef}`,
                                }}>
                                  {isBlocked ? "🚫 Blocked" : (node.trackerData?.purpose || "Unclassified")}
                                </span>
                              </div>

                              {/* Expanded Detail */}
                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    style={{ background: C.pageBg, borderTop: `1px solid ${C.borderLight}`, overflow: "hidden" }}
                                  >
                                    <div style={{ padding: 16 }}>
                                      {/* Grid: Details */}
                                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                                        <div>
                                          <p style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>Parent Entity</p>
                                          <p style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600, margin: 0 }}>{node.trackerData?.parentCompany || "Unknown"}</p>
                                        </div>
                                        <div>
                                          <p style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 4 }}>
                                            <MapPin style={{ width: 11, height: 11 }} /> Origin
                                          </p>
                                          <p style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600, margin: 0 }}>{node.trackerData?.country || "Unknown"}</p>
                                        </div>
                                        <div>
                                          <p style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>Detection Source</p>
                                          <p style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600, margin: 0 }}>{node.trackerData?.source || "Heuristic Analysis"}</p>
                                        </div>
                                        <div>
                                          <p style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>Confidence</p>
                                          <p style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600, margin: 0 }}>{node.trackerData?.confidence ? `${(node.trackerData.confidence * 100).toFixed(0)}%` : "High"}</p>
                                        </div>
                                      </div>

                                      {/* Risk Panel */}
                                      <div style={{ background: C.cardBg, border: `1px solid ${C.borderDef}`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
                                        <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                          <span style={{ padding: "4px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700, background: riskColor.bg, color: riskColor.text, border: `1px solid ${riskColor.border}` }}>
                                            Privacy Risk: {node.trackerData?.riskLevel || "Unknown"}
                                          </span>
                                          <span style={{ fontSize: 10, fontWeight: 700, color: recColor.text, background: recColor.bg, border: `1px solid ${recColor.border}`, padding: "4px 10px", borderRadius: 8 }}>
                                            Recommendation: {rec.action}
                                          </span>
                                        </div>
                                        <ul style={{ fontSize: 11, color: C.textSecond, margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                                          {node.trackerData?.fingerprinting && (
                                            <li style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <span style={{ color: C.indigo }}>✓</span> Fingerprinting capability
                                            </li>
                                          )}
                                          {(node.trackerData?.knownBehaviors || []).map(b => (
                                            <li key={b} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <span style={{ color: C.indigo }}>✓</span> {b}
                                            </li>
                                          ))}
                                          {!(node.trackerData?.fingerprinting) && !(node.trackerData?.knownBehaviors?.length) && (
                                            <li style={{ color: C.textTertiary }}>No specific behavioral data recorded.</li>
                                          )}
                                        </ul>
                                      </div>

                                      {/* Removed Smart Recommendation Buttons to avoid redundancy */}

                                      {/* AI Explanation */}
                                      <div style={{ marginBottom: 16 }}>
                                        {!explanations[idx] ? (
                                          <button
                                            onClick={e => { e.stopPropagation(); handleExplain(idx, node.trackerData); }}
                                            disabled={isExplaining[idx]}
                                            style={{ width: "100%", padding: "12px 0", borderRadius: 12, background: C.indigoBg, color: C.indigo, fontWeight: 700, fontSize: 12, border: `1px solid ${C.borderIndigo}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: isExplaining[idx] ? 0.6 : 1 }}
                                          >
                                            {isExplaining[idx] ? (
                                              <>
                                                <div style={{ width: 14, height: 14, border: `2px solid ${C.indigo}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                                                <span>{aiProgress || "Generating Intelligence..."}</span>
                                              </>
                                            ) : "Explain Tracker Context"}
                                          </button>
                                        ) : (
                                          <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} style={{ background: C.cardBg, borderRadius: 12, padding: 16, border: `1px solid ${C.borderIndigo}`, boxShadow: "0 4px 12px rgba(79,70,229,0.08)", position: "relative" }}>
                                            <div style={{ position: "absolute", top: -10, right: -8, background: explanations[idx].source === "Local AI" ? C.indigo : C.emerald, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 100 }}>
                                              {explanations[idx].source || "AI"}
                                            </div>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                              <div>
                                                <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Purpose</span>
                                                <span style={{ fontSize: 12, color: C.textPrimary, fontWeight: 600, lineHeight: 1.6 }}>{explanations[idx].purpose}</span>
                                              </div>
                                              <div>
                                                <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Context</span>
                                                <span style={{ fontSize: 12, color: C.textSecond, lineHeight: 1.6 }}>{explanations[idx].context}</span>
                                              </div>
                                            </div>
                                          </motion.div>
                                        )}
                                      </div>

                                      {/* Action Controls */}
                                      <div style={{ paddingTop: 16, borderTop: `1px solid ${C.borderDef}` }}>
                                        <p style={{ fontWeight: 700, color: C.textPrimary, margin: "0 0 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                                          <ShieldCheck style={{ width: 14, height: 14, color: C.indigo }} />
                                          Tracker Controls
                                        </p>

                                        <div style={{ background: C.cardBg, padding: 12, borderRadius: 12, border: `1px solid ${C.borderDef}`, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                                          <div>
                                            <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>Recommendation</span>
                                            <div style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, fontWeight: 700, background: recColor.bg, color: recColor.text, border: `1px solid ${recColor.border}`, display: "inline-flex", alignItems: "center", gap: 6 }}>
                                              {rec.action === "Allow" ? "🟢 Allow" : rec.action === "Review" ? "🟡 Review" : "🔴 Block"}
                                            </div>
                                          </div>
                                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                                            <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 }}>Action</span>
                                            <select
                                              value={isBlocked ? blockType : "allow"}
                                              onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === "allow") {
                                                  handleToggleBlock(node.domain, false);
                                                } else {
                                                  handleToggleBlock(node.domain, true, val);
                                                }
                                              }}
                                              onClick={e => e.stopPropagation()}
                                              style={{
                                                padding: "6px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                                                background: isBlocked ? C.roseBg : C.surfaceBg,
                                                color: isBlocked ? C.roseD : C.textPrimary,
                                                border: `1px solid ${isBlocked ? C.borderRose : C.borderDef}`,
                                                outline: "none", cursor: "pointer"
                                              }}
                                            >
                                              <option value="allow">Allow</option>
                                              <option value="session">Block (This Session)</option>
                                              <option value="permanent">Block (Forever)</option>
                                            </select>
                                          </div>
                                          {isBlocked && (
                                            <div style={{ width: "100%", marginTop: 4 }}>
                                              <span style={{ fontSize: 10, color: C.textTertiary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Why it was blocked</span>
                                              <span style={{ fontSize: 11, color: C.roseD }}>{rec.reason || "Manually blocked by user."}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </motion.div>
                  )}

                  {/* Site Permissions */}
                  <div style={{ marginTop: 32, paddingTop: 20, borderTop: `1px solid ${C.borderLight}` }}>
                    <h3 style={{ fontSize: 14, fontWeight: 800, color: C.textPrimary, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
                      <ShieldCheck style={{ width: 16, height: 16, color: C.emerald }} />
                      Site Permissions
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {Object.entries(telemetry.permissions || {}).map(([perm, state]) => {
                        let badge = { bg: C.pageBg, text: C.textSecond, border: C.borderDef };
                        if (state === "granted") badge = { bg: "#ecfdf5", text: "#065f46", border: "#a7f3d0" };
                        else if (state === "prompt") badge = { bg: "#fffbeb", text: "#92400e", border: "#fde68a" };
                        else if (state === "denied") badge = { bg: "#fff1f2", text: "#b91c1c", border: "#fecaca" };

                        const formatPerm = (p) => {
                          if (p === "geolocation") return "Location";
                          if (p === "clipboard-read") return "Clipboard Read";
                          if (p === "clipboard-write") return "Clipboard Write";
                          return p.charAt(0).toUpperCase() + p.slice(1);
                        };
                        
                        const getSubtitle = (p) => {
                          if (p === 'camera' || p === 'microphone') return 'Can capture audio/video';
                          if (p === 'geolocation') return 'Can track physical location';
                          if (p === 'notifications') return 'Can send desktop alerts';
                          if (p === 'clipboard-read') return 'Can read copied text';
                          return 'Hardware or data access';
                        };

                        return (
                          <motion.button
                            key={perm}
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                            onClick={() => setSelectedPermission({ permission: perm, state, url: tab.url })}
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: 12, background: C.cardBg, border: `1px solid ${C.borderDef}`, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}
                          >
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{formatPerm(perm)}</div>
                              <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>{getSubtitle(perm)}</div>
                            </div>
                            <span style={{ fontSize: 10, padding: "4px 10px", borderRadius: 8, background: badge.bg, color: badge.text, border: `1px solid ${badge.border}`, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {state}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div style={{ marginTop: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
                    <Search style={{ width: 40, height: 40, color: "#c7d2fe", marginBottom: 16 }} />
                  </motion.div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: C.textSecond, margin: "0 0 16px" }}>Initializing Telemetry Engine...</p>
                  <div style={{ width: 192, height: 6, background: C.surfaceBg, borderRadius: 100, overflow: "hidden", position: "relative" }}>
                    <motion.div
                      style={{ position: "absolute", top: 0, bottom: 0, width: "40%", background: C.indigo, borderRadius: 100 }}
                      animate={{ left: ["-20%", "100%"] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1e293b", color: "#fff", padding: "12px 20px", borderRadius: 14, boxShadow: "0 8px 30px rgba(0,0,0,0.25)", display: "flex", alignItems: "center", gap: 16, fontSize: 12, zIndex: 50, fontWeight: 500 }}
          >
            <span>{toast.message}</span>
            {toast.actionLabel && (
              <button onClick={toast.onAction} style={{ color: "#818cf8", fontWeight: 700, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
                {toast.actionLabel}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        :root, html, body { color-scheme: light !important; background: #f8fafc !important; color: #0f172a !important; }
        /* Force all text colours to be visible regardless of dark-mode injection */
        p, h1, h2, h3, h4, span, div, button, input, label, li {
          color: inherit;
        }
      `}</style>
    </div>
  );
}

export default App;