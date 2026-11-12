import { reducedMotion } from './theme';

/**
 * Cutscene backdrops drawn with code on a 320×180 canvas, scaled up with crisp pixels:
 * the brothers' bedroom in 1996 and the monitor up close. No image files.
 */
export const SCENE_W = 320, SCENE_H = 180;

type Ctx = CanvasRenderingContext2D;
const rect = (c: Ctx, color: string, x: number, y: number, w: number, h: number) => { c.fillStyle = color; c.fillRect(x, y, w, h); };

// 3×5 digits for the alarm clock
const DIGITS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111', ':': '000010000010000',
};
function digits(c: Ctx, text: string, x: number, y: number, color: string) {
  c.fillStyle = color;
  [...text].forEach((ch, i) => [...DIGITS[ch]].forEach((b, j) => b === '1' && c.fillRect(x + i * 4 + (j % 3), y + Math.floor(j / 3), 1, 1)));
}

/** Tiny iso battlefield on a screen: what the brothers are playing. */
function gameOnScreen(c: Ctx, x: number, y: number, w: number, h: number, t: number) {
  rect(c, '#0e1a1c', x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2, s = Math.max(2, Math.floor(w / 22));
  for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) {
    const px = cx + (gx - gy) * s * 1.5, py = cy - s * 2 + (gx + gy) * s * 0.75;
    c.fillStyle = (gx + gy) % 2 ? '#4f9a4a' : '#5aad52';
    c.beginPath(); c.moveTo(px, py - s * 0.75); c.lineTo(px + s * 1.5, py); c.lineTo(px, py + s * 0.75); c.lineTo(px - s * 1.5, py); c.fill();
  }
  const bob = Math.floor(t / 400) % 2;
  rect(c, '#4f8cff', cx - s * 3, cy - s * 1.5 - bob, s, s * 1.4);
  rect(c, '#4f8cff', cx - s * 1.5, cy - s * 0.8, s, s * 1.4);
  rect(c, '#e8603c', cx + s * 2, cy + s * 0.2 - bob, s, s * 1.4);
  rect(c, '#e8603c', cx + s * 3.2, cy - s * 1.2, s, s * 1.4);
  // the cursor blinks on the active unit
  if (Math.floor(t / 300) % 2) rect(c, '#e0ac4a', cx - s * 3, cy - s * 2.6 - bob, s, 1);
  c.fillStyle = 'rgba(0,0,0,.25)';
  for (let sy = y; sy < y + h; sy += 2) c.fillRect(x, sy, w, 1);
}

function glow(c: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  c.save();
  c.globalAlpha = alpha;
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
}

interface Drop { x: number; y: number; v: number }

