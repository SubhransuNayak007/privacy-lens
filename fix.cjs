const fs = require('fs');
let code = fs.readFileSync('src/background/telemetryEngine.js', 'utf8');

// Revert accidental changes
code = code.replace(/console\.warn\("Could not send telemetry to popup:", _e\);/g, 'console.error("Failed to load databases:", _e);');
code = code.replace(/console\.error\("Failed to remove rule:", _e\);/g, 'console.error("Could not attribute download to tab", _e);');

// Now fix the actual remaining issues in telemetryEngine.js
code = code.replace(/console\.error\("Failed to remove rule:", e\);/g, 'console.error("Failed to remove rule:", _e);');
code = code.replace(/console\.warn\("Could not send telemetry to popup:", e\);/g, 'console.warn("Could not send telemetry to popup:", _e);');
code = code.replace(/catch\(e\) \{\}/g, 'catch(_e) {}');
code = code.replace(/console\.error\("Failed to clear telemetry:", e\);/g, 'console.error("Failed to clear telemetry:", _e);');
code = code.replace(/console\.error\("Could not attribute download to tab", e\);/g, 'console.error("Could not attribute download to tab", _e);');

fs.writeFileSync('src/background/telemetryEngine.js', code);

// aiExplanationEngine.js
let aie = fs.readFileSync('src/services/aiExplanationEngine.js', 'utf8');
aie = aie.replace(/onProgress: \(status\) =>/g, 'onProgress: (_status) =>');
aie = aie.replace(/onProgress = \(\) =>/g, '_onProgress = () =>');
fs.writeFileSync('src/services/aiExplanationEngine.js', aie);

// requestJourneyParser.js
let rjp = fs.readFileSync('src/services/requestJourneyParser.js', 'utf8');
rjp = rjp.replace(/catch \(e\)/g, 'catch (_e)');
fs.writeFileSync('src/services/requestJourneyParser.js', rjp);

// scripts/buildTrackerDB.js
let btdb = fs.readFileSync('scripts/buildTrackerDB.js', 'utf8');
btdb = btdb.replace(/const { company, companyUrl } = tracker;/g, 'const { company } = tracker;');
btdb = btdb.replace(/const { domain, is_third_party } = property;/g, 'const { is_third_party } = property;');
fs.writeFileSync('scripts/buildTrackerDB.js', btdb);
