import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useMemo } from "react";
import {
  ShieldCheck, Eye, AlertTriangle, Brain, Fingerprint,
  MapPin, ShoppingCart, User, Activity, Zap, Lock, Unlock,
  TrendingUp, Globe, Cpu, Database, Scan, Wifi, MonitorSmartphone,
  Music, Type
} from "lucide-react";

// ── Build the digital shadow from telemetry ──────────────────────────────────
function buildShadowProfile(telemetry, domain) {
  if (!telemetry) return null;

  const trackers = telemetry.detectedTrackers || [];
  const cookies = telemetry.cookies || [];
  const network = telemetry.network || [];
  const permissions = telemetry.permissions || {};
  const fp = telemetry.fpDetection || null; // ← real behavioral FP data

  // ── Category tallies ──
  const cats = trackers.map(t => (t.category || t.purpose || "").toLowerCase()).join(" ");
  const hasAds        = cats.includes("advertis") || cats.includes("retarget") || cats.includes("affiliate");
  const hasAnalytics  = cats.includes("analytic") || cats.includes("session") || cats.includes("heatmap");
  const hasSocial     = cats.includes("social") || cats.includes("facebook") || cats.includes("twitter");
  // Use REAL behavioral detection if available, fall back to list-based
  const hasFingerprint = (fp && fp.totalScore >= 30) || trackers.some(t => t.fingerprinting);
  const hasLocation   = permissions.geolocation === "granted";
  const hasCamera     = permissions.camera === "granted";
  const hasMic        = permissions.microphone === "granted";
  const hasClip       = permissions["clipboard-read"] === "granted";

  const thirdPartyCookies = cookies.filter(c => !c.isFirstParty);
  const persistentCookies = cookies.filter(c => c.expiry !== "session" && !c.isFirstParty);
  const trackerDomains    = [...new Set(trackers.map(t => t.domain))];
  const companies         = [...new Set(trackers.map(t => t.company).filter(Boolean))];

  // ── Privacy Score (0–100, lower = worse) ──
  let score = 100;
  score -= Math.min(trackers.length * 4, 32);
  score -= Math.min(thirdPartyCookies.length * 2, 20);
  // Use real FP score for penalisation — more nuanced than binary
  if (fp && fp.totalScore > 0) {
    score -= Math.round((fp.totalScore / 100) * 20);
  } else if (hasFingerprint) {
    score -= 20;
  }
  score -= hasAds ? 8 : 0;
  score -= hasSocial ? 6 : 0;
  score -= hasLocation ? 10 : 0;
  score -= hasCamera ? 8 : 0;
  score -= telemetry.security?.knownMalware ? 20 : 0;
  score = Math.max(0, Math.min(100, score));

  // ── Inferred demographic signals ──
  const interests = [];
  const knownBehaviors = trackers.flatMap(t => t.knownBehaviors || []);
  const catWords = cats + " " + knownBehaviors.join(" ").toLowerCase();

  if (catWords.includes("shop") || catWords.includes("commerce") || catWords.includes("retail")) interests.push("Online Shopping");
  if (catWords.includes("travel") || catWords.includes("flight") || catWords.includes("hotel")) interests.push("Travel");
  if (catWords.includes("news") || catWords.includes("media") || catWords.includes("content")) interests.push("News & Media");
  if (catWords.includes("finance") || catWords.includes("invest") || catWords.includes("bank")) interests.push("Finance");
  if (catWords.includes("tech") || catWords.includes("software") || catWords.includes("developer")) interests.push("Technology");
  if (catWords.includes("health") || catWords.includes("medical") || catWords.includes("pharma")) interests.push("Health");
  if (catWords.includes("game") || catWords.includes("gaming") || catWords.includes("entertainment")) interests.push("Gaming");
  if (interests.length === 0) interests.push("General Browsing");

  // ── Data exposure items ──
  const exposures = [];
  if (hasFingerprint) exposures.push({ icon: Fingerprint, label: "Device fingerprint captured", severity: "critical", color: "#ef4444" });
  if (hasAds) exposures.push({ icon: ShoppingCart, label: "Purchase intent profiled", severity: "high", color: "#f97316" });
  if (hasSocial) exposures.push({ icon: User, label: "Social identity linked", severity: "high", color: "#f97316" });
  if (hasAnalytics) exposures.push({ icon: Eye, label: "Session behavior recorded", severity: "medium", color: "#eab308" });
  if (hasLocation) exposures.push({ icon: MapPin, label: "Physical location exposed", severity: "critical", color: "#ef4444" });
  if (hasCamera) exposures.push({ icon: Eye, label: "Camera access granted", severity: "critical", color: "#ef4444" });
  if (hasMic) exposures.push({ icon: Activity, label: "Microphone access granted", severity: "critical", color: "#ef4444" });
  if (hasClip) exposures.push({ icon: Database, label: "Clipboard content readable", severity: "high", color: "#f97316" });
  if (persistentCookies.length > 0) exposures.push({ icon: Database, label: `${persistentCookies.length} persistent tracking cookies`, severity: "high", color: "#f97316" });
  if (telemetry.security?.knownMalware) exposures.push({ icon: AlertTriangle, label: "Known malware domain detected", severity: "critical", color: "#ef4444" });
  if (telemetry.security?.mixedContent) exposures.push({ icon: Unlock, label: "Unsecured mixed content", severity: "medium", color: "#eab308" });

  // ── Companies receiving data ──
  const topCompanies = companies.slice(0, 5);

  return {
    score,
    trackerCount: trackers.length,
    cookieCount: cookies.length,
    thirdPartyCookieCount: thirdPartyCookies.length,
    trackerDomainCount: trackerDomains.length,
    companyCount: companies.length,
    topCompanies,
    interests,
    exposures,
    hasFingerprint,
    hasAds,
    hasSocial,
    hasAnalytics,
    domain,
    requestCount: network.length,
    dataPoints: exposures.length,
    fpDetection: fp, // pass through for the FP card
  };
}