function bedroom(c: Ctx, t: number, rain: Drop[], flash: number) {
  // wall with faded striped wallpaper, carpet
  rect(c, '#33241d', 0, 0, SCENE_W, 128);
  for (let x = 0; x < SCENE_W; x += 12) rect(c, '#3a2a21', x, 0, 5, 128);
  rect(c, '#24180f', 0, 126, SCENE_W, 3); // skirting board
  rect(c, '#4a2c28', 0, 129, SCENE_W, 51);
  for (let i = 0; i < 60; i++) rect(c, '#55332e', (i * 53) % SCENE_W, 132 + ((i * 29) % 46), 2, 1);

  // window, rain outside
  rect(c, '#1d1510', 18, 14, 70, 58);
  rect(c, flash ? '#c9d6e6' : '#16212c', 22, 18, 62, 50);
  if (!flash) for (const d of rain) rect(c, '#5b7690', 22 + d.x, 18 + d.y, 1, 3);
  rect(c, '#1d1510', 52, 18, 3, 50);
  rect(c, '#1d1510', 22, 42, 62, 3);
  rect(c, '#2a1d15', 14, 70, 78, 4); // sill

  // poster: a knight under a sunset, sun-faded corners
  rect(c, '#e0ac4a', 112, 16, 34, 46);
  rect(c, '#ff8f3a', 114, 18, 30, 26);
  rect(c, '#f1e4c6', 124, 24, 10, 10);
  rect(c, '#241b15', 120, 34, 18, 20);
  rect(c, '#241b15', 128, 28, 2, 10);
  rect(c, '#8a6224', 114, 54, 30, 6);

  // bed, bottom left
  rect(c, '#2a1d15', 0, 112, 96, 8);
  rect(c, '#4a6b86', 0, 120, 92, 30);
  rect(c, '#5a7d98', 0, 120, 92, 6);
  rect(c, '#e8dcc0', 6, 114, 26, 10);
  rect(c, '#2a1d15', 0, 150, 96, 6);
  // nightstand and alarm clock
  rect(c, '#5a3a22', 98, 112, 26, 34);
  rect(c, '#46301c', 98, 112, 26, 3);
  rect(c, '#15110e', 104, 104, 16, 8);
  digits(c, '23:47', 105, 105, '#ff5a3a');

  // desk with lamp, computer, keyboard
  rect(c, '#6b4528', 150, 98, 160, 6);
  rect(c, '#4f3220', 156, 104, 6, 46);
  rect(c, '#4f3220', 298, 104, 6, 46);
  rect(c, '#3b2516', 236, 104, 62, 30);
  // tower case
  rect(c, '#cfc4a8', 272, 52, 26, 46);
  rect(c, '#a89c80', 294, 52, 4, 46);
  rect(c, '#8f846a', 276, 58, 18, 3);
  rect(c, '#8f846a', 276, 64, 18, 3);
  rect(c, Math.floor(t / 180) % 3 ? '#7cc64a' : '#2f4a22', 278, 88, 2, 2); // disk light
  // monitor
  rect(c, '#cfc4a8', 192, 46, 64, 50);
  rect(c, '#a89c80', 192, 90, 64, 6);
  rect(c, '#bdb296', 214, 96, 20, 4);
  gameOnScreen(c, 198, 52, 52, 36, t);
  // keyboard and mouse
  rect(c, '#bdb296', 200, 100, 48, 6);
  for (let k = 0; k < 10; k++) rect(c, '#a89c80', 202 + k * 4.6, 101, 3, 2);
  rect(c, '#cfc4a8', 256, 101, 6, 4);
  // lamp
  rect(c, '#2a1d15', 164, 92, 12, 6);
  rect(c, '#2a1d15', 169, 72, 2, 20);
  rect(c, '#8a6224', 160, 64, 20, 10);

  // the brothers, from behind: Nico on the chair at the keyboard, Teo standing, waiting his turn
  rect(c, '#2a1d15', 210, 132, 24, 4); // chair seat
  rect(c, '#2a1d15', 220, 136, 4, 20);
  rect(c, '#9b3a26', 208, 104, 28, 30); // Nico: red hoodie
  rect(c, '#b8442c', 208, 104, 28, 4);
  rect(c, '#2b1c14', 213, 88, 18, 17);  // hair
  rect(c, '#9b3a26', 236, 108, 8, 6);   // arm on the mouse
  rect(c, '#2f5fb3', 166, 108, 20, 32); // Teo: blue tee, standing to the left
  rect(c, '#4f8cff', 166, 108, 20, 4);
  rect(c, '#3a2614', 169, 92, 15, 16);
  rect(c, '#e2b48a', 184, 112, 4, 10);  // hand on the desk edge
  rect(c, '#2a3550', 168, 140, 7, 22);  // jeans
  rect(c, '#2a3550', 177, 140, 7, 22);

  // light: warm lamp, cold screen, dark corners
  glow(c, 170, 80, 90, '#ff8f3a', 0.35);
  glow(c, 224, 70, 80 + Math.sin(t / 90) * 2, '#7fd3e6', 0.28);
  if (flash) { c.fillStyle = `rgba(220,232,255,${0.35 * flash})`; c.fillRect(0, 0, SCENE_W, SCENE_H); }
  const v = c.createRadialGradient(SCENE_W / 2, SCENE_H / 2, 80, SCENE_W / 2, SCENE_H / 2, 200);
  v.addColorStop(0, 'transparent');
  v.addColorStop(1, 'rgba(8,6,4,.75)');
  c.fillStyle = v;
  c.fillRect(0, 0, SCENE_W, SCENE_H);
}

/** The monitor up close: the beige bezel fills the frame and the game glows on the glass. */
function crt(c: Ctx, t: number) {
  rect(c, '#15110e', 0, 0, SCENE_W, SCENE_H);
  rect(c, '#cfc4a8', 30, 6, 260, 168);
  rect(c, '#a89c80', 30, 160, 260, 14);
  rect(c, '#bdb296', 38, 14, 244, 142);
  gameOnScreen(c, 48, 22, 224, 126, t);
  rect(c, '#7cc64a', 262, 164, 4, 3); // power light
  glow(c, 160, 85, 150, '#7fd3e6', 0.18 + 0.02 * Math.sin(t / 70));
}

export interface SceneHandle { stop(): void; lightning(): void }

/** Draws `kind` on the canvas and keeps it animated until stop(). */
export function mountScene(canvas: HTMLCanvasElement, kind: 'bedroom' | 'crt'): SceneHandle {
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const c = canvas.getContext('2d')!;
  const rain: Drop[] = Array.from({ length: 40 }, (_, i) => ({ x: (i * 37) % 62, y: (i * 13) % 50, v: 1.2 + (i % 3) * 0.4 }));
  let flash = 0, raf = 0, last = performance.now();
  const still = reducedMotion();
  const frame = (t: number) => {
    const dt = Math.min(50, t - last) / 16;
    last = t;
    if (!still) for (const d of rain) { d.y += d.v * dt; d.x -= 0.2 * dt; if (d.y > 48) { d.y = 0; d.x = (d.x + 31) % 62; } if (d.x < 0) d.x += 62; }
    flash = Math.max(0, flash - 0.04 * dt);
    if (kind === 'bedroom') bedroom(c, still ? 0 : t, rain, flash);
    else crt(c, still ? 0 : t);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf), lightning: () => { flash = 1; } };
}
