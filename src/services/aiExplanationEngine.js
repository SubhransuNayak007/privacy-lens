// src/services/aiExplanationEngine.js
import { evaluateTrackerImpact } from "./ruleEngine";

// Using IndexedDB for permanent caching
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PrivacyLensCache", 4); // bumped version to clear old fallbacks
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Delete old store if it exists
      if (db.objectStoreNames.contains("explanations")) {
        db.deleteObjectStore("explanations");
      }
      db.createObjectStore("explanations", { keyPath: "fingerprint" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedExplanation(fingerprint) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("explanations", "readonly");
    const store = transaction.objectStore("explanations");
    const request = store.get(fingerprint);
    request.onsuccess = () => resolve(request.result ? request.result.explanation : null);
    request.onerror = () => reject(request.error);
  });
}

async function saveExplanationToCache(fingerprint, explanation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("explanations", "readwrite");
    const store = transaction.objectStore("explanations");
    store.put({ fingerprint, explanation });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}



// Smart Fallback template engine
function fallbackExplain(contextPayload, impactData) {
  const { tracker, website, userActivity } = contextPayload;
  const category = (tracker.category || "").toLowerCase();
  
  if (tracker.company === "Unknown / Unclassified") {
    return {
      purpose: "Unknown Purpose",
      context: `Detected on ${website} while ${userActivity.toLowerCase()}. This domain does not appear in known threat or tracker databases.`,
      impact: "This might be custom infrastructure, unclassified third-party code, or a newly emerged tracker.",
      recommendation: "Review manually",
      evidence: ["Not found in known databases"],
      source: "Smart Rules"
    };
  }
  
  let purposeDesc = "Provides miscellaneous services.";
  let impactDesc = "Blocking this tracker may have unknown effects.";
  
  if (category.includes("advertis")) {
    purposeDesc = "Displays personalized advertisements.";
    impactDesc = "Blocking usually reduces ad tracking without affecting core website functionality.";
  } else if (category.includes("analytic") || category.includes("measurement")) {
    purposeDesc = "Measures visitor activity.";
    impactDesc = "Blocking usually does not affect website functionality.";
  } else if (category.includes("auth")) {
    purposeDesc = "Maintains your login session.";
    impactDesc = "Blocking may prevent login or cause session expiry.";
  } else if (category.includes("payment")) {
    purposeDesc = "Processes payments securely.";
    impactDesc = "Blocking may interrupt checkout or payment confirmation.";
  } else if (category.includes("cdn")) {
    purposeDesc = "Delivers website assets.";
    impactDesc = "Blocking may prevent images, videos or scripts from loading.";
  } else if (category.includes("captcha")) {
    purposeDesc = "Protects against automated abuse.";
    impactDesc = "Blocking may prevent form submission or login.";
  }

  // Contextual Impact overrides based on activity
  if (userActivity === "Watching Video" && impactData.recommendation === "Safe to Block") {
    impactDesc = "Only affects tracking. Video playback should continue normally.";
  } else if (userActivity === "Watching Video" && impactData.recommendation === "Essential") {
    impactDesc = "Blocking this will likely break video playback.";
  } else if (userActivity === "Making Payment" && impactData.recommendation === "Essential") {
    impactDesc = "Blocking this will likely cause the payment to fail.";
  } else if (userActivity === "Making Payment" && impactData.recommendation === "Review") {
    impactDesc = "Blocking may affect payment processing. Proceed with caution.";
  }

  return {
    purpose: tracker.purpose || purposeDesc,
    context: `Detected on ${website} while ${userActivity.toLowerCase()}.`,
    impact: impactDesc,
    recommendation: impactData.recommendation,
    evidence: impactData.evidence,
    source: "Smart Rules"
  };
}



