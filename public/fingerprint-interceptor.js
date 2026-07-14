/**
 * PrivacyLens Behavioral Fingerprint Interceptor (MAIN world)
 * ─────────────────────────────────────────────────────────────────────────────
 * Hooks into sensitive APIs (Canvas, WebGL, AudioContext, Font) using Proxies
 * to detect tracking behavior and spoof data when a fingerprinting threshold is met.
 */

(function () {
  // Prevent double injection
  if (window.__privacyLensInitialized) return;
  window.__privacyLensInitialized = true;

  console.log("PrivacyLens: Fingerprint Interceptor initialized in MAIN world.");

  // Configuration
  const THRESHOLD = 8;
  const NOISE_FACTOR = 1; // Small noise to invalidate hashes

  // State
  const scores = {};
  const spoofed = {};

  function getCallerOrigin() {
    try {
      throw new Error();
    } catch (e) {
      if (e.stack) {
        // Simple regex to grab the script URL from the stack trace
        const match = e.stack.match(/at.*?\(?(https?:\/\/[^\s]+)\)?/g);
        if (match && match.length > 1) {
          try {
            // First stack frame is this script, second/third is the caller
            const urlMatch = match[match.length - 1].match(/https?:\/\/[^:]+/);
            if (urlMatch) return new URL(urlMatch[0]).hostname;
          } catch (err) {}
        }
      }
    }
    return window.location.hostname;
  }

  function addScore(origin, points, signalName) {
    if (!scores[origin]) scores[origin] = 0;
    scores[origin] += points;
    console.debug(`PrivacyLens: +${points} to ${origin} (Signal: ${signalName}). Total: ${scores[origin]}`);

    if (scores[origin] >= THRESHOLD && !spoofed[origin]) {
      spoofed[origin] = true;
      console.warn(`PrivacyLens: Behavioral Fingerprinting detected from ${origin}! Spoofing activated.`);
      
      // Dispatch event to ISOLATED world content script
      window.dispatchEvent(new CustomEvent('__pl_fp_signal', {
        detail: { origin, score: scores[origin], signal: signalName }
      }));
    }
  }

  // --- Spoofing Helpers ---
  function applyNoiseToImageData(imageData) {
    for (let i = 0; i < imageData.data.length; i += 4) {
      // Add a slight, imperceptible noise (pseudo-random based on pixel pos to maintain some consistency)
      const noise = (i % 3 === 0) ? NOISE_FACTOR : -NOISE_FACTOR;
      imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise)); // Red channel
    }
    return imageData;
  }

  function applyNoiseToCanvas(canvas) {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const width = Math.max(1, canvas.width);
        const height = Math.max(1, canvas.height);
        const imgData = ctx.getImageData(0, 0, width, height);
        ctx.putImageData(applyNoiseToImageData(imgData), 0, 0);
      }
    } catch (e) {}
  }

  // --- Proxies ---
  const proxyHandler = {
    get: function(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    }
  };

  // 1. Canvas 2D
  if (HTMLCanvasElement.prototype.toDataURL) {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = new Proxy(origToDataURL, {
      apply(target, thisArg, argumentsList) {
        const origin = getCallerOrigin();
        addScore(origin, 3, 'Canvas.toDataURL');
        if (spoofed[origin]) applyNoiseToCanvas(thisArg);
        return Reflect.apply(target, thisArg, argumentsList);
      }
    });
  }

  if (CanvasRenderingContext2D.prototype.getImageData) {
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = new Proxy(origGetImageData, {
      apply(target, thisArg, argumentsList) {
        const origin = getCallerOrigin();
        addScore(origin, 3, 'Canvas.getImageData');
        const imgData = Reflect.apply(target, thisArg, argumentsList);
        if (spoofed[origin]) {
          return applyNoiseToImageData(imgData);
        }
        return imgData;
      }
    });
  }

  if (CanvasRenderingContext2D.prototype.measureText) {
    const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = new Proxy(origMeasureText, {
      apply(target, thisArg, argumentsList) {
        const origin = getCallerOrigin();
        // measureText is often used legitimately, so we assign a small weight
        addScore(origin, 0.5, 'Canvas.measureText'); 
        const metrics = Reflect.apply(target, thisArg, argumentsList);
        if (spoofed[origin]) {
          // Spoof by adding a tiny floating point noise to the width
          return {
            ...metrics,
            width: metrics.width + (Math.random() * 0.001)
          };
        }
        return metrics;
      }
    });
  }

  // 2. WebGL
  if (WebGLRenderingContext && WebGLRenderingContext.prototype.getParameter) {
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    const webglProxyHandler = {
      apply(target, thisArg, argumentsList) {
        const origin = getCallerOrigin();
        const param = argumentsList[0];
        // 37445 = UNMASKED_VENDOR_WEBGL, 37446 = UNMASKED_RENDERER_WEBGL
        if (param === 37445 || param === 37446) {
          addScore(origin, 2, 'WebGL.getParameter(UNMASKED)');
          if (spoofed[origin]) {
            return param === 37445 ? "PrivacyLens Virtual GPU" : "PrivacyLens WebGL Renderer";
          }
        }
        return Reflect.apply(target, thisArg, argumentsList);
      }
    };
    WebGLRenderingContext.prototype.getParameter = new Proxy(origGetParameter, webglProxyHandler);
    if (typeof WebGL2RenderingContext !== 'undefined') {
      WebGL2RenderingContext.prototype.getParameter = new Proxy(WebGL2RenderingContext.prototype.getParameter, webglProxyHandler);
    }
  }

  if (WebGLRenderingContext && WebGLRenderingContext.prototype.readPixels) {
    const origReadPixels = WebGLRenderingContext.prototype.readPixels;
    const readPixelsProxy = {
      apply(target, thisArg, argumentsList) {
        const origin = getCallerOrigin();
        addScore(origin, 3, 'WebGL.readPixels');
        Reflect.apply(target, thisArg, argumentsList); // Execute original
        if (spoofed[origin] && argumentsList[6]) {
          // argumentsList[6] is the TypedArray receiving the pixels
          const pixels = argumentsList[6];
          for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = Math.max(0, Math.min(255, pixels[i] + NOISE_FACTOR));
          }
        }
      }
    };
    WebGLRenderingContext.prototype.readPixels = new Proxy(origReadPixels, readPixelsProxy);
    if (typeof WebGL2RenderingContext !== 'undefined') {
      WebGL2RenderingContext.prototype.readPixels = new Proxy(WebGL2RenderingContext.prototype.readPixels, readPixelsProxy);
    }
  }

  // 3. AudioContext
  if (window.OfflineAudioContext) {
    const origOfflineAudioContext = window.OfflineAudioContext;
    window.OfflineAudioContext = new Proxy(origOfflineAudioContext, {
      construct(target, args) {
        const origin = getCallerOrigin();
        addScore(origin, 2, 'OfflineAudioContext');
        return Reflect.construct(target, args);
      }
    });
  }

  if (window.OscillatorNode && OscillatorNode.prototype.start) {
    const origStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = new Proxy(origStart, {
      apply(target, thisArg, argumentsList) {
        const origin = getCallerOrigin();
        addScore(origin, 1, 'OscillatorNode.start');
        
        // Spoof by very slightly detuning the oscillator if tracking is detected
        if (spoofed[origin]) {
          if (thisArg.detune) {
             thisArg.detune.value += (Math.random() > 0.5 ? 1 : -1);
          }
        }
        return Reflect.apply(target, thisArg, argumentsList);
      }
    });
  }

  // 4. Navigator (Hardware & Plugins)
  const navHandler = {
    get(target, prop) {
      if (prop === 'hardwareConcurrency' || prop === 'deviceMemory') {
        const origin = getCallerOrigin();
        addScore(origin, 1, `navigator.${prop}`);
        if (spoofed[origin]) {
          // Spoof with generic common values
          return prop === 'hardwareConcurrency' ? 4 : 8; 
        }
      }
      return Reflect.get(target, prop);
    }
  };
  // We cannot easily proxy the navigator object directly, so we redefine the properties
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: new Proxy(Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency').get, {
        apply(target, thisArg, args) {
          const origin = getCallerOrigin();
          addScore(origin, 1, 'navigator.hardwareConcurrency');
          if (spoofed[origin]) return 4;
          return Reflect.apply(target, thisArg, args);
        }
      })
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      get: new Proxy(Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory').get, {
        apply(target, thisArg, args) {
          const origin = getCallerOrigin();
          addScore(origin, 1, 'navigator.deviceMemory');
          if (spoofed[origin]) return 8;
          return Reflect.apply(target, thisArg, args);
        }
      })
    });
  } catch (e) {
    // Some browsers prevent redefining navigator properties
  }

  // --- Anti-Tampering (Conceal the Proxies) ---
  const origToString = Function.prototype.toString;
  Function.prototype.toString = new Proxy(origToString, {
    apply(target, thisArg, argumentsList) {
      // If the script is asking for the string representation of our proxied functions
      if (thisArg && thisArg.name === 'toDataURL' || 
          thisArg.name === 'getImageData' || 
          thisArg.name === 'measureText' || 
          thisArg.name === 'getParameter' || 
          thisArg.name === 'readPixels' ||
          thisArg.name === 'start') {
        return `function ${thisArg.name}() { [native code] }`;
      }
      return Reflect.apply(target, thisArg, argumentsList);
    }
  });

})();
