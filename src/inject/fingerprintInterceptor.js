/**
 * PrivacyLens — Behavioral Fingerprint Interceptor
 * Runs in MAIN world (page context) at document_start.
 * Hooks all major fingerprinting APIs BEFORE tracker scripts load.
 * Dispatches CustomEvents to the isolated content script bridge.
 *
 * IMPORTANT: This file has ZERO imports and ZERO dependencies.
 * It must be a completely self-contained plain JS file.
 */
(function () {
  'use strict';

  // Guard: only install once even if script somehow runs twice
  if (window.__privacyLensInstalled) return;
  window.__privacyLensInstalled = true;

  // Spoofing configuration
  const SPOOF_THRESHOLD = 50; // Total score above which we spoof
  let isSpoofingActive = false;
  const NOISE_FACTOR = 1; // +/- 1 pixel value for color noise

  // ── Anti-Tampering (Hide our Proxies) ──────────────────────────────────────
  const origToString = Function.prototype.toString;
  Function.prototype.toString = function (...args) {
    if (this === HTMLCanvasElement.prototype.toDataURL ||
        this === HTMLCanvasElement.prototype.toBlob ||
        this === HTMLCanvasElement.prototype.getContext ||
        this === CanvasRenderingContext2D.prototype.getImageData ||
        this === CanvasRenderingContext2D.prototype.fillText ||
        this === CanvasRenderingContext2D.prototype.measureText ||
        this === WebGLRenderingContext.prototype.getExtension ||
        this === WebGLRenderingContext.prototype.getParameter ||
        this === WebGL2RenderingContext.prototype.getExtension ||
        this === WebGL2RenderingContext.prototype.getParameter ||
        this === document.fonts?.check) {
      return `function ${this.name}() { [native code] }`;
    }
    return origToString.apply(this, args);
  };

  // ── Per-origin signal accumulator ──────────────────────────────────────────
  const detection = {
    signals: [],       // { type, detail, timestamp, score }
    totalScore: 0,
    techniques: new Set(),
    canvasCallCount: 0,
    navigatorPropHits: 0,
    navigatorLastHit: 0,
    measureTextCount: 0,
    fontCheckCount: 0,
    offlineAudioCreated: false,
    oscillatorCreated: false,
    webglExtRequested: false,
    webrtcOfferOnly: false,

    // ── UPGRADE 5: FP-Inspector API Group Tracking (CCS 2021) ──
    // Tracks which fingerprinting API GROUP each script touches.
    // Game engines use canvas but typically stay in 1-2 groups.
    // Fingerprinting libraries hit 4+ groups: canvas + WebGL + audio + navigator.
    // Key: callerDomain, Value: Set of API group names they've accessed
    scriptApiGroups: new Map(),
    scriptGroupConfirmed: new Set(), // domains already emitted as CONFIRMED
  };

  // ── FP-Inspector group names (matching research paper) ──────────────────────
  const FP_GROUP = {
    CANVAS:    'canvas',
    WEBGL:     'webgl',
    AUDIO:     'audio',
    NAVIGATOR: 'navigator',
    SCREEN:    'screen',
    FONTS:     'fonts',
    TIMING:    'timing',
    WEBRTC:    'webrtc',
  };

  // FP-Inspector threshold: ≥4 distinct API groups = confirmed fingerprinting script
  const FP_GROUP_THRESHOLD = 4;

  // Track which API group a caller hit, check if it crosses FP threshold
  function trackApiGroup(callerDomain, group, emitFn) {
    if (!callerDomain || callerDomain === 'inline') return;
    if (!detection.scriptApiGroups.has(callerDomain)) {
      detection.scriptApiGroups.set(callerDomain, new Set());
    }
    const groups = detection.scriptApiGroups.get(callerDomain);
    groups.add(group);

    // Confirmed fingerprinter = script that hits ≥4 distinct API groups
    if (groups.size >= FP_GROUP_THRESHOLD && !detection.scriptGroupConfirmed.has(callerDomain)) {
      detection.scriptGroupConfirmed.add(callerDomain);
      emitFn('fp_inspector_confirmed', {
        callerDomain,
        apiGroups: Array.from(groups),
        groupCount: groups.size,
        reason: 'FP-Inspector: ≥4 API groups accessed by same script = confirmed fingerprinting',
      }, 60); // High score — definitively confirmed
    }
  }

  // ── Extract the calling script's URL from the JS stack trace ──────────────
  // This tells us WHICH script triggered the fingerprinting API.
  // We cache results so repeated calls from the same script are free.
  const _callerCache = new Map();
  function getCallerScript() {
    try {
      const stack = new Error().stack || '';
      const lines = stack.split('\n');
      for (const line of lines) {
        // Match http(s) URLs — skip our own interceptor file
        const m = line.match(/(https?:\/\/[^)\s:]+)/);
        if (m && !m[1].includes('fingerprintInterceptor')) {
          const url = m[1];
          if (_callerCache.has(url)) return _callerCache.get(url);
          let domain = '';
          try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch (_e) {}
          const result = { url, domain };
          _callerCache.set(url, result);
          return result;
        }
      }
    } catch (_e) {}
    return { url: 'inline', domain: '' };
  }

  // ── Emit a signal event (picked up by isolated content.js) ────────────────
  function emitSignal(type, detail, score) {
    detection.totalScore = Math.min(100, detection.totalScore + score);
    if (detection.totalScore >= SPOOF_THRESHOLD && !isSpoofingActive) {
      isSpoofingActive = true;
      console.log('PrivacyLens: Tracking threshold exceeded. Behavioral spoofing activated.');
    }
    
    detection.signals.push({ type, detail, score, timestamp: Date.now(), totalScore: detection.totalScore });
    detection.techniques.add(type);

    const caller = getCallerScript();

    try {
      window.dispatchEvent(new CustomEvent('__pl_fp_signal', {
        detail: {
          type,
          detail,
          score,
          totalScore: detection.totalScore,
          techniques: Array.from(detection.techniques),
          timestamp: Date.now(),
          callerUrl: caller.url,
          callerDomain: caller.domain,
        }
      }));
    } catch (_e) {}
  }

  // ── Utility: is this canvas hidden / tiny (fingerprinting pattern) ─────────
  function isHiddenCanvas(canvas) {
    if (!canvas) return true;
    if (canvas.width < 10 || canvas.height < 10) return true;
    const style = window.getComputedStyle ? window.getComputedStyle(canvas) : null;
    if (style) {
      if (style.display === 'none') return true;
      if (style.visibility === 'hidden') return true;
      if (parseFloat(style.opacity) === 0) return true;
    }
    // Off-screen via position
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    if (rect && (rect.width === 0 || rect.height === 0)) return true;
    return false;
  }

  // ── 1. CANVAS FINGERPRINTING ───────────────────────────────────────────────
  (function hookCanvas() {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob    = HTMLCanvasElement.prototype.toBlob;
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const origFillText  = CanvasRenderingContext2D.prototype.fillText;

    // Track which canvases had text drawn (fingerprint pattern)
    const canvasesWithText = new WeakSet();

    // Hook fillText to mark the canvas as "text drawn"
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      try {
        const canvas = this.canvas;
        if (canvas) canvasesWithText.add(canvas);
      } catch (_e) {}
      return maxWidth !== undefined
        ? origFillText.call(this, text, x, y, maxWidth)
        : origFillText.call(this, text, x, y);
    };

    // Hook toDataURL — primary canvas fingerprint signal
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      try {
        detection.canvasCallCount++;
        const hidden = isHiddenCanvas(this);
        const hadText = canvasesWithText.has(this);
        const score = hidden ? 40 : (hadText ? 20 : 10);

        if (score >= 20) {
          const caller = getCallerScript();
          emitSignal('canvas', {
            width: this.width, height: this.height,
            hidden, hadText,
            callCount: detection.canvasCallCount,
          }, score);
          // FP-Inspector: track this script accessed the CANVAS group
          trackApiGroup(caller.domain, FP_GROUP.CANVAS, emitSignal);
        }
        
        if (isSpoofingActive) {
          try {
            const ctx = this.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              const imgData = ctx.getImageData(0, 0, Math.max(1, this.width), Math.max(1, this.height));
              for (let i = 0; i < imgData.data.length; i += 4) {
                 imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + (Math.random() > 0.5 ? NOISE_FACTOR : -NOISE_FACTOR)));
              }
              ctx.putImageData(imgData, 0, 0);
            }
          } catch (_e) {}
        }
      } catch (_e) {}
      return origToDataURL.apply(this, args);
    };

    // Hook toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      try {
        const hidden = isHiddenCanvas(this);
        const hadText = canvasesWithText.has(this);
        if (hidden || hadText) {
          emitSignal('canvas_blob', { hidden, hadText }, hidden ? 35 : 15);
        }
      } catch (_e) {}
      return origToBlob.call(this, callback, ...args);
    };

    // Hook getImageData — reads pixel buffer (fingerprint extraction)
    CanvasRenderingContext2D.prototype.getImageData = function (sx, sy, sw, sh) {
      try {
        const hidden = isHiddenCanvas(this.canvas);
        if (hidden && detection.canvasCallCount > 0) {
          emitSignal('canvas_getimagedata', { hidden, sw, sh }, 30);
        }
      } catch (_e) {}
      const imgData = origGetImageData.call(this, sx, sy, sw, sh);
      
      if (isSpoofingActive && imgData && imgData.data) {
        for (let i = 0; i < imgData.data.length; i += 4) {
          imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + (Math.random() > 0.5 ? NOISE_FACTOR : -NOISE_FACTOR)));
        }
      }
      return imgData;
    };

    // Hook getContext to inject willReadFrequently and suppress Chrome warnings
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId, options, ...rest) {
      if (contextId === '2d') {
        options = options || {};
        options.willReadFrequently = true;
      }
      return origGetContext.call(this, contextId, options, ...rest);
    };
  })();

  // ── 2. WEBGL FINGERPRINTING ────────────────────────────────────────────────
  (function hookWebGL() {
    // Hook getExtension to detect WEBGL_debug_renderer_info request
    const hookGetExtension = function (proto) {
      const orig = proto.getExtension;
      proto.getExtension = function (name) {
        try {
          if (name === 'WEBGL_debug_renderer_info') {
            detection.webglExtRequested = true;
            const caller = getCallerScript();
            emitSignal('webgl_debug_renderer', { extension: name }, 45);
            // FP-Inspector: WebGL group
            trackApiGroup(caller.domain, FP_GROUP.WEBGL, emitSignal);
          }
        } catch (_e) {}
        return orig.call(this, name);
      };
    };

    // Hook getParameter for GPU info queries
    const hookGetParameter = function (proto) {
      const orig = proto.getParameter;
      proto.getParameter = function (pname) {
        try {
          // 0x9245 = UNMASKED_VENDOR_WEBGL, 0x9246 = UNMASKED_RENDERER_WEBGL
          if (pname === 0x9245 || pname === 0x9246) {
            const caller = getCallerScript();
            emitSignal('webgl_gpu_probe', {
              param: pname === 0x9245 ? 'UNMASKED_VENDOR_WEBGL' : 'UNMASKED_RENDERER_WEBGL'
            }, 40);
            // FP-Inspector: WebGL group
            trackApiGroup(caller.domain, FP_GROUP.WEBGL, emitSignal);

            if (isSpoofingActive) {
              return pname === 0x9245 ? "PrivacyLens Virtual GPU" : "PrivacyLens WebGL Renderer";
            }
          }
        } catch (_e) {}
        return orig.call(this, pname);
      };
    };

    try {
      hookGetExtension(WebGLRenderingContext.prototype);
      hookGetParameter(WebGLRenderingContext.prototype);
    } catch (_e) {}
    try {
      hookGetExtension(WebGL2RenderingContext.prototype);
      hookGetParameter(WebGL2RenderingContext.prototype);
    } catch (_e) {}
  })();

  // ── 3. AUDIOCONTEXT FINGERPRINTING ────────────────────────────────────────
  (function hookAudio() {
    const OrigOffline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OrigOffline) return;

    const Wrapped = function (...args) {
      detection.offlineAudioCreated = true;
      const ctx = new OrigOffline(...args);

      // Hook createOscillator on the returned context
      const origCreateOsc = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = function (...oscArgs) {
        detection.oscillatorCreated = true;
        // Both OfflineAudioContext + OscillatorNode = definitive fingerprint
        const caller = getCallerScript();
        emitSignal('audio_fingerprint', {
          sampleRate: ctx.sampleRate,
          length: ctx.length,
          channels: ctx.destination?.channelCount,
        }, 50);
        // FP-Inspector: AUDIO group
        trackApiGroup(caller.domain, FP_GROUP.AUDIO, emitSignal);
        
        const osc = origCreateOsc(...oscArgs);
        if (isSpoofingActive && osc.detune) {
          osc.detune.value += (Math.random() > 0.5 ? 1 : -1);
        }
        return osc;
      };

      return ctx;
    };

    // Preserve prototype chain so instanceof checks still work
    Wrapped.prototype = OrigOffline.prototype;
    try {
      window.OfflineAudioContext = Wrapped;
      if (window.webkitOfflineAudioContext) window.webkitOfflineAudioContext = Wrapped;
    } catch (_e) {}
  })();

  // ── 4. NAVIGATOR PROPERTY ENUMERATION ─────────────────────────────────────
  (function hookNavigator() {
    const TRACKED_PROPS = [
      'hardwareConcurrency', 'deviceMemory', 'languages',
      'plugins', 'mimeTypes', 'platform', 'userAgentData',
      'connection', 'getBattery',
    ];

    const propHitTimes = {};

    TRACKED_PROPS.forEach(prop => {
      try {
        const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop)
          || Object.getOwnPropertyDescriptor(navigator, prop);
        if (!desc) return;

        const origGet = desc.get || (() => desc.value);

        Object.defineProperty(Navigator.prototype, prop, {
          get: function () {
            const now = Date.now();
            propHitTimes[prop] = now;
            detection.navigatorPropHits++;
            detection.navigatorLastHit = now;

            // Count distinct props accessed within 500ms
            const windowStart = now - 500;
            const recentCount = Object.values(propHitTimes)
              .filter(t => t >= windowStart).length;

            if (recentCount >= 4 && !detection.navigatorFired4) {
              detection.navigatorFired4 = true;
              const caller = getCallerScript();
              emitSignal('navigator_enumeration', {
                props: Object.keys(propHitTimes).filter(k => propHitTimes[k] >= windowStart),
                count: recentCount,
              }, 30);
              // FP-Inspector: NAVIGATOR group
              trackApiGroup(caller.domain, FP_GROUP.NAVIGATOR, emitSignal);
            }
            
            if (isSpoofingActive) {
              if (prop === 'hardwareConcurrency') return 4;
              if (prop === 'deviceMemory') return 8;
            }
            
            return origGet.call(this);
          },
          configurable: true,
          enumerable: desc.enumerable,
        });
      } catch (_e) {} // Some props are non-configurable — skip gracefully
    });
  })();

  // ── 5. SCREEN & WINDOW FINGERPRINTING ─────────────────────────────────────
  (function hookScreen() {
    const SCREEN_PROPS = ['colorDepth', 'pixelDepth', 'availWidth', 'availHeight'];
    const screenHits = {};

    SCREEN_PROPS.forEach(prop => {
      try {
        const desc = Object.getOwnPropertyDescriptor(Screen.prototype, prop)
          || Object.getOwnPropertyDescriptor(screen, prop);
        if (!desc) return;
        const origGet = desc.get || (() => desc.value);
        Object.defineProperty(Screen.prototype, prop, {
          get: function () {
            screenHits[prop] = Date.now();
            const now = Date.now();
            const recentCount = Object.values(screenHits).filter(t => now - t < 300).length;
            // Only flag when combined with other FP signals
            if (recentCount >= 3 && detection.totalScore > 20) {
              if (!detection.screenFired) {
                detection.screenFired = true;
                const caller = getCallerScript();
                emitSignal('screen_enum', { props: Object.keys(screenHits), count: recentCount }, 10);
                // FP-Inspector: SCREEN group
                trackApiGroup(caller.domain, FP_GROUP.SCREEN, emitSignal);
              }
            }
            return origGet.call(this);
          },
          configurable: true,
        });
      } catch (_e) {}
    });
  })();

  // ── 6. WEBRTC IP LEAK ─────────────────────────────────────────────────────
  (function hookWebRTC() {
    const OrigRTC = window.RTCPeerConnection;
    if (!OrigRTC) return;

    try {
      window.RTCPeerConnection = function (config, ...rest) {
        const pc = new OrigRTC(config, ...rest);
        let offerCreated = false;
        let remoteSet = false;

        const origCreateOffer = pc.createOffer.bind(pc);
        pc.createOffer = function (...args) {
          offerCreated = true;
          // If offer created and no remote desc set → IP leak pattern
          setTimeout(() => {
            if (offerCreated && !remoteSet) {
              emitSignal('webrtc_ip_leak', {
                iceServers: config?.iceServers?.length || 0,
                stunOnly: (config?.iceServers || []).every(s =>
                  (s.urls || '').toString().startsWith('stun:')),
              }, 45);
            }
          }, 200);
          return origCreateOffer(...args);
        };

        const origSetRemote = pc.setRemoteDescription.bind(pc);
        pc.setRemoteDescription = function (...args) {
          remoteSet = true;
          return origSetRemote(...args);
        };

        return pc;
      };

      // Preserve prototype
      window.RTCPeerConnection.prototype = OrigRTC.prototype;
    } catch (_e) {}
  })();

  // ── 7. FONT ENUMERATION ────────────────────────────────────────────────────
  (function hookFonts() {
    // Hook measureText — timing-based font detection
    try {
      const origMeasure = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function (text) {
        detection.measureTextCount++;
        if (detection.measureTextCount === 12) {
          // 12+ calls = systematic font enumeration
          const caller = getCallerScript();
          emitSignal('font_enumeration_canvas', {
            callCount: detection.measureTextCount,
          }, 35);
          // FP-Inspector: FONTS group
          trackApiGroup(caller.domain, FP_GROUP.FONTS, emitSignal);
        }
        
        const metrics = origMeasure.call(this, text);
        if (isSpoofingActive) {
           return { ...metrics, width: metrics.width + (Math.random() * 0.001) };
        }
        return metrics;
      };
    } catch (_e) {}

    // Hook document.fonts.check() — CSS Font Loading API
    try {
      if (document.fonts && document.fonts.check) {
        const origCheck = document.fonts.check.bind(document.fonts);
        document.fonts.check = function (font, text) {
          detection.fontCheckCount++;
          if (detection.fontCheckCount === 8) {
            const caller = getCallerScript();
            emitSignal('font_enumeration_css', {
              callCount: detection.fontCheckCount,
            }, 35);
            // FP-Inspector: FONTS group
            trackApiGroup(caller.domain, FP_GROUP.FONTS, emitSignal);
          }
          return origCheck(font, text);
        };
      }
    } catch (_e) {}
  })();

  // ── Final summary signal after page load ───────────────────────────────────
  window.addEventListener('load', function () {
    // Small delay to let all synchronous FP scripts finish
    setTimeout(() => {
      if (detection.totalScore > 0) {
        const confidence =
          detection.totalScore >= 90 ? 'CONFIRMED' :
          detection.totalScore >= 60 ? 'LIKELY' :
          detection.totalScore >= 30 ? 'SUSPICIOUS' : 'CLEAN';

        // Build FP-Inspector per-script group report
        const scriptProfiles = [];
        detection.scriptApiGroups.forEach((groups, domain) => {
          scriptProfiles.push({
            domain,
            apiGroups: Array.from(groups),
            groupCount: groups.size,
            isConfirmed: detection.scriptGroupConfirmed.has(domain),
          });
        });

        window.dispatchEvent(new CustomEvent('__pl_fp_summary', {
          detail: {
            totalScore: detection.totalScore,
            confidence,
            techniques: Array.from(detection.techniques),
            signalCount: detection.signals.length,
            // FP-Inspector data: per-script API group profiles
            scriptProfiles,
            confirmedFingerprinters: Array.from(detection.scriptGroupConfirmed),
          }
        }));
      }
    }, 800);
  }, { once: true });

})();