// ── Animated Privacy Score Ring ──────────────────────────────────────────────
function ScoreRing({ score, size = 64 }) {
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const fill = circ * (score / 100);
  
  const getGradient = (s) => {
    if (s >= 70) return ["#34d399", "#059669"]; // emerald
    if (s >= 40) return ["#fbbf24", "#d97706"]; // amber
    return ["#f87171", "#dc2626"]; // rose
  };
  const [colorLight, colorDark] = getGradient(score);
  const label = score >= 70 ? "Safe" : score >= 40 ? "Risky" : "Exposed";

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.1))" }}>
        <defs>
          <linearGradient id={`score-grad-${score}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorLight} />
            <stop offset="100%" stopColor={colorDark} />
          </linearGradient>
          <filter id={`glow-${score}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(226, 232, 240, 0.5)" strokeWidth={5} />
        <motion.circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={`url(#score-grad-${score})`} strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circ}
          filter={`url(#glow-${score})`}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - fill }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", transform: "translateY(1px)"
      }}>
        <motion.span
          initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6, type: "spring" }}
          style={{ fontSize: 16, fontWeight: 900, color: colorDark, lineHeight: 1, letterSpacing: "-0.5px" }}
        >{score}</motion.span>
        <span style={{ fontSize: 7.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>{label}</span>
      </div>
    </div>
  );
}

// ── Technique label + icon map ────────────────────────────────────────────────
const TECH_META = {
  canvas:    { label: "Canvas API",       icon: MonitorSmartphone, color: "#f97316" },
  webgl:     { label: "WebGL GPU Probe",  icon: Cpu,               color: "#8b5cf6" },
  audio:     { label: "AudioContext",     icon: Music,             color: "#06b6d4" },
  navigator: { label: "Navigator Props",  icon: Globe,             color: "#10b981" },
  screen:    { label: "Screen Profile",   icon: MonitorSmartphone, color: "#3b82f6" },
  webrtc:    { label: "WebRTC IP Leak",   icon: Wifi,              color: "#ef4444" },
  fonts:     { label: "Font Enum",        icon: Type,              color: "#f59e0b" },
};

