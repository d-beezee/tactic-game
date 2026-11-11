import Phaser from 'phaser';

/**
 * Pixel-art terrain drawn in code at boot, at the same pixel density as the unit sprites (1 texel = 1.25 world px).
 * One block = top diamond + one height step of side. Light comes from the top-left of the screen, so the
 * left face is lit and the right face is in shade whatever the camera rotation.
 */
export const BLOCK = { w: 48, top: 24, side: 12, scale: 1.25 } as const;
export const WATER_FRAMES = 3;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// [dark, mid, light, highlight] for the top face, [dark, mid, light] for the sides
const PAL: Record<string, { top: string[]; side: string[]; lip?: boolean }> = {
  grass: { top: ['#3f6b2f', '#5a8f3a', '#79b04a', '#a9d46a'], side: ['#5c3d24', '#74502f', '#8b6440'], lip: true },
  dirt: { top: ['#6e4b2c', '#8a6038', '#a77a48', '#c9a067'], side: ['#4e3420', '#634329', '#7a5534'] },
  stone: { top: ['#5f5a55', '#7b756c', '#9a9286', '#c4baa8'], side: ['#45403b', '#57514b', '#6b645c'] },
  water: { top: ['#1f4f6e', '#2b6a8c', '#3d8bb0', '#9fd8ee'], side: ['#1a3a50', '#21475f', '#285570'] },
};
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const hash = (x: number, y: number) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (put: (x: number, y: number, c: RGB, k?: number) => void) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const img = tex.context.createImageData(w, h);
  draw((x, y, c, k = 1) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    img.data[i] = c[0] * k; img.data[i + 1] = c[1] * k; img.data[i + 2] = c[2] * k; img.data[i + 3] = 255;
  });
  tex.context.putImageData(img, 0, 0);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

function block(scene: Phaser.Scene, key: string, terrain: string, frame = -1) {
  const { w, top, side } = BLOCK;
  const p = PAL[terrain];
  const topC = p.top.map(hex), sideC = p.side.map(hex), lipC = hex(PAL.grass.top[1]);
  canvasTexture(scene, key, w, top + side, put => {
    // sides first: the top face overwrites the shared edge
    for (let x = 0; x < w; x++) {
      const dx = x - w / 2 + 0.5, left = dx < 0;
      const edge = Math.floor(top - Math.abs(dx) / 2);
      for (let d = 0; d < side; d++) {
        const lip = p.lip && d < 3 + (hash(x, 7) > 0.6 ? 1 : 0);
        let c = lip ? lipC : sideC[Math.floor((d + (hash(x >> 2, 3) > 0.5 ? 1 : 0)) / 4) % 2 ? 1 : 2];
        if (!lip && hash(x, d + 11) > 0.92) c = sideC[0];
        let k = left ? 0.86 : 0.6;
        if (d === side - 1) k *= 0.55;
        if (Math.abs(dx) < 1) k *= 0.8; // the vertical crease between the faces
        put(x, edge + d, c, k);
      }
    }
    for (let y = 0; y < top; y++) {
      const dy = y - top / 2 + 0.5;
      const half = (top / 2 - Math.abs(dy)) * 2;
      for (let x = Math.ceil(w / 2 - half); x < Math.floor(w / 2 + half); x++) {
        const dx = x - w / 2 + 0.5;
        const toLight = 1 - ((x / w) * 0.5 + (y / top) * 0.5);
        let idx = (hash(x + 101, y) * 0.55 + toLight * 0.45) * 16 > BAYER[y & 3][x & 3] + 2 ? 2 : 1;
        if (hash(x * 3, y * 7) > 0.94) idx = terrain === 'grass' ? 3 : 0;
        if (hash(x * 5 + 1, y * 3) > 0.97) idx = 0;
        if (frame >= 0) {
          const v = Math.sin(x * 0.35 + y * 0.9 + frame * 2.1) + Math.sin(x * 0.11 - frame * 1.3);
          idx = v > 1.45 ? 3 : v > 0.6 ? 2 : 1;
        }
        const rim = Math.abs(dx) + 2 * Math.abs(dy) > w / 2 - 2.2;
        if (rim) idx = dy < 0 && dx < 2 ? 3 : 0; // lit upper-left rim, dark lower edges
        put(x, y, topC[idx]);
      }
    }
  });
}

/** A pine for impassable cells. */
function tree(scene: Phaser.Scene) {
  const W = 22, H = 36, out = hex('#13200f'), leaf = ['#1f3b1b', '#2e5e2a', '#4a8a3a'].map(hex), bark = hex('#5a3d22');
  canvasTexture(scene, 'tree', W, H, put => {
    for (let y = 29; y < H; y++) for (let x = 9; x < 13; x++) put(x, y, bark, x < 11 ? 1 : 0.7);
    // three stepped tiers, widest at the bottom
    for (const [top, bottom, half] of [[0, 12, 6], [7, 21, 8], [15, 31, 11]]) {
      for (let y = top; y < bottom; y++) {
        const hw = Math.round(((y - top + 1) / (bottom - top)) * half);
        for (let x = W / 2 - hw; x < W / 2 + hw; x++) {
          const edge = x === W / 2 - hw || x === W / 2 + hw - 1 || y === bottom - 1;
          const c = edge ? out : leaf[x < W / 2 - 2 ? 2 : x < W / 2 + 3 ? 1 : 0];
          put(x, y, c, !edge && hash(x, y) > 0.85 ? 0.8 : 1);
        }
      }
    }
  });
}

/** Builds every generated texture once per game. */
export function makeTextures(scene: Phaser.Scene) {
  for (const t of ['grass', 'dirt', 'stone']) block(scene, `blk-${t}`, t);
  for (let f = 0; f < WATER_FRAMES; f++) block(scene, `blk-water-${f}`, 'water', f);
  tree(scene);
  // soft round light, for the active unit and unit shadows
  if (!scene.textures.exists('glow')) {
    const tex = scene.textures.createCanvas('glow', 64, 64)!;
    const g = tex.context.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    tex.context.fillStyle = g; tex.context.fillRect(0, 0, 64, 64); tex.refresh();
  }
  canvasTexture(scene, 'mote', 2, 2, put => { for (let i = 0; i < 4; i++) put(i & 1, i >> 1, [255, 255, 255]); });
}
