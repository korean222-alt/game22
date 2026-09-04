/* Device capabilities, quality tiers, and the mobile shell.

   The game targets a phone held in landscape. That imposes three things a
   desktop build never has to think about:

     - A GPU an order of magnitude slower than a laptop's, so the render
       settings have to scale rather than being fixed at "looks best".
     - A viewport whose real height changes as browser chrome slides away, and
       whose corners are eaten by a notch and a home indicator.
     - No keyboard, and fingers instead of a mouse. */

export const TIERS = {
  low: { shadowSize: 1024, dprCap: 1.0, bloomLevels: 3, grain: 0.0, aberration: 0.0, vignette: 0.28 },
  mid: { shadowSize: 1536, dprCap: 1.5, bloomLevels: 4, grain: 0.008, aberration: 0.5, vignette: 0.32 },
  high: { shadowSize: 2048, dprCap: 2.0, bloomLevels: 5, grain: 0.012, aberration: 0.9, vignette: 0.34 },
};

export function isTouch() {
  return (navigator.maxTouchPoints || 0) > 1
    || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
}

export function isMobile() {
  // iPadOS reports itself as a Mac, so the touch-point count is the only
  // reliable tell there.
  const ua = navigator.userAgent;
  return /Android|iPhone|iPod|iPad|Mobile/i.test(ua)
    || (/Mac/.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1);
}

/* Pick a tier from what the GPU actually is, not from the screen size — a
   tablet can be faster than a laptop and a laptop can be running a software
   rasteriser. An explicit ?q=low|mid|high always wins, for testing. */
export function detectTier(gl) {
  const forced = new URLSearchParams(location.search).get('q');
  if (forced && TIERS[forced]) return forced;

  let renderer = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
  } catch (e) { /* the extension is gated in some privacy modes */ }

  if (/swiftshader|llvmpipe|software|basic render|angle \(google/i.test(renderer)) return 'low';

  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (isMobile()) {
    // Apple's mobile GPUs comfortably carry the mid tier; the wide Android
    // field does not, so cores and memory decide.
    if (/apple/i.test(renderer)) return cores >= 6 ? 'high' : 'mid';
    return (cores >= 8 && mem >= 6) ? 'mid' : 'low';
  }
  if (cores <= 2 || mem <= 2) return 'low';
  return 'high';
}

/* The viewport the game should actually draw into. visualViewport tracks the
   area left after the URL bar and keyboard, which `innerHeight` does not. */
export function viewportSize() {
  const vv = window.visualViewport;
  return {
    w: Math.round(vv ? vv.width : window.innerWidth),
    h: Math.round(vv ? vv.height : window.innerHeight),
  };
}

export function isPortrait() {
  const { w, h } = viewportSize();
  return h > w;
}

/* Fullscreen and orientation lock. Both need a user gesture and both are
   routinely refused (iOS Safari has no Fullscreen API on iPhone at all), so
   every call is best-effort and nothing downstream may depend on it. */
export async function goFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } else if (el.webkitRequestFullscreen && !document.webkitFullscreenElement) {
      el.webkitRequestFullscreen();
    }
  } catch (e) { /* refused; the portrait guard still covers us */ }
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) { /* not permitted outside fullscreen on most browsers */ }
}

export function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

export async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (e) { /* ignore */ }
}

/* Already running from the home screen? Then there is nothing to install and
   the guide must never appear. iOS answers with a non-standard property; every
   other browser reports the display-mode media query the manifest asked for. */
export function isStandalone() {
  if (navigator.standalone) return true;
  try {
    return ['standalone', 'fullscreen', 'minimal-ui']
      .some((m) => matchMedia(`(display-mode: ${m})`).matches);
  } catch (e) { return false; }
}

export function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua)
    || (/Mac/.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1);
}

/* The add-to-home-screen guide.

   The game is a website first and an installed app second, and on a phone the
   two are genuinely different products: the browser's own chrome takes a third
   of a landscape screen and blocks the fullscreen request the game makes on
   first touch. So the first visit explains how to install it — and, because
   nothing is more irritating than a banner that will not take no for an
   answer, "다시 보지 않기" is remembered forever and "닫기" for this session. */
const A2HS_KEY = 'socialdev3d.a2hs.dismissed';

export function shouldShowInstallGuide() {
  if (isStandalone()) return false;
  if (!isTouch()) return false;                     // a desktop browser is fine as it is
  try { if (localStorage.getItem(A2HS_KEY)) return false; } catch (e) { /* private mode */ }
  try { if (sessionStorage.getItem(A2HS_KEY)) return false; } catch (e) { /* ignore */ }
  return true;
}

export function wireInstallGuide(root) {
  if (!root) return;
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  const ios = document.getElementById('a2ios');
  const and = document.getElementById('a2and');
  const useIOS = isIOS();
  for (const t of root.querySelectorAll('.a2tab')) {
    const wants = t.dataset.os;
    t.classList.toggle('on', wants === (useIOS ? 'ios' : 'and'));
    t.onclick = () => {
      for (const o of root.querySelectorAll('.a2tab')) o.classList.remove('on');
      t.classList.add('on');
      if (ios) ios.hidden = wants !== 'ios';
      if (and) and.hidden = wants !== 'and';
    };
  }
  if (ios) ios.hidden = !useIOS;
  if (and) and.hidden = useIOS;

  const hide = () => root.classList.remove('show');
  on('a2close', () => {
    // Closed, not refused: ask again next time the game is opened fresh.
    try { sessionStorage.setItem(A2HS_KEY, '1'); } catch (e) { /* ignore */ }
    hide();
  });
  on('a2never', () => {
    try { localStorage.setItem(A2HS_KEY, '1'); } catch (e) { /* ignore */ }
    hide();
  });
  root.classList.add('show');
}

/* Stop the browser gestures that fight a full-screen canvas game: pull to
   refresh, double-tap zoom, long-press selection, and the iOS rubber band. */
export function suppressBrowserGestures(canvas) {
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('contextmenu', (e) => {
    // Allow the context menu on real inputs; block the long-press menu on the
    // canvas and the HUD, where it only ever interrupts play.
    if (e.target && e.target.tagName === 'INPUT') return;
    stop(e);
  });

  // Double-tap to zoom fires as two clicks under 300ms with no scroll between.
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 320) stop(e);
    lastTouch = now;
  }, { passive: false });

  // Any touch that starts on the canvas is the game's, never the page's.
  canvas.addEventListener('touchstart', stop, { passive: false });
  canvas.addEventListener('touchmove', stop, { passive: false });
}

/* Keep --vh and --vw in sync with the real visual viewport so the layout can
   use them instead of 100vh, which on mobile means "the height the page would
   have if the URL bar were hidden" and is therefore wrong most of the time. */
export function trackViewport(onChange) {
  const apply = () => {
    const { w, h } = viewportSize();
    const r = document.documentElement.style;
    r.setProperty('--vh', h + 'px');
    r.setProperty('--vw', w + 'px');
    document.body.classList.toggle('portrait', h > w);
    // Below this the panel and the 3D view cannot both be useful at once, so
    // the layout switches to a compact, collapsible arrangement.
    document.body.classList.toggle('compact', h < 470);
    if (onChange) onChange(w, h);
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 220));
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', apply);
    visualViewport.addEventListener('scroll', apply);
  }
  return apply;
}
