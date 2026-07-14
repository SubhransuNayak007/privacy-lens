import { useState, useEffect, memo } from "react";
import { Cookie, Trash2, Shield, AlertTriangle, AlertCircle, RefreshCw, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cookieManager } from "../services/cookieManager";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } }
};

const CookieDashboard = memo(function CookieDashboard({ telemetry, updateData }) {
  const [enrichedCookies, setEnrichedCookies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function init() {
      if (!cookieManager.trackerData) {
        await cookieManager.init();
      }
      if (telemetry && telemetry.cookies) {
        setEnrichedCookies(cookieManager.enrichCookies(telemetry.cookies));
      }
      setLoading(false);
    }
    init();
  }, [telemetry]);

  const handleDelete = async (cookie) => {
    setIsDeleting(true);
    await cookieManager.deleteCookie(cookie);
    updateData(); // Refresh UI
    setTimeout(() => setIsDeleting(false), 300);
  };

  const handleClearThirdParty = async () => {
    if (confirm("Delete all third-party cookies?")) {
      setIsDeleting(true);
      await cookieManager.clearThirdParty(enrichedCookies);
      updateData();
      setTimeout(() => setIsDeleting(false), 300);
    }
  };

  const handleClearAdvertising = async () => {
    if (confirm("Delete all advertising and tracking cookies?")) {
      setIsDeleting(true);
      await cookieManager.clearAdvertising(enrichedCookies);
      updateData();
      setTimeout(() => setIsDeleting(false), 300);
    }
  };

  const handleClearAll = async () => {
    if (confirm("Delete ALL cookies for this site?")) {
      setIsDeleting(true);
      await cookieManager.clearAll(enrichedCookies);
      updateData();
      setTimeout(() => setIsDeleting(false), 300);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6 font-sans animate-pulse px-1">
        <div className="h-44 bg-slate-200/50 rounded-2xl w-full border border-slate-200"></div>
        <div className="flex gap-2">
          <div className="flex-1 h-11 bg-slate-200/50 rounded-xl border border-slate-200"></div>
          <div className="flex-1 h-11 bg-slate-200/50 rounded-xl border border-slate-200"></div>
          <div className="flex-1 h-11 bg-slate-200/50 rounded-xl border border-slate-200"></div>
        </div>
        <div className="space-y-4 pb-10">
          <div className="h-5 w-32 bg-slate-200/50 rounded-md"></div>
          <div className="h-48 bg-slate-200/50 rounded-xl w-full border border-slate-200"></div>
          <div className="h-48 bg-slate-200/50 rounded-xl w-full border border-slate-200"></div>
        </div>
      </div>
    );
  }

  const firstPartyCount = enrichedCookies.filter(c => c.isFirstParty).length;
  const thirdPartyCount = enrichedCookies.filter(c => !c.isFirstParty).length;
  const sessionCount = enrichedCookies.filter(c => c.expiry === 'session').length;
  const persistentCount = enrichedCookies.length - sessionCount;

  return (
    <motion.div 
      className="flex flex-col gap-6 font-sans"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* 1. Cookie Dashboard Stats */}
      <motion.section 
        variants={itemVariants}
        className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-5 text-white shadow-xl shadow-indigo-900/10 relative overflow-hidden border border-indigo-500/20"
      >
        <div className="absolute -right-6 -top-6 opacity-5 rotate-12 mix-blend-overlay pointer-events-none">
          <Cookie className="h-40 w-40" />
        </div>
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] mix-blend-overlay pointer-events-none"></div>
        
        <div className="relative z-10">
          <h2 className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Cookie className="h-4 w-4 text-indigo-400" />
            Cookie Intelligence
          </h2>
          
          <div className="flex items-end gap-3 mb-6">
            <span className="text-5xl font-black tracking-tighter text-white drop-shadow-md">{enrichedCookies.length}</span>
            <span className="text-sm font-medium text-slate-300 pb-1.5">Total Cookies</span>
          </div>

          <div className="grid grid-cols-[auto_1fr_1fr] gap-4 items-center bg-white/5 backdrop-blur-md rounded-xl p-3 border border-white/10">
            
            {/* Animated Donut Chart for Origin */}
            <div className="relative w-12 h-12 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="rgba(255,255,255,0.1)" strokeWidth="3"></circle>
                <motion.circle 
                  cx="18" cy="18" r="15.915" fill="transparent" stroke="#34d399" strokeWidth="3"
                  strokeDasharray={`${firstPartyCount > 0 ? (firstPartyCount/enrichedCookies.length)*100 : 0} 100`}
                  initial={{ strokeDasharray: "0 100" }}
                  animate={{ strokeDasharray: `${firstPartyCount > 0 ? (firstPartyCount/enrichedCookies.length)*100 : 0} 100` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                ></motion.circle>
                <motion.circle 
                  cx="18" cy="18" r="15.915" fill="transparent" stroke="#fbbf24" strokeWidth="3" strokeDashoffset={-((firstPartyCount/enrichedCookies.length)*100)}
                  strokeDasharray={`${thirdPartyCount > 0 ? (thirdPartyCount/enrichedCookies.length)*100 : 0} 100`}
                  initial={{ strokeDasharray: "0 100" }}
                  animate={{ strokeDasharray: `${thirdPartyCount > 0 ? (thirdPartyCount/enrichedCookies.length)*100 : 0} 100` }}
                  transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                ></motion.circle>
              </svg>
            </div>

            <div className="flex flex-col justify-center gap-2 border-r border-white/10 pr-2">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mb-0.5">Origin</div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></div>
                <span className="text-xs font-semibold text-slate-200">{firstPartyCount} 1st</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"></div>
                <span className="text-xs font-semibold text-slate-200">{thirdPartyCount} 3rd</span>
              </div>
            </div>

            <div className="flex flex-col justify-center gap-2 pl-1">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mb-0.5">Lifespan</div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-sky-400"></div>
                <span className="text-xs font-semibold text-slate-200">{sessionCount} Sess</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-indigo-400"></div>
                <span className="text-xs font-semibold text-slate-200">{persistentCount} Pers</span>
              </div>
            </div>
          </div>
        </div>

      </motion.section>

      {/* Bulk Actions */}
      <motion.section variants={itemVariants} className="flex gap-2">
        <motion.button 
          whileHover={{ y: -2, scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleClearThirdParty} 
          disabled={isDeleting || thirdPartyCount === 0}
          className="flex-1 glass-panel premium-shadow disabled:opacity-50 disabled:hover:transform-none rounded-xl py-2.5 px-2 text-[11px] font-bold text-slate-700 transition-colors flex flex-col items-center justify-center gap-1.5"
        >
          <div className="p-1.5 bg-amber-50/80 rounded-lg text-amber-500 shadow-sm border border-amber-100">
            <Trash2 className="h-3.5 w-3.5" />
          </div>
          Clear 3rd Party
        </motion.button>
        <motion.button 
          whileHover={{ y: -2, scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleClearAdvertising} 
          disabled={isDeleting || enrichedCookies.length === 0}
          className="flex-1 glass-panel premium-shadow disabled:opacity-50 disabled:hover:transform-none rounded-xl py-2.5 px-2 text-[11px] font-bold text-slate-700 transition-colors flex flex-col items-center justify-center gap-1.5"
        >
          <div className="p-1.5 bg-rose-50/80 rounded-lg text-rose-500 shadow-sm border border-rose-100">
            <Shield className="h-3.5 w-3.5" />
          </div>
          Clear Tracking
        </motion.button>
        <motion.button 
          whileHover={{ y: -2, scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleClearAll} 
          disabled={isDeleting || enrichedCookies.length === 0}
          className="flex-1 bg-gradient-to-b from-rose-50 to-rose-100/50 border border-rose-200 premium-shadow disabled:opacity-50 disabled:hover:transform-none rounded-xl py-2.5 px-2 text-[11px] font-bold text-rose-700 transition-colors flex flex-col items-center justify-center gap-1.5"
        >
          <div className="p-1.5 bg-rose-100/80 rounded-lg text-rose-600 shadow-sm border border-rose-200">
            <X className="h-3.5 w-3.5" />
          </div>
          Clear All
        </motion.button>
      </motion.section>

      {/* 4. Live Timeline of Recently Created Cookies */}
      {telemetry?.cookieTimeline && telemetry.cookieTimeline.length > 0 && (
        <motion.section variants={itemVariants} className="glass-panel premium-shadow rounded-xl p-4">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 text-brand-secondary" />
            Live Activity
          </h3>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {telemetry.cookieTimeline.slice(0, 5).map((ct, idx) => (
                <motion.div 
                  key={ct.timestamp + ct.name}
                  initial={{ opacity: 0, height: 0, scale: 0.95 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center justify-between text-sm py-1"
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <span className={cn(
                      "h-2 w-2 rounded-full flex-shrink-0",
                      ct.action === 'removed' ? 'bg-slate-300' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]'
                    )}></span>
                    <span className="font-medium text-slate-700 truncate max-w-[150px]">{ct.name}</span>
                  </div>
                  <span className="text-[10px] font-medium text-slate-400 flex-shrink-0">{new Date(ct.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.section>
      )}

      {/* 2. Cookie Details List */}
      <motion.section variants={itemVariants} className="space-y-4 pb-10">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Detailed Inspection</h3>
          <span className="text-xs font-medium text-slate-500 bg-slate-200/50 px-2 py-0.5 rounded-full">{enrichedCookies.length} Items</span>
        </div>
        
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {enrichedCookies.map((cookie, idx) => (
              <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                key={cookie.domain + cookie.name} 
                className="glass-panel premium-shadow rounded-xl overflow-hidden hover-lift"
              >
                <div className="p-4 border-b border-slate-200/60 bg-white/40 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-900 break-all leading-tight mb-1.5">{cookie.name}</h4>
                    <div className="flex items-center gap-2">
                      {cookie.company !== "Unknown" ? (
                        <span className="inline-flex text-[10px] font-bold uppercase tracking-wider text-brand-primary bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                          {cookie.company}
                        </span>
                      ) : (
                        <span className="inline-flex text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                          {cookie.domain}
                        </span>
                      )}
                      
                      {cookie.risk === 'High' && (
                        <span className="inline-flex text-[10px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full">
                          High Risk
                        </span>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(cookie)}
                    disabled={isDeleting}
                    className="flex-shrink-0 p-2 bg-white/80 border border-slate-200 rounded-lg text-rose-500 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-600 transition-colors shadow-sm disabled:opacity-50"
                    title="Delete this cookie"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                
                <div className="p-4 grid grid-cols-2 gap-y-4 gap-x-3 text-sm bg-white/60">
                  <div className="col-span-2">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Domain</div>
                    <div className="font-medium text-slate-800 text-xs truncate" title={cookie.domain}>{cookie.domain}</div>
                  </div>
                  
                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Type</div>
                    <div className="font-medium text-xs">
                      {cookie.isFirstParty ? (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> First Party
                        </span>
                      ) : (
                        <span className="text-amber-700 font-semibold flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> Third Party
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Expiry</div>
                    <div className="font-medium text-slate-800 text-xs">
                      {cookie.expiry === 'session' ? 'Session' : new Date(cookie.expiry * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Purpose</div>
                    <div className="text-xs font-medium text-slate-700 leading-relaxed">{cookie.purpose}</div>
                  </div>

                  <div className="col-span-2 bg-gradient-to-br from-slate-50 to-slate-100/50 p-3 rounded-xl border border-slate-200/60 shadow-sm shadow-slate-200/20">
                    <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">If Blocked / Deleted</div>
                    <div className="text-xs font-semibold text-slate-800 flex items-start gap-2 leading-relaxed">
                      <span className="text-brand-primary mt-0.5">→</span>
                      {cookie.impact}
                    </div>
                  </div>

                  <div className="col-span-2 flex flex-wrap gap-1.5 mt-1">
                    {cookie.secure && <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 text-[10px] font-bold text-slate-500 shadow-sm uppercase tracking-wider">Secure</span>}
                    {cookie.httpOnly && <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 text-[10px] font-bold text-slate-500 shadow-sm uppercase tracking-wider">HttpOnly</span>}
                    {cookie.sameSite && <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 text-[10px] font-bold text-slate-500 shadow-sm uppercase tracking-wider">SameSite={cookie.sameSite}</span>}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {enrichedCookies.length === 0 && !loading && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="text-center p-10 glass-panel rounded-2xl border-dashed border-2 border-slate-200 text-slate-500 flex flex-col items-center justify-center gap-3"
            >
              <Shield className="h-10 w-10 text-emerald-400 mb-2" />
              <div className="font-bold text-slate-700 text-lg">Clean Slate</div>
              <div className="text-sm">No cookies detected on this page.</div>
            </motion.div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
});

export default CookieDashboard;