// Build Context Fingerprint
async function getContextFingerprint(contextPayload) {
  // Hash combining site, page rough type, tracker, and activity
  const titleHint = (contextPayload.pageTitle || "").substring(0, 20).toLowerCase();
  const str = `${contextPayload.website}|${titleHint}|${contextPayload.tracker.domain}|${contextPayload.requestType}|${contextPayload.userActivity}`;
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function explainTracker({ tab, telemetry, tracker, onProgress: _onProgress }) {
  const website = tab ? new URL(tab.url).hostname.replace("www.", "") : "unknown";
  const pageTitle = tab ? tab.title : "";
  const requestCount = tracker.requestCount || 1;
  const cookies = telemetry?.cookies?.length || 0;
  
  let userActivity = "Idle Browsing";
  if (tab && tab.id) {
    try {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: "GET_USER_ACTIVITY" }, (res) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      });
      if (response && response.activity) userActivity = response.activity;
    } catch (_e) {
      // ignore
    }
  }

  const contextPayload = {
    website,
    pageTitle,
    tracker,
    requestType: "network request", 
    firstParty: tracker.domain.includes(website) || website.includes(tracker.domain),
    requestCount,
    cookies_detected: cookies,
    site_permissions: Object.keys(telemetry.permissions || {}),
    userActivity
  };

  // 1. Run Deterministic Rule Engine
  const impactData = evaluateTrackerImpact(contextPayload);
  contextPayload.ruleEngineDecision = impactData;

  // 2. Generate Fingerprint
  const fingerprint = await getContextFingerprint(contextPayload);
  
  // 3. Check Cache
  const cached = await getCachedExplanation(fingerprint);
  if (cached) {
    return cached;
  }

  // 4. Call Gemini AI
  // 4. Call Backend API for Gemini RAG
  try {
    const backendUrl = import.meta.env.VITE_API_URL || "https://privacylens-backend.vercel.app/api/explain";
    
    let parsed = null;
    
    try {
      const res = await fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextPayload })
      });

      if (res.ok) {
        parsed = await res.json();
      }
    } catch (backendErr) {
      console.warn("Backend unavailable, attempting direct Gemini fallback...", backendErr);
    }

    if (!parsed) {
      // Direct Fallback to Gemini using provided keys
      // Please set a valid API key or ensure the backend is available
      const apiKeys = ["INSERT_YOUR_API_KEY_HERE"];
      
      const systemPrompt = `You are a privacy expert explaining what web trackers do. You will receive structured facts about a web tracker, the website it was found on, and the Rule Engine's decision on whether it is safe to block.
Your job is to translate these facts into a highly contextual, human-readable explanation in strict JSON format.
DO NOT hallucinate. Use ONLY the provided facts. Keep explanations concise and educational.
If the tracker is unknown or unclassified, mention that this domain does not appear in known threat/tracker databases and might be custom infrastructure.
DO NOT change the rule engine's recommendation. Just explain *why* it made that decision based on the context.

Respond with exactly this JSON format:
{
  "purpose": "<short 2-4 word summary of what this tracker does>",
  "context": "<1-2 sentences explaining why this tracker is running on this specific website during the user's current activity>",
  "impact": "<1 sentence explaining what data it likely collects and if it affects the user's experience if blocked>"
}`;

      const userPrompt = JSON.stringify(contextPayload, null, 2);
      
      let lastError = null;
      let data = null;

      for (const apiKey of apiKeys) {
        if (apiKey === "INSERT_YOUR_API_KEY_HERE" || !apiKey) {
          lastError = new Error("No valid Gemini API key provided. Skipping fetch.");
          continue;
        }
        try {
          const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ parts: [{ text: userPrompt }] }],
              generationConfig: {
                response_mime_type: "application/json",
                temperature: 0.1
              }
            })
          });

          if (apiRes.ok) {
            data = await apiRes.json();
            break;
          } else {
            lastError = new Error(`Gemini API Error: ${apiRes.status}`);
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (!data) {
        throw lastError || new Error("All provided API keys failed.");
      }

      const jsonString = data.candidates[0].content.parts[0].text;
      parsed = JSON.parse(jsonString);
    }

    const finalResult = {
      purpose: parsed.purpose,
      context: parsed.context,
      impact: parsed.impact,
      recommendation: impactData.recommendation, // Hard-enforced from Rule Engine
      evidence: impactData.evidence, // Included from Rule Engine
      source: "AI Explanation (Gemini 2.5 Flash)"
    };

    await saveExplanationToCache(fingerprint, finalResult);
    return finalResult;
    
  } catch (error) {
    if (error.message.includes("No valid Gemini API key")) {
      console.info("Gemini AI key missing, using deterministic fallback.");
    } else {
      console.warn("Gemini AI failed completely, using deterministic fallback.", error);
    }
    const fallback = fallbackExplain(contextPayload, impactData);
    fallback.source = "Smart Rules";
    return fallback;
  }
}
