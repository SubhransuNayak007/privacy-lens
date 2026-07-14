import { ArrowLeft, Video, MapPin, Clipboard, Bell, Usb, Radio, ShieldAlert, CheckCircle, XCircle, Info, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

// ─── Color palette – 100% inline, immune to Tailwind / host-page injection ───
const PC = {
  pageBg:      "#f8fafc",
  cardBg:      "#ffffff",
  surfaceBg:   "#f1f5f9",
  indigoBg:    "#eef2ff",
  indigoBgMd:  "#e0e7ff",
  emeraldBg:   "#ecfdf5",
  emeraldBgMd: "#d1fae5",
  roseBg:      "#fff1f2",
  roseBgMd:    "#fee2e2",
  amberBg:     "#fffbeb",
  textPrimary: "#0f172a",
  textSecond:  "#475569",
  textTertiary:"#94a3b8",
  textInverted:"#ffffff",
  indigo:      "#4f46e5",
  indigoD:     "#4338ca",
  emerald:     "#10b981",
  emeraldD:    "#065f46",
  rose:        "#ef4444",
  roseD:       "#b91c1c",
  amber:       "#f59e0b",
  amberD:      "#78350f",
  borderLight: "#f1f5f9",
  borderDef:   "#e2e8f0",
  borderIndigo:"#c7d2fe",
  borderEmerald:"#a7f3d0",
  borderRose:  "#fecaca",
};

const getPermissionIntelligence = (perm, url) => {
  const domain = url ? (() => { try { return new URL(url).hostname.toLowerCase(); } catch(e) { return ""; } })() : "";

  const intel = {
    camera: {
      name: "Camera", icon: Video, sensitivity: "Usually sensitive",
      whyRequested: ["Video calls", "Identity verification", "QR scanning"],
      ifAllowed: ["Video calls and meetings will work", "Identity verification can be completed", "You can share your camera feed"],
      ifDenied: ["Camera will not be available", "Video calls won't work", "Some features may be limited"],
      tip: "Always disable camera access when you're not actively using it."
    },
    microphone: {
      name: "Microphone", icon: Radio, sensitivity: "Usually sensitive",
      whyRequested: ["Voice calls", "Voice search", "Audio recording"],
      ifAllowed: ["Voice calls will work", "You can use voice commands", "Audio can be recorded"],
      ifDenied: ["Microphone will not be available", "Voice features will break", "Cannot participate in calls"],
      tip: "Websites with microphone access can potentially hear background conversations."
    },
    geolocation: {
      name: "Location", icon: MapPin, sensitivity: "Highly sensitive",
      whyRequested: ["Maps & navigation", "Local weather/news", "Delivery tracking"],
      ifAllowed: ["Site can see your physical location", "Local content is accurate", "Delivery tracking works"],
      ifDenied: ["Site cannot track your physical location", "Must enter address manually", "Better privacy"],
      tip: "Location data can often identify exactly where you live or work."
    },
    'clipboard-read': {
      name: "Clipboard (Read)", icon: Clipboard, sensitivity: "Usually sensitive",
      whyRequested: ["Auto-pasting 2FA codes", "Rich text editors", "Importing data"],
      ifAllowed: ["Easy paste features work", "Rich editor support", "Site can read copied text"],
      ifDenied: ["Better privacy", "Paste shortcuts may fail", "Must paste manually"],
      tip: "Your clipboard often contains passwords, private messages, or sensitive data."
    },
    notifications: {
      name: "Notifications", icon: Bell, sensitivity: "Often abused",
      whyRequested: ["Chat alerts", "Breaking news", "Calendar reminders"],
      ifAllowed: ["You will receive desktop alerts", "Real-time updates work"],
      ifDenied: ["No desktop spam", "Better focus", "Alerts only show inside the app"],
      tip: "Many sites abuse notifications to send desktop advertisements."
    },
    usb: {
      name: "USB Devices", icon: Usb, sensitivity: "Highly sensitive",
      whyRequested: ["Hardware wallets", "Physical security keys", "Flashing devices"],
      ifAllowed: ["Site can communicate with plugged-in USBs", "Hardware features work"],
      ifDenied: ["Total protection against unauthorized USB access", "Hardware wallets won't connect"],
      tip: "Never allow USB access unless you are actively configuring a specific physical device."
    },
    default: {
      name: perm ? perm.charAt(0).toUpperCase() + perm.slice(1) : "Permission",
      icon: Info, sensitivity: "Varies",
      whyRequested: ["Enhancing site functionality", "Providing specific features"],
      ifAllowed: ["Feature will work as intended"],
      ifDenied: ["Feature will be disabled", "Better privacy"],
      tip: "Only allow permissions to sites you fully trust."
    }
  };

  const data = intel[perm] || intel.default;

  let isExpected = false;
  let whyThisSite = "This site wants to use this feature for its functionality.";
  let recommendation = "Allow only if you initiated a feature that requires this.";

  if (perm === 'camera' || perm === 'microphone') {
    if (domain.includes('meet') || domain.includes('zoom') || domain.includes('teams') || domain.includes('video') || domain.includes('youtube')) {
      isExpected = true;
      whyThisSite = `${domain} often uses audio/video for conferencing or recording.`;
      recommendation = "Keep enabled while meeting or recording is active.";
    } else {
      whyThisSite = `It is unclear why ${domain} needs your ${data.name.toLowerCase()} right now.`;
      recommendation = "Deny. Only allow if you are actively taking a photo or recording.";
    }
  } else if (perm === 'geolocation') {
    if (domain.includes('map') || domain.includes('weather') || domain.includes('delivery') || domain.includes('uber') || domain.includes('doordash')) {
      isExpected = true;
      whyThisSite = `${domain} uses location to show local services or maps.`;
      recommendation = "Allow only while using the site.";
    } else {
      whyThisSite = `Most content sites like ${domain} do not need your exact location.`;
      recommendation = "Deny. They can determine your general area via IP address anyway.";
    }
  } else if (perm === 'clipboard-read') {
    if (domain.includes('docs') || domain.includes('word') || domain.includes('editor') || domain.includes('notion')) {
      isExpected = true;
      whyThisSite = `${domain} uses clipboard access for advanced copy/paste.`;
      recommendation = "Allow if you regularly edit documents here.";
    } else {
      whyThisSite = `${domain} may be trying to read what you last copied.`;
      recommendation = "Deny by default. Protect your clipboard.";
    }
  } else if (perm === 'notifications') {
    if (domain.includes('mail') || domain.includes('chat') || domain.includes('slack') || domain.includes('whatsapp') || domain.includes('calendar')) {
      isExpected = true;
      whyThisSite = `${domain} uses notifications for important alerts and messages.`;
      recommendation = "Allow if you want real-time alerts.";
    } else {
      whyThisSite = `Many news and blog sites use notifications to send ads.`;
      recommendation = "Deny aggressively to prevent desktop spam.";
    }
  }

  return { ...data, isExpected, whyThisSite, recommendation, domain };
};

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 280, damping: 22 } }
};

