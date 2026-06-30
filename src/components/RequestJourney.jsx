import { useState, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseRequestJourney } from '../services/requestJourneyParser';
import { Activity, MapPin, X, Link as LinkIcon, Network, Shield } from 'lucide-react';

// ── Hard-coded palette – immune to Chrome extension CSS-variable overrides ──
const C = {
  pageBg:       "#f8fafc",
  cardBg:       "#ffffff",
  surfaceBg:    "#f1f5f9",
  textPrimary:  "#0f172a",
  textSecond:   "#475569",
  textTertiary: "#94a3b8",
  textInverted: "#ffffff",
  indigo:       "#4f46e5",
  indigoBg:     "#eef2ff",
  indigoD:      "#4338ca",
  emerald:      "#10b981",
  emeraldBg:    "#ecfdf5",
  amber:        "#f59e0b",
  amberBg:      "#fffbeb",
  rose:         "#ef4444",
  roseBg:       "#fff1f2",
  borderLight:  "#f1f5f9",
  borderDef:    "#e2e8f0",
};

const containerVariants = {
  hidden: { opacity: 1 },
  show:   { opacity: 1, transition: { staggerChildren: 0.04 } }
};

const itemVariants = {
  hidden: { opacity: 0, x: -8 },
  show:   { opacity: 1, x: 0, transition: { type: "spring", stiffness: 400, damping: 28 } }
};

