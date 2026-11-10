import { drawDragonChase, CHASE_DURATION } from './dragon-chase.js';

const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
const play = document.querySelector('#chase-play'), replay = document.querySelector('#chase-replay');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let running = !motion.matches, elapsed = motion.matches ? 1600 : 0, last = null, lastPaint = -100, frame = 0;

function tick(now) {
  if (!running || document.hidden) return;
  if (last !== null) elapsed = (elapsed + Math.min(100, now - last)) % CHASE_DURATION;
  last = now;
  if (now - lastPaint >= 80) { drawDragonChase(ctx, elapsed); lastPaint = now; }
  frame = requestAnimationFrame(tick);
}
function update() {
  cancelAnimationFrame(frame);
  last = null;
  play.textContent = running ? 'Pause' : 'Play';
  drawDragonChase(ctx, elapsed);
  if (running && !document.hidden) frame = requestAnimationFrame(tick);
}
play.addEventListener('click', () => { running = !running; update(); });
replay.addEventListener('click', () => { elapsed = 0; running = true; update(); });
motion.addEventListener('change', () => { running = !motion.matches; if (!running) elapsed = 1600; update(); });
document.addEventListener('visibilitychange', update);
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(frame); });
update();