const PermissionDetails = ({ permission, state, url, onBack }) => {
  const intel = getPermissionIntelligence(permission, url);
  const Icon = intel.icon;

  // Status badge colours
  let statusBadge = { bg: PC.surfaceBg, text: PC.textSecond, border: PC.borderDef, label: state };
  if (state === "granted") statusBadge = { bg: PC.roseBg, text: PC.roseD, border: PC.borderRose, label: "Granted" };
  else if (state === "prompt")  statusBadge = { bg: PC.amberBg, text: PC.amberD, border: "#fde68a", label: "Ask" };
  else if (state === "denied")  statusBadge = { bg: PC.emeraldBg, text: PC.emeraldD, border: PC.borderEmerald, label: "Denied" };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      style={{
        display: "flex", flexDirection: "column",
        height: 480, margin: 0,
        background: "linear-gradient(160deg, #f8fafc 0%, #f0f4ff 100%)",
        borderTop: `1px solid ${PC.borderLight}`,
        borderRadius: "0 0 24px 24px",
        overflowY: "auto", overflowX: "hidden",
        padding: "20px 20px 24px",
        position: "relative",
      }}
    >
      {/* ── Back button ── */}
      <motion.div variants={itemVariants} style={{ marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px 6px 8px",
            background: PC.cardBg,
            border: `1px solid ${PC.borderDef}`,
            borderRadius: 10, cursor: "pointer",
            fontSize: 11, fontWeight: 700,
            color: PC.textSecond,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <ArrowLeft style={{ width: 14, height: 14, color: PC.textSecond }} />
          Back
        </button>
      </motion.div>

      {/* ── Header card: Icon + Name + Status ── */}
      <motion.div
        variants={itemVariants}
        className="glass-panel premium-shadow hover-lift"
        style={{
          borderRadius: 18,
          padding: "16px 18px",
          marginBottom: 14,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "relative", overflow: "hidden",
        }}
      >
        {/* Watermark icon */}
        <div style={{ position: "absolute", right: -8, top: -8, opacity: 0.04, pointerEvents: "none" }}>
          <Icon style={{ width: 80, height: 80, color: PC.indigo }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative", zIndex: 1 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, #eef2ff, #e0e7ff)",
            border: `1px solid ${PC.borderIndigo}`,
            boxShadow: "0 2px 8px rgba(79,70,229,0.15)",
            flexShrink: 0,
          }}>
            <Icon style={{ width: 22, height: 22, color: PC.indigo }} />
          </div>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 900, color: PC.textPrimary, margin: "0 0 2px", letterSpacing: "-0.01em" }}>
              {intel.name}
            </h2>
            <p style={{ fontSize: 11, color: PC.textTertiary, margin: 0, fontFamily: "monospace", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {intel.domain || url}
            </p>
          </div>
        </div>

        <div style={{ textAlign: "right", position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: PC.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
            Current Status
          </div>
          <span style={{
            display: "inline-block",
            padding: "4px 12px", borderRadius: 8,
            fontSize: 11, fontWeight: 800,
            textTransform: "uppercase", letterSpacing: "0.08em",
            background: statusBadge.bg,
            color: statusBadge.text,
            border: `1px solid ${statusBadge.border}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}>
            {statusBadge.label}
          </span>
        </div>
      </motion.div>

      {/* ── Sensitivity + Expected row ── */}
      <motion.div variants={itemVariants} style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 10, marginBottom: 14 }}>
        {/* Sensitivity */}
        <div 
          className="glass-panel hover-lift"
          style={{
            borderRadius: 14, padding: "12px 14px",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 700, color: PC.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center" }}>
            Sensitivity
          </div>
          <ShieldAlert style={{ width: 16, height: 16, color: PC.rose, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 800, color: PC.roseD, textAlign: "center", lineHeight: 1.3 }}>
            {intel.sensitivity}
          </span>
        </div>

        {/* Expected */}
        <div 
          className="glass-panel hover-lift"
          style={{
            borderRadius: 14, padding: "12px 14px",
            display: "flex", flexDirection: "column", justifyContent: "center", gap: 8,
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 700, color: PC.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Expected for this site?
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "5px 12px", borderRadius: 10, width: "fit-content",
            fontSize: 11, fontWeight: 800, letterSpacing: "0.04em",
            background: intel.isExpected ? PC.emeraldBg : PC.roseBg,
            color: intel.isExpected ? PC.emeraldD : PC.roseD,
            border: `1px solid ${intel.isExpected ? PC.borderEmerald : PC.borderRose}`,
          }}>
            {intel.isExpected
              ? <><CheckCircle style={{ width: 13, height: 13 }} /> YES, EXPECTED</>
              : <><XCircle style={{ width: 13, height: 13 }} /> UNEXPECTED</>
            }
          </span>
        </div>
      </motion.div>

      {/* ── Why this site ── */}
      <motion.div variants={itemVariants} style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: PC.textTertiary, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, paddingLeft: 2 }}>
          Why THIS site requested it
        </div>
        <div 
          className="glass-panel premium-shadow"
          style={{
            fontSize: 12, fontWeight: 500, color: PC.textSecond, lineHeight: 1.65,
            borderRadius: 14, padding: "14px 16px",
          }}
        >
          {intel.whyThisSite}
        </div>
      </motion.div>

      {/* ── If Allowed / If Denied ── */}
      <motion.div variants={itemVariants} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {/* If Allowed */}
        <div style={{
          background: "#f0fdf4", border: `1px solid ${PC.borderEmerald}`, borderRadius: 14, padding: "14px 14px",
          boxShadow: "0 1px 4px rgba(16,185,129,0.06)",
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: "#065f46",
            textTransform: "uppercase", letterSpacing: "0.1em",
            display: "flex", alignItems: "center", gap: 6,
            marginBottom: 10, paddingBottom: 8,
            borderBottom: `1px solid ${PC.borderEmerald}`,
          }}>
            <CheckCircle style={{ width: 12, height: 12 }} /> If Allowed
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 7 }}>
            {intel.ifAllowed.map((item, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, color: PC.textSecond, lineHeight: 1.45 }}>
                <span style={{ color: PC.emerald, flexShrink: 0, marginTop: 1, fontWeight: 700 }}>→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* If Denied */}
        <div style={{
          background: "#fff5f5", border: `1px solid ${PC.borderRose}`, borderRadius: 14, padding: "14px 14px",
          boxShadow: "0 1px 4px rgba(239,68,68,0.06)",
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: PC.roseD,
            textTransform: "uppercase", letterSpacing: "0.1em",
            display: "flex", alignItems: "center", gap: 6,
            marginBottom: 10, paddingBottom: 8,
            borderBottom: `1px solid ${PC.borderRose}`,
          }}>
            <XCircle style={{ width: 12, height: 12 }} /> If Denied
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 7 }}>
            {intel.ifDenied.map((item, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, color: PC.textSecond, lineHeight: 1.45 }}>
                <span style={{ color: PC.rose, flexShrink: 0, marginTop: 1, fontWeight: 700 }}>→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>

      {/* ── Recommendation panel ── */}
      <motion.div
        variants={itemVariants}
        style={{
          background: "linear-gradient(135deg, #1e293b 0%, #312e81 100%)",
          border: "1px solid rgba(99,102,241,0.25)",
          borderRadius: 18, padding: "18px 20px",
          boxShadow: "0 8px 24px rgba(30,41,59,0.25)",
          position: "relative", overflow: "hidden",
          marginTop: "auto",
        }}
      >
        {/* watermark */}
        <div style={{ position: "absolute", top: 0, right: 0, padding: 12, opacity: 0.08, pointerEvents: "none" }}>
          <ShieldCheck style={{ width: 56, height: 56, color: "#fff" }} />
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 8,
              background: "rgba(99,102,241,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <ShieldCheck style={{ width: 14, height: 14, color: "#a5b4fc" }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#a5b4fc", textTransform: "uppercase", letterSpacing: "0.15em" }}>
              PrivacyLens Recommendation
            </span>
          </div>
          <p style={{ fontSize: 12, color: "#f1f5f9", fontWeight: 500, lineHeight: 1.65, margin: 0, paddingRight: 48 }}>
            {intel.recommendation}
          </p>
        </div>
      </motion.div>

    </motion.div>
  );
};

export default PermissionDetails;
