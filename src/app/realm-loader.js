import { drawDragonChase, CHASE_WIDTH, CHASE_HEIGHT } from '../ui/dragon-chase.js';

// Cosmetic startup only. It must never hold the app open to finish the joke.
export function mountRealmLoader({ root = document.querySelector('#realm-loader'), maximumMs = 12000 } = {}) {
  if (!root) return () => {};
  // A plain bitmap canvas, not a GPU-backed one. This 384 x 176 scene is a few thousand small fills; setting up a GPU
  // surface for it stalls the main thread (over a second where the GPU is emulated in software) at the very moment the
  // app is trying to start. `willReadFrequently` is how a page asks for the bitmap kind; browsers without it ignore it.
  const canvas = root.querySelector('canvas'), ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!ctx) { root.remove(); return () => {}; }
  canvas.width = CHASE_WIDTH;
  canvas.height = CHASE_HEIGHT;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const shell = document.querySelector('.shell'), wasInert = shell?.inert;
  let ended = false, visible = false, frame = 0, elapsed = 800, last = null, lastPaint = -100;
  let revealTimer, deadlineTimer;
  const observer = new MutationObserver(check);

  function finish() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    clearTimeout(revealTimer);
    clearTimeout(deadlineTimer);
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibility);
    motion.removeEventListener('change', visibility);
    window.removeEventListener('pagehide', finish);
    if (shell && visible && !wasInert) shell.inert = false;
    root.remove();
  }

  function check() {
    // A modal can be the very next step (especially family sign-in), before boot resolves.
    if (document.body.dataset.ready === 'true' || document.querySelector('dialog[open]')) finish();
  }

  function tick(now) {
    if (ended || document.hidden) return;
    // A media preference can update before its change event is dispatched.
    if (motion.matches) { drawDragonChase(ctx, 1600); return; }
    if (last !== null) elapsed += Math.min(100, now - last);
    last = now;
    if (now - lastPaint >= 80) { drawDragonChase(ctx, elapsed); lastPaint = now; }
    frame = requestAnimationFrame(tick);
  }

  function visibility() {
    cancelAnimationFrame(frame);
    last = null;
    if (ended || !visible) return;
    if (motion.matches) drawDragonChase(ctx, 1600);
    else if (!document.hidden) frame = requestAnimationFrame(tick);
  }

  observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-ready', 'open'] });
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', visibility);
  window.addEventListener('pagehide', finish);
  check();
  if (!ended) {
    // Hidden by HTML by default: missing JS or canvas cannot strand the page behind a cover.
    deadlineTimer = setTimeout(finish, maximumMs);
    revealTimer = setTimeout(() => {
      check();
      if (ended) return;
      visible = true;
      root.hidden = false;
      if (shell) shell.inert = true;
      drawDragonChase(ctx, motion.matches ? 1600 : elapsed);
      visibility();
    }, 120);
  }
  return finish;
}

mountRealmLoader();