// ── Behavioral Fingerprint Detection Card (Hybrid) ───────────────────────────
function FingerprintDetectionCard({ fp }) {
  if (!fp) return null;

  const hasListHits     = (fp.listHits     || []).length > 0;
  const hasZeroDay      = (fp.zeroDayDiscoveries || []).length > 0;
  const hasAnyDetection = hasListHits || hasZeroDay || fp.totalScore > 0;
  const techniques      = fp.techniques || [];

  const confColor = {
    CONFIRMED:  "#ef4444", LIKELY: "#f97316",
    SUSPICIOUS: "#eab308", CLEAN:  "#10b981",
  }[fp.confidence || "CLEAN"];

  const confBg = {
    CONFIRMED:  "#fff1f2", LIKELY: "#fff7ed",
    SUSPICIOUS: "#fefce8", CLEAN:  "#f0fdf4",
  }[fp.confidence || "CLEAN"];

  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2 }}
      style={{
        background: "#fff",
        borderRadius: 18,
        border: `1px solid ${hasZeroDay ? "#fecaca" : "#e2e8f0"}`,
        padding: "16px 18px",
        marginBottom: 12,
        boxShadow: hasZeroDay
          ? "0 2px 16px rgba(239,68,68,0.12)"
          : "0 2px 12px rgba(15,23,42,0.06)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "linear-gradient(135deg, #ede9fe, #ddd6fe)",
          border: "1px solid #c4b5fd",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Scan style={{ width: 14, height: 14, color: "#7c3aed" }} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, color: "#0f172a", letterSpacing: "0.03em" }}>
            BEHAVIORAL FINGERPRINT SCAN
          </div>
          <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>
            Hybrid: database lookup + live API interception
          </div>
        </div>
        {fp.confidence && (
          <span style={{
            marginLeft: "auto", padding: "3px 10px", borderRadius: 6,
            fontSize: 9, fontWeight: 800,
            background: confBg, color: confColor,
            border: `1px solid ${confColor}40`,
            textTransform: "uppercase", letterSpacing: "0.1em",
          }}>
            {fp.confidence}
          </span>
        )}
      </div>

      {/* No detection */}
      {!hasAnyDetection && (
        <div style={{
          textAlign: "center", padding: "14px 0",
          color: "#10b981", fontSize: 12, fontWeight: 700,
        }}>
          <ShieldCheck style={{ width: 22, height: 22, margin: "0 auto 6px", display: "block" }} />
          No fingerprinting APIs intercepted on this page
        </div>
      )}

      {/* Intercepted techniques */}
      {techniques.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Intercepted Techniques ({techniques.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {techniques.map((tech, i) => {
              const m = TECH_META[tech] || { label: tech, icon: Scan, color: "#64748b" };
              return (
                <motion.div
                  key={tech}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.25 + i * 0.06 }}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 20,
                    background: `${m.color}15`,
                    border: `1px solid ${m.color}40`,
                  }}
                >
                  <m.icon style={{ width: 10, height: 10, color: m.color }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: m.color }}>{m.label}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* LIST-CONFIRMED section */}
      {hasListHits && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 7,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 800, color: "#f97316",
              textTransform: "uppercase", letterSpacing: "0.1em",
            }}>
              📋 DATABASE MATCH
            </div>
            <span style={{
              fontSize: 9, padding: "1px 7px", borderRadius: 4,
              background: "#fff7ed", color: "#c2410c",
              border: "1px solid #fed7aa", fontWeight: 700,
            }}>
              {fp.listHits.length} known
            </span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "#94a3b8", fontStyle: "italic" }}>
              no scan needed
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {fp.listHits.map((hit, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", borderRadius: 8,
                background: "#fff7ed", border: "1px solid #fed7aa",
              }}>
                <Database style={{ width: 11, height: 11, color: "#f97316", flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#7c2d12", flex: 1, wordBreak: "break-all" }}>
                  {hit.domain}
                </span>
                <span style={{ fontSize: 9, color: "#92400e", fontWeight: 600 }}>{hit.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ZERO-DAY section */}
      {hasZeroDay && (
        <div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 7,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 800, color: "#ef4444",
              textTransform: "uppercase", letterSpacing: "0.1em",
            }}>
              🔬 ZERO-DAY DISCOVERY
            </div>
            <span style={{
              fontSize: 9, padding: "1px 7px", borderRadius: 4,
              background: "#fff1f2", color: "#b91c1c",
              border: "1px solid #fecaca", fontWeight: 700,
            }}>
              {fp.zeroDayDiscoveries.length} unknown
            </span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "#ef4444", fontStyle: "italic", fontWeight: 600 }}>
              not in any list
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {fp.zeroDayDiscoveries.map((disc, i) => (
              <motion.div
                key={i}
                initial={{ x: -8, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.07 }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 8,
                  background: "linear-gradient(135deg, #fff1f2, #fef2f2)",
                  border: "1px solid #fecaca",
                  boxShadow: "0 0 10px rgba(239,68,68,0.1)",
                }}
              >
                <Fingerprint style={{ width: 11, height: 11, color: "#ef4444", flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#7f1d1d", flex: 1, wordBreak: "break-all" }}>
                  {disc.domain}
                </span>
                <span style={{ fontSize: 9, color: "#b91c1c", fontWeight: 600 }}>{disc.type}</span>
                {/* Pulse = live behavioral catch */}
                <motion.div
                  style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }}
                  animate={{ opacity: [1, 0.2, 1], scale: [1, 1.4, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              </motion.div>
            ))}
          </div>
          <div style={{
            marginTop: 8, padding: "7px 10px", borderRadius: 8,
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)",
            fontSize: 9, color: "#b91c1c", fontWeight: 600, lineHeight: 1.5,
          }}>
            ⚡ These scripts are not in ANY public blocklist — caught only by PrivacyLens behavioral interception.
          </div>
        </div>
      )}

      {/* Score bar */}
      {fp.totalScore > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Fingerprint Risk Score
            </span>
            <span style={{ fontSize: 10, fontWeight: 900, color: confColor }}>{fp.totalScore}/100</span>
          </div>
          <div style={{ height: 5, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${fp.totalScore}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              style={{ height: "100%", background: confColor, borderRadius: 99 }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Digital Shadow Panel ─────────────────────────────────────────────────────
const DigitalShadow = ({ telemetry, domain }) => {
  const shadow = useMemo(() => buildShadowProfile(telemetry, domain), [telemetry, domain]);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 400);
    return () => clearTimeout(t);
  }, []);

  if (!shadow) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
        <Brain style={{ width: 40, height: 40, margin: "0 auto 12px", display: "block" }} />
        <p style={{ fontWeight: 700, fontSize: 14 }}>Scanning digital shadow...</p>
      </div>
    );
  }

  const scoreColor = shadow.score >= 70 ? "#10b981" : shadow.score >= 40 ? "#f59e0b" : "#ef4444";
  const scoreBg    = shadow.score >= 70 ? "#ecfdf5" : shadow.score >= 40 ? "#fffbeb" : "#fff1f2";
  const scoreLabel = shadow.score >= 70 ? "LOW RISK" : shadow.score >= 40 ? "AT RISK" : "EXPOSED";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ paddingBottom: 24 }}
    >
      {/* ── CLASSIFIED FILE HEADER ── */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05 }}
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%)",
          borderRadius: 20, padding: "20px 20px 16px", marginBottom: 14,
          position: "relative", overflow: "hidden",
          boxShadow: "0 12px 40px rgba(15,23,42,0.3)",
        }}
      >
        {/* Scan line animation */}
        <motion.div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2,
            background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.8), transparent)",
            opacity: 0.6,
          }}
          animate={{ top: ["0%", "100%", "0%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{
                background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)",
                borderRadius: 6, padding: "2px 8px",
                fontSize: 9, fontWeight: 900, color: "#fca5a5", letterSpacing: "0.2em", textTransform: "uppercase",
              }}>
                ⬛ CLASSIFIED
              </div>
              <div style={{
                background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 6, padding: "2px 8px",
                fontSize: 9, fontWeight: 700, color: "#a5b4fc", letterSpacing: "0.12em", textTransform: "uppercase",
              }}>
                LIVE SURVEILLANCE REPORT
              </div>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 900, color: "#fff", margin: "0 0 2px", letterSpacing: "-0.3px" }}>
              Your Digital Shadow
            </h2>
            <p style={{ fontSize: 11, color: "#64748b", margin: 0, fontFamily: "monospace" }}>
              {shadow.domain} · {new Date().toLocaleTimeString()}
            </p>
          </div>
          <ScoreRing score={shadow.score} size={64} />
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {[
            { label: "TRACKERS", value: shadow.trackerCount, color: "#f87171" },
            { label: "COMPANIES", value: shadow.companyCount, color: "#fb923c" },
            { label: "3P COOKIES", value: shadow.thirdPartyCookieCount, color: "#facc15" },
            { label: "REQUESTS", value: shadow.requestCount, color: "#818cf8" },
          ].map(s => (
            <div key={s.label} style={{
              background: "rgba(255,255,255,0.05)", borderRadius: 10,
              padding: "8px 6px", textAlign: "center",
              border: "1px solid rgba(255,255,255,0.07)",
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 8, color: "#475569", fontWeight: 700, letterSpacing: "0.1em", marginTop: 2, textTransform: "uppercase" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── BEHAVIORAL FINGERPRINT DETECTION CARD (REAL DATA) ── */}
      <FingerprintDetectionCard fp={shadow.fpDetection} />

      {/* ── ADVERTISER PROFILE CARD ── */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        style={{
          background: "#fff", borderRadius: 18, border: "1px solid #e2e8f0",
          padding: "16px 18px", marginBottom: 12,
          boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(135deg, #fef3c7, #fde68a)",
            border: "1px solid #fcd34d",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <User style={{ width: 14, height: 14, color: "#92400e" }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#0f172a", letterSpacing: "0.03em" }}>ADVERTISER PROFILE CARD</div>
            <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>What ad networks have inferred about you</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <span style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 9, fontWeight: 800,
              background: scoreBg, color: scoreColor,
              border: `1px solid ${scoreColor}40`,
              textTransform: "uppercase", letterSpacing: "0.1em",
            }}>
              {scoreLabel}
            </span>
          </div>
        </div>

        {/* Inferred interests */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            Inferred Interests
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {shadow.interests.map((interest, i) => (
              <motion.span
                key={interest}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + i * 0.07 }}
                style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: "linear-gradient(135deg, #eef2ff, #e0e7ff)",
                  color: "#4338ca", border: "1px solid #c7d2fe",
                }}
              >
                {interest}
              </motion.span>
            ))}
          </div>
        </div>

        {/* Data collection indicators */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "Ad Targeting", active: shadow.hasAds, icon: ShoppingCart },
            { label: "Fingerprinting", active: shadow.hasFingerprint, icon: Fingerprint },
            { label: "Social Tracking", active: shadow.hasSocial, icon: User },
            { label: "Behavior Record", active: shadow.hasAnalytics, icon: TrendingUp },
            { label: "Cross-Site Profile", active: shadow.trackerDomainCount > 3, icon: Globe },
            { label: "Device ID", active: shadow.hasFingerprint, icon: Cpu },
          ].map(item => (
            <div key={item.label} style={{
              padding: "8px 10px", borderRadius: 10, textAlign: "center",
              background: item.active ? "#fff1f2" : "#f8fafc",
              border: `1px solid ${item.active ? "#fecaca" : "#e2e8f0"}`,
            }}>
              <item.icon style={{
                width: 14, height: 14, margin: "0 auto 4px", display: "block",
                color: item.active ? "#ef4444" : "#cbd5e1",
              }} />
              <div style={{ fontSize: 9, fontWeight: 700, color: item.active ? "#7f1d1d" : "#94a3b8", lineHeight: 1.3, textAlign: "center" }}>
                {item.label}
              </div>
              <div style={{ fontSize: 8, fontWeight: 800, color: item.active ? "#ef4444" : "#10b981", marginTop: 2 }}>
                {item.active ? "ACTIVE" : "NONE"}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── DATA EXPOSURE LOG ── */}
      {shadow.exposures.length > 0 && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25 }}
          style={{
            background: "#fff", borderRadius: 18, border: "1px solid #e2e8f0",
            padding: "16px 18px", marginBottom: 12,
            boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <AlertTriangle style={{ width: 16, height: 16, color: "#ef4444" }} />
            <div style={{ fontSize: 11, fontWeight: 900, color: "#0f172a" }}>LIVE DATA EXPOSURE LOG</div>
            <span style={{
              marginLeft: "auto", padding: "2px 8px", borderRadius: 6,
              fontSize: 9, fontWeight: 800, color: "#b91c1c",
              background: "#fff1f2", border: "1px solid #fecaca",
            }}>
              {shadow.exposures.length} ACTIVE
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {shadow.exposures.map((exp, i) => (
              <motion.div
                key={i}
                initial={{ x: -10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px", borderRadius: 10,
                  background: `${exp.color}10`,
                  border: `1px solid ${exp.color}30`,
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                  background: `${exp.color}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <exp.icon style={{ width: 13, height: 13, color: exp.color }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#1e293b", flex: 1 }}>{exp.label}</span>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: exp.color,
                  boxShadow: `0 0 6px ${exp.color}` }} />
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── WHO RECEIVES YOUR DATA ── */}
      {shadow.topCompanies.length > 0 && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35 }}
          style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
            borderRadius: 18, padding: "16px 18px",
            boxShadow: "0 8px 24px rgba(15,23,42,0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Database style={{ width: 14, height: 14, color: "#818cf8" }} />
            <div style={{ fontSize: 11, fontWeight: 900, color: "#e2e8f0", letterSpacing: "0.03em" }}>
              YOUR DATA IS BEING SENT TO
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shadow.topCompanies.map((co, i) => (
              <motion.div
                key={co}
                initial={{ x: 10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.4 + i * 0.06 }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 10, padding: "9px 12px",
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: "rgba(99,102,241,0.25)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 800, color: "#a5b4fc",
                }}>
                  {co.charAt(0)}
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", flex: 1 }}>{co}</span>
                {/* Pulse dot = "receiving data right now" */}
                <motion.div
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444" }}
                  animate={{ opacity: [1, 0.3, 1], scale: [1, 1.3, 1] }}
                  transition={{ duration: 1.4 + i * 0.3, repeat: Infinity }}
                />
              </motion.div>
            ))}
          </div>
          <div style={{
            marginTop: 12, padding: "8px 12px", borderRadius: 10,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
            fontSize: 10, color: "#fca5a5", fontWeight: 600, lineHeight: 1.5,
          }}>
            💡 Each pulsing dot means that company is actively receiving data about your session right now.
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export { DigitalShadow, ScoreRing, buildShadowProfile };