const RequestJourney = memo(function RequestJourney({ telemetry }) {
  const [selectedTracker, setSelectedTracker] = useState(null);

  const journeyData = useMemo(() => parseRequestJourney(telemetry), [telemetry]);

  if (!journeyData || journeyData.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100%", color: C.textTertiary, gap: 12, padding: 40, textAlign: "center", background: C.pageBg }}
      >
        <Network style={{ width: 40, height: 40, color: "#cbd5e1", opacity: 0.6 }} />
        <p style={{ fontWeight: 700, color: C.textSecond, fontSize: 14, margin: 0 }}>No network requests mapped yet.</p>
        <p style={{ fontSize: 12, color: C.textTertiary, margin: 0 }}>Observing real-time dependencies…</p>
      </motion.div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex",
      flexDirection: "column", background: C.pageBg, overflow: "hidden", fontFamily: "'Inter', sans-serif" }}>

      {/* Header */}
      <div style={{ padding: "14px 16px", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)", borderBottom: `1px solid ${C.borderDef}`, flexShrink: 0, position: "relative", zIndex: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 900, color: C.textPrimary, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <Activity style={{ width: 18, height: 18, color: C.indigo }} />
          Request Journey
        </h2>
        <p style={{ fontSize: 11, color: C.textSecond, margin: "3px 0 0", fontWeight: 500 }}>
          Live network lifecycle &amp; dependency map
        </p>
      </div>

      {/* Scrollable Timeline */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 80px 48px", position: "relative" }}>

        {/* Vertical SVG spine */}
        <svg
          style={{ position: "absolute", left: 28, top: 0, bottom: 0, width: 20, height: "100%", pointerEvents: "none", overflow: "visible" }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="spineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="50%" stopColor="#c7d2fe" />
              <stop offset="100%" stopColor="#f1f5f9" />
            </linearGradient>
          </defs>
          <line x1="10" y1="0" x2="10" y2="100%" stroke="url(#spineGrad)" strokeWidth="3" strokeLinecap="round" />
        </svg>

        <motion.div
          style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative", zIndex: 10 }}
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {journeyData.map((node, index) => {
            const isTracker    = !!node.trackerData;
            const isThreat     = !!node.threatData;
            const isFirstParty = !node.isThirdParty;
            const riskLevel    = node.trackerData?.riskLevel;

            // Dot color
            let dotBg = "#94a3b8", dotBorder = "#cbd5e1", dotGlow = "none";
            if (isThreat) {
              dotBg = "#ef4444"; dotBorder = "#fecaca"; dotGlow = "0 0 10px rgba(239,68,68,0.6)";
            } else if (isFirstParty) {
              dotBg = "#6366f1"; dotBorder = "#c7d2fe"; dotGlow = "0 0 8px rgba(99,102,241,0.45)";
            } else if (riskLevel === "High") {
              dotBg = "#f87171"; dotBorder = "#fecaca"; dotGlow = "0 0 8px rgba(251,113,133,0.5)";
            } else if (riskLevel === "Essential") {
              dotBg = "#34d399"; dotBorder = "#a7f3d0"; dotGlow = "0 0 8px rgba(52,211,153,0.4)";
            } else if (isTracker) {
              dotBg = "#fbbf24"; dotBorder = "#fde68a"; dotGlow = "0 0 8px rgba(251,191,36,0.4)";
            }

            // Card style
            let cardBg = C.cardBg, cardBorder = C.borderDef;
            let titleColor = C.textPrimary;
            if (isThreat)        { cardBg = "#fff1f2"; cardBorder = "#fecaca"; titleColor = "#7f1d1d"; }
            else if (isFirstParty) { cardBg = "#eef2ff"; cardBorder = "#c7d2fe"; titleColor = "#312e81"; }
            else if (riskLevel === "High")      { cardBg = C.cardBg; cardBorder = "#fecaca"; }
            else if (riskLevel === "Essential") { cardBg = C.cardBg; cardBorder = "#a7f3d0"; }
            else if (isTracker)  { cardBg = C.cardBg; cardBorder = "#fde68a"; }

            // Phase E: Calculate Blocking Outcome Explanation
            let blockOutcome = null;
            if (isThreat) {
              blockOutcome = { text: "BLOCKED (Threat)", bg: "#fee2e2", border: "#fca5a5", color: "#991b1b" };
            } else if (isTracker && !isFirstParty) {
              if (riskLevel === "Essential" || riskLevel === "Low") {
                blockOutcome = { text: "ALLOWED (Essential/Low Risk)", bg: "#d1fae5", border: "#6ee7b7", color: "#065f46" };
              } else {
                blockOutcome = { text: "BLOCKED (Tracker)", bg: "#ffedd5", border: "#fdba74", color: "#9a3412" };
              }
            } else if (isTracker && isFirstParty) {
              blockOutcome = { text: "ALLOWED (1st Party)", bg: "#e0e7ff", border: "#a5b4fc", color: "#3730a3" };
            }

            return (
              <motion.div
                variants={itemVariants}
                key={node.domain + index}
                style={{ display: "flex", alignItems: "flex-start", gap: 16, position: "relative" }}
              >
                {/* Dot + connector */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, marginTop: 14, width: 20, position: "relative" }}>
                  {/* Curved connector line from spine to dot */}
                  <svg width="24" height="24" style={{ position: "absolute", left: -14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                    <path d="M 0 12 C 10 12, 10 12, 14 12" fill="none" stroke={dotBg} strokeWidth="2" strokeOpacity="0.5" strokeDasharray="3 3" />
                  </svg>
                  <div style={{
                    width: 14, height: 14, borderRadius: "50%",
                    background: dotBg, border: `2.5px solid ${dotBorder}`,
                    boxShadow: dotGlow, flexShrink: 0, zIndex: 2
                  }} />
                  <span style={{ fontSize: 8, fontWeight: 800, color: C.textTertiary, marginTop: 3,
                    letterSpacing: "0.04em", lineHeight: 1 }}>{node.timeOffset}s</span>
                </div>

                {/* Card */}
                <div
                  onClick={() => isTracker && setSelectedTracker(node.trackerData)}
                  className={`glass-panel premium-shadow hover-lift ${isTracker ? "cursor-pointer" : ""}`}
                  style={{
                    flex: 1, borderRadius: 14, padding: "12px 14px",
                    background: cardBg, border: `1px solid ${cardBorder}`,
                    transition: "all 0.2s ease"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6, gap: 8 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 800, color: titleColor, margin: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                      {node.domain}
                    </h3>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                      color: C.textTertiary, background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.05)",
                      padding: "2px 7px", borderRadius: 6, flexShrink: 0, whiteSpace: "nowrap" }}>
                      {node.purpose}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
                    <LinkIcon style={{ width: 11, height: 11, color: "#a5b4fc", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: C.textSecond, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      req by: <strong style={{ color: C.textPrimary }}>{node.requestedBy}</strong>
                    </span>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                      background: C.cardBg, border: `1px solid ${C.borderDef}`, color: C.textSecond, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                      {node.requests} Req{node.requests !== 1 && "s"}
                    </span>
                    {node.cookies > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                        background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
                        {node.cookies} Cookie{node.cookies !== 1 && "s"}
                      </span>
                    )}
                    {node.isThirdParty && (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
                        background: C.surfaceBg, border: `1px solid ${C.borderDef}`, color: C.textTertiary,
                        textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        3rd Party
                      </span>
                    )}
                    {blockOutcome && (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
                        background: blockOutcome.bg, border: `1px solid ${blockOutcome.border}`, color: blockOutcome.color,
                        textTransform: "uppercase", letterSpacing: "0.06em", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                        {blockOutcome.text}
                      </span>
                    )}
                    {isThreat && (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
                        background: "#fff1f2", border: "1px solid #fecaca", color: "#b91c1c",
                        textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        ⚠ Threat
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Slide-Up Panel for Tracker Details */}
      <AnimatePresence initial={false}>
        {selectedTracker && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedTracker(null)}
              style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.2)",
                backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 40 }}
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              style={{ position: "absolute", bottom: 0, left: 0, right: 0,
                background: C.cardBg, borderRadius: "24px 24px 0 0",
                boxShadow: "0 -10px 40px -10px rgba(0,0,0,0.18)",
                borderTop: `1px solid ${C.borderLight}`, zIndex: 50,
                height: "75%", display: "flex", flexDirection: "column", overflow: "hidden",
                fontFamily: "'Inter', sans-serif" }}
            >
              {/* Panel Header */}
              <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${C.borderLight}`,
                flexShrink: 0, position: "relative",
                background: "linear-gradient(to bottom, #f8fafc, #ffffff)" }}>
                <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
                  width: 40, height: 4, background: C.borderDef, borderRadius: 100 }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 8 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 900, color: C.textPrimary, margin: "0 0 4px", letterSpacing: "-0.4px" }}>
                      {selectedTracker.company}
                    </h3>
                    <span style={{ fontSize: 10, color: C.textTertiary, fontFamily: "monospace",
                      background: C.surfaceBg, padding: "2px 8px", borderRadius: 6, display: "inline-block" }}>
                      {selectedTracker.domain}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedTracker(null)}
                    style={{ padding: 6, background: C.surfaceBg, border: "none", borderRadius: "50%",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      color: C.textSecond, transition: "background 0.15s", flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.background = C.borderDef}
                    onMouseLeave={e => e.currentTarget.style.background = C.surfaceBg}
                  >
                    <X style={{ width: 16, height: 16 }} />
                  </button>
                </div>
              </div>

              {/* Panel Content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Grid: Purpose + Origin */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ background: C.surfaceBg, padding: 14, borderRadius: 14, border: `1px solid ${C.borderLight}` }}>
                    <span style={{ display: "block", fontSize: 9, fontWeight: 800, color: C.textTertiary,
                      textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Purpose</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, lineHeight: 1.4 }}>
                      {selectedTracker.purpose}
                    </span>
                  </div>
                  <div style={{ background: C.surfaceBg, padding: 14, borderRadius: 14, border: `1px solid ${C.borderLight}` }}>
                    <span style={{ display: "block", fontSize: 9, fontWeight: 800, color: C.textTertiary,
                      textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Origin</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary, display: "flex", alignItems: "center", gap: 5 }}>
                      <MapPin style={{ width: 13, height: 13, color: "#a5b4fc" }} />
                      {selectedTracker.country || "Unknown"}
                    </span>
                  </div>
                </div>

                {/* Risk Level */}
                {(() => {
                  const rl = selectedTracker.riskLevel || "Unknown";
                  const riskStyle = rl === "High"
                    ? { bg: "#fff1f2", text: "#b91c1c", border: "#fecaca" }
                    : rl === "Essential"
                    ? { bg: "#ecfdf5", text: "#065f46", border: "#a7f3d0" }
                    : rl === "Medium"
                    ? { bg: "#fffbeb", text: "#92400e", border: "#fde68a" }
                    : { bg: C.surfaceBg, text: C.textSecond, border: C.borderDef };
                  return (
                    <div style={{ background: C.surfaceBg, padding: 14, borderRadius: 14, border: `1px solid ${C.borderLight}` }}>
                      <span style={{ display: "block", fontSize: 9, fontWeight: 800, color: C.textTertiary,
                        textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Privacy Risk Assessment</span>
                      <span style={{ display: "inline-block", padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 800,
                        background: riskStyle.bg, color: riskStyle.text, border: `1px solid ${riskStyle.border}` }}>
                        {rl} Risk
                      </span>
                    </div>
                  );
                })()}

                {/* Data Shared */}
                <div style={{ background: C.surfaceBg, padding: 14, borderRadius: 14, border: `1px solid ${C.borderLight}` }}>
                  <span style={{ display: "block", fontSize: 9, fontWeight: 800, color: C.textTertiary,
                    textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Data Logically Shared</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {["IP", "Browser", "Device", "Pages Visited"].map(d => (
                      <span key={d} style={{ padding: "3px 10px", background: C.cardBg, border: `1px solid ${C.borderDef}`,
                        borderRadius: 6, fontSize: 10, fontWeight: 700, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {d}
                      </span>
                    ))}
                    {selectedTracker.fingerprinting && (
                      <span style={{ padding: "3px 10px", background: "#fff1f2", border: "1px solid #fecaca",
                        borderRadius: 6, fontSize: 10, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Hardware Config
                      </span>
                    )}
                  </div>
                </div>

                {/* Confidence */}
                <div style={{ background: C.surfaceBg, padding: 14, borderRadius: 14, border: `1px solid ${C.borderLight}`, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em" }}>Intelligence Sources</span>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: C.cardBg, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.borderDef}` }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.textSecond }}>Confidence Score</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: C.indigo, background: C.indigoBg,
                      padding: "2px 10px", borderRadius: 8, border: "1px solid #c7d2fe" }}>
                      {Math.round((selectedTracker.confidence || 0) * 100)}%
                    </span>
                  </div>
                  <div style={{ background: C.cardBg, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.borderDef}`,
                    fontSize: 10, color: C.textSecond, fontWeight: 500, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 800, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "0.07em" }}>Sources: </span>
                    {(selectedTracker.sources || []).join(", ") || "Smart Inference"}
                  </div>
                </div>

                {/* Known Behaviors */}
                {selectedTracker.knownBehaviors && selectedTracker.knownBehaviors.length > 0 && (
                  <div style={{ background: C.surfaceBg, padding: 14, borderRadius: 14, border: `1px solid ${C.borderLight}` }}>
                    <span style={{ display: "block", fontSize: 9, fontWeight: 800, color: C.textTertiary,
                      textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Observed Behaviors</span>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                      {selectedTracker.knownBehaviors.map((b, i) => (
                        <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12,
                          fontWeight: 600, color: C.textSecond, background: C.cardBg, padding: "8px 12px",
                          borderRadius: 10, border: `1px solid ${C.borderDef}` }}>
                          <Activity style={{ width: 13, height: 13, color: "#f87171", flexShrink: 0 }} />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
});

export default RequestJourney;
