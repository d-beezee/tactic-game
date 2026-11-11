import Phaser from 'phaser';
import { CLASSES, DIRS, heightAt, key, terrainAt, type Dir, type MapData, type Pos, type Terrain, type Unit } from '@tactics/core';

const TW = 64, TH = 32, HS = 16, BASE = 16;
const UNIT_TOP = 64; // sprite height above the tile, for camera bounds

export const TEAM_COLOR = { A: 0x4f8cff, B: 0xe8673c } as const;

// Kenney "Isometric Landscape" (CC0): top face is 132×66 centred at (66,33), one block side is 33px = one height step once scaled to TW.
const TILE_SRC_W = 132, TILE_TOP_CY = 33;
const TILE_FOR: Record<Terrain, string> = { grass: 'grass', dirt: 'dirt', stone: 'stone', water: 'water', blocked: 'grass' };
const FILLER = 'dirt';

/** Screen position of the centre of a cell's top face, from VIEW coordinates (after camera rotation). */
const iso = (x: number, y: number, h: number) => ({ x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - h * HS });
const DIR_LIST = Object.keys(DIRS) as Dir[];

interface UnitSprite { c: Phaser.GameObjects.Container; arrow: Phaser.GameObjects.Graphics; hp: Phaser.GameObjects.Graphics; ring: Phaser.GameObjects.Graphics; img?: Phaser.GameObjects.Image; classId: string }

// 48×48 pixel-art idle frames, one per view facing (view N/E/S/W = screen NE/SE/SW/NW). Classes without art use the placeholder body.
const SPRITE_CLASSES = ['warrior', 'archer', 'cleric', 'paladin', 'ranger', 'sage'];
const SPRITE_SCALE = 1.25, SPRITE_FEET_Y = 46 / 48;
const spriteKey = (classId: string, d: Dir) => `${classId}-${d}`;

/** Screen space kept free for HTML UI around the map. */
export interface Insets { top: number; right: number; bottom: number; left: number }
// phones: timeline + banner on top, unit card + two button rows below
const battleInsets = (w: number): Insets => ({ top: w < 640 ? 120 : 70, right: 0, bottom: w < 640 ? 300 : 110, left: 0 });

export class BattleScene extends Phaser.Scene {
  private overlays = new Map<string, Phaser.GameObjects.Graphics>();
  private sprites = new Map<string, UnitSprite>();
  private hits = new Map<string, { p: Pos; poly: Phaser.Geom.Polygon; depth: number }>();
  private cellObjects = new Map<string, Phaser.GameObjects.GameObject[]>();
  /** Camera rotation in 90° steps. Game logic stays in grid coordinates; only drawing uses view coordinates. */
  private rot = 0;
  private units = new Map<string, Unit>();
  private lit: { cells: Pos[]; color: number; alpha: number }[] = [];
  /** Drag to pan, pinch or wheel to zoom. Off in the editor, where dragging paints. */
  pannable = true;
  /** set while something else owns the pointer (deploy drag) */
  panLock = false;
  private dragged = false;
  private pinch = 0;
  private fit = { zoom: 1, minX: 0, maxX: 0, minY: 0, maxY: 0 };

  constructor(
    private mapData: MapData,
    private initialUnits: Unit[],
    private onReady: (scene: BattleScene) => void,
    private insets: (width: number, height: number) => Insets = battleInsets,
  ) {
    super('battle');
  }

  // ---------- grid ↔ view ----------

  private view(p: Pos): Pos {
    let { x, y } = p, w = this.mapData.width, h = this.mapData.height;
    for (let i = 0; i < this.rot; i++) [x, y, w, h] = [h - 1 - y, x, h, w];
    return { x, y };
  }

  private viewDims() {
    const { width: w, height: h } = this.mapData;
    return this.rot % 2 ? { w: h, h: w } : { w, h };
  }

  /** Where a cell is drawn: grid pos + height to world coordinates. */
  private at(p: Pos, h = heightAt(this.mapData, p)) {
    const v = this.view(p);
    return iso(v.x, v.y, h);
  }

  private depthOf(p: Pos) {
    const v = this.view(p);
    return (v.x + v.y) * 10;
  }

  private rotateDir(d: Dir, steps: number): Dir {
    let x: number = DIRS[d].x, y: number = DIRS[d].y;
    for (let i = 0; i < ((steps % 4) + 4) % 4; i++) [x, y] = [-y, x];
    return DIR_LIST.find(k => DIRS[k].x === x && DIRS[k].y === y)!;
  }

  /** Grid facing as seen on screen. */
  private viewDir(d: Dir): Dir { return this.rotateDir(d, this.rot); }

  /** Screen direction (as the HUD arrows show it) back to a grid facing. */
  gridDir(screen: Dir): Dir { return this.rotateDir(screen, -this.rot); }

  /** Rotate the camera by 90° steps; redraws map, units and current highlights. */
  rotate(steps: 1 | -1) {
    this.rot = (this.rot + steps + 4) % 4;
    const lit = this.lit;
    this.setMap(this.mapData);
    for (const u of this.units.values()) this.syncUnit(u);
    for (const l of lit) this.highlight(l.cells, l.color, l.alpha);
  }

  preload() {
    for (const t of ['grass', 'dirt', 'stone', 'water']) this.load.image(t, `tiles/${t}.png`);
    for (const c of SPRITE_CLASSES) for (const d of DIR_LIST) this.load.image(spriteKey(c, d), `units/${c}/${d}.png`);
  }

  create() {
    for (const c of SPRITE_CLASSES) for (const d of DIR_LIST) this.textures.get(spriteKey(c, d)).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.setMap(this.mapData);
    for (const u of this.initialUnits) this.addUnit(u);
    this.scale.on('resize', () => this.fitCamera());
    this.setupPanZoom();
    this.onReady(this);
  }

  /**
   * Taps, drag-to-pan and pinch-zoom from native DOM pointer events: unique ids per finger, and no stale
   * pointers left behind by touches on the HTML UI (Phaser's own pointers can keep those as "down").
   */
  private setupPanZoom() {
    const canvas = this.game.canvas, cam = this.cameras.main;
    const down = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0 };
    canvas.addEventListener('pointerdown', e => {
      if (!down.size) { this.dragged = false; start = { x: e.clientX, y: e.clientY }; }
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinch = 0;
    });
    window.addEventListener('pointermove', e => {
      const prev = down.get(e.pointerId);
      if (!prev) return;
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!this.pannable || this.panLock) return;
      if (down.size >= 2) {
        const [a, b] = [...down.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoomBy(d / this.pinch);
        this.pinch = d;
        this.dragged = true;
        return;
      }
      if (!this.dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) return;
      this.dragged = true;
      cam.scrollX -= (e.clientX - prev.x) / cam.zoom;
      cam.scrollY -= (e.clientY - prev.y) / cam.zoom;
      this.clampCamera();
    });
    const up = (e: PointerEvent) => {
      if (!down.delete(e.pointerId)) return;
      this.pinch = 0;
      // a tap (no pan, no pinch) on a cell
      if (!down.size && !this.dragged && e.type === 'pointerup') {
        const p = this.cellAt(e.clientX, e.clientY);
        if (p) this.events.emit('cell', p);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { if (this.pannable) { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });
  }

  private zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, this.fit.zoom, Math.max(this.fit.zoom * 3, 1.6)));
    this.clampCamera();
  }

  /** Keep the view centre over the map. */
  private clampCamera() {
    const cam = this.cameras.main, f = this.fit;
    // midPoint is only refreshed at render time, so derive the centre from scroll
    const cx = cam.scrollX + cam.width / 2, cy = cam.scrollY + cam.height / 2;
    cam.centerOn(Phaser.Math.Clamp(cx, f.minX, f.maxX), Phaser.Math.Clamp(cy, f.minY, f.maxY));
  }

  /** Bring a cell into view when zoomed in past the whole-map fit. */
  focus(p: Pos) {
    const cam = this.cameras.main;
    if (cam.zoom <= this.fit.zoom * 1.05) return;
    const ins = this.insets(this.scale.width, this.scale.height);
    const w = this.at(p);
    cam.pan(w.x + (ins.right - ins.left) / 2 / cam.zoom, w.y - 30 + (ins.bottom - ins.top) / 2 / cam.zoom, 350, 'Sine.easeOut');
  }

  /** Redraw the whole map (new map or new size) and refit the camera. */
  setMap(m: MapData) {
    for (const objs of this.cellObjects.values()) for (const o of objs) o.destroy();
    this.cellObjects.clear();
    this.hits.clear();
    this.overlays.clear();
    this.lit = [];
    this.mapData = m;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) this.drawCell({ x, y });
    this.fitCamera();
  }

  /** Redraw one cell after its height or terrain changed. Camera stays put. */
  redrawCell(m: MapData, p: Pos) {
    this.mapData = m;
    for (const o of this.cellObjects.get(key(p)) ?? []) o.destroy();
    this.drawCell(p);
  }

  private drawCell(p: Pos) {
    const m = this.mapData;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const h = heightAt(m, p), t = terrainAt(m, p);
    const c = this.at(p, h), down = h * HS + BASE, depth = this.depthOf(p);
    const top = { x: c.x, y: c.y - TH / 2 }, right = { x: c.x + TW / 2, y: c.y }, bottom = { x: c.x, y: c.y + TH / 2 }, left = { x: c.x - TW / 2, y: c.y };
    // stack one block per height step: filler blocks below, terrain block on top
    for (let l = 0; l <= h; l++) {
      const tex = l === h ? TILE_FOR[t] : FILLER;
      const at = this.at(p, l);
      const img = this.add.image(at.x, at.y, tex).setDepth(depth + l * 0.05);
      img.setOrigin(0.5, TILE_TOP_CY / img.height).setScale(TW / TILE_SRC_W);
      objs.push(img);
    }
    const g = this.add.graphics().setDepth(depth + 0.9);
    g.lineStyle(1, 0x000000, 0.18).strokePoints([top, right, bottom, left], true);
    if (t === 'blocked') {
      // a pine tree: impassable marker
      g.fillStyle(0x5a3d22).fillRect(c.x - 3, c.y - 10, 6, 10);
      g.fillStyle(0x2e5e2a).fillTriangle(c.x - 16, c.y - 8, c.x + 16, c.y - 8, c.x, c.y - 46);
    }
    // hit area covers the whole visible column, so tapping a cliff face picks the cell in front
    const hit = new Phaser.Geom.Polygon([top, right, { x: right.x, y: right.y + down }, { x: bottom.x, y: bottom.y + down }, { x: left.x, y: left.y + down }, left]);
    this.hits.set(key(p), { p, poly: hit, depth });
    const overlay = this.add.graphics().setDepth(depth + 1);
    this.overlays.set(key(p), overlay);
    objs.push(g, overlay);
    this.cellObjects.set(key(p), objs);
  }

  private fitCamera() {
    const maxH = Math.max(...this.mapData.heights.flat());
    const v = this.viewDims();
    const minX = iso(0, v.h - 1, 0).x - TW / 2, maxX = iso(v.w - 1, 0, 0).x + TW / 2;
    const minY = iso(0, 0, maxH).y - TH / 2 - UNIT_TOP, maxY = iso(v.w - 1, v.h - 1, 0).y + TH / 2 + BASE;
    const { width, height } = this.scale;
    const ins = this.insets(width, height);
    const cam = this.cameras.main;
    const fitW = (width - ins.left - ins.right) / (maxX - minX), fitH = (height - ins.top - ins.bottom) / (maxY - minY);
    const fit = Math.min(fitW, fitH) * 0.95;
    // narrow portrait screens: a whole-map fit leaves tiles too small to tap, so start closer and let the player pan
    const zoom = this.pannable && width < 640 ? Math.max(fit, Math.min(fitH * 0.95, 0.85)) : fit;
    cam.setZoom(zoom);
    this.fit = { zoom: fit, minX, maxX, minY, maxY };
    // centre the map in the area left free by the HTML UI
    cam.centerOn((minX + maxX) / 2 + (ins.right - ins.left) / 2 / cam.zoom, (minY + maxY) / 2 + (ins.bottom - ins.top) / 2 / cam.zoom);
  }

  /** Cell under a page (client) coordinate; front-most column wins. */
  cellAt(clientX: number, clientY: number): Pos | null {
    const rect = this.game.canvas.getBoundingClientRect();
    const w = this.cameras.main.getWorldPoint(clientX - rect.left, clientY - rect.top);
    let best: { p: Pos; depth: number } | null = null;
    for (const h of this.hits.values()) if ((!best || h.depth > best.depth) && h.poly.contains(w.x, w.y)) best = h;
    return best?.p ?? null;
  }

  removeUnit(id: string) {
    this.sprites.get(id)?.c.destroy();
    this.sprites.delete(id);
    this.units.delete(id);
  }

  addUnit(u: Unit) {
    const c = this.add.container();
    // team-coloured base disc: both teams share the same character art
    const base = this.add.graphics().fillStyle(0x000000, 0.35).fillEllipse(0, 1, 34, 15).fillStyle(TEAM_COLOR[u.team], 0.85).fillEllipse(0, 0, 30, 12);
    const ring = this.add.graphics();
    const arrow = this.add.graphics();
    const hp = this.add.graphics();
    let figure: Phaser.GameObjects.GameObject[];
    let img: Phaser.GameObjects.Image | undefined;
    if (SPRITE_CLASSES.includes(u.classId)) {
      img = this.add.image(0, 0, spriteKey(u.classId, u.facing)).setOrigin(0.5, SPRITE_FEET_Y).setScale(SPRITE_SCALE);
      // both teams share the art: a warm cast marks the enemy at a glance
      if (u.team === 'B') img.setTint(0xffbfa8);
      figure = [img];
    } else {
      const body = this.add.graphics();
      body.fillStyle(TEAM_COLOR[u.team]).lineStyle(2, 0x1b1712).fillRoundedRect(-10, -34, 20, 28, 5).strokeRoundedRect(-10, -34, 20, 28, 5);
      body.fillStyle(0xf1c9a0).fillCircle(0, -42, 8).strokeCircle(0, -42, 8);
      const letter = this.add.text(0, -20, CLASSES[u.classId].name[0], { fontFamily: '"Jersey 15", system-ui', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
      figure = [body, letter];
    }
    c.add([base, ring, arrow, ...figure, hp]);
    this.sprites.set(u.id, { c, arrow, hp, ring, img, classId: u.classId });
    this.syncUnit(u);
  }

  syncUnit(u: Unit) {
    const s = this.sprites.get(u.id)!;
    this.units.set(u.id, u);
    const p = this.at(u.pos);
    s.c.setPosition(p.x, p.y + (u.hp <= 0 && s.c.alpha < 1 ? 8 : 0)).setDepth(this.depthOf(u.pos) + 5);
    this.face(s, u.facing);
    // team-coloured frame around the HP bar
    s.hp.clear().fillStyle(TEAM_COLOR[u.team]).fillRect(-18, -66, 36, 9).fillStyle(0x000000, 0.75).fillRect(-16, -64, 32, 5).fillStyle(u.hp / u.stats.maxHp > 0.35 ? 0x6cc04a : 0xf2c14e).fillRect(-16, -64, (32 * u.hp) / u.stats.maxHp, 5);
    if (u.hp <= 0 && s.c.alpha === 1) this.tweens.add({ targets: s.c, alpha: 0, y: p.y + 8, duration: 400 });
  }

  private face(s: UnitSprite, gridFacing: Dir) {
    const f = this.viewDir(gridFacing);
    s.img?.setTexture(spriteKey(s.classId, f));
    const d = DIRS[f];
    const v = { x: ((d.x - d.y) * TW) / 2, y: ((d.x + d.y) * TH) / 2 };
    const len = Math.hypot(v.x, v.y), n = { x: v.x / len, y: v.y / len }, perp = { x: -n.y * 6, y: n.x * 6 };
    const tri = [n.x * 26, n.y * 26, n.x * 14 + perp.x, n.y * 14 + perp.y, n.x * 14 - perp.x, n.y * 14 - perp.y] as const;
    s.arrow.clear().fillStyle(0xfff3c4).lineStyle(1.5, 0x1b1712).fillTriangle(...tri).strokeTriangle(...tri);
  }

  /** Show a facing without changing the unit: preview before the turn ends. */
  showFacing(unitId: string, d: Dir) {
    const s = this.sprites.get(unitId);
    if (s) this.face(s, d);
  }

  setActive(unitId: string | null) {
    for (const [id, s] of this.sprites) {
      s.ring.clear();
      if (id === unitId) s.ring.lineStyle(3, 0xf2c14e).strokeEllipse(0, 0, 40, 18);
    }
  }

  highlight(cells: Pos[], color: number, alpha = 0.45) {
    this.lit.push({ cells, color, alpha });
    for (const p of cells) {
      const c = this.at(p);
      const pts = [{ x: c.x, y: c.y - TH / 2 + 2 }, { x: c.x + TW / 2 - 3, y: c.y }, { x: c.x, y: c.y + TH / 2 - 2 }, { x: c.x - TW / 2 + 3, y: c.y }];
      this.overlays.get(key(p))!.fillStyle(color, alpha).fillPoints(pts, true).lineStyle(2, color, Math.min(1, alpha * 2)).strokePoints(pts, true);
    }
  }

  clearHighlights() {
    for (const g of this.overlays.values()) g.clear();
    this.lit = [];
  }

  async animateMove(unitId: string, path: Pos[]) {
    const s = this.sprites.get(unitId)!;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const ha = heightAt(this.mapData, a), hb = heightAt(this.mapData, b);
      const to = this.at(b, hb);
      this.face(s, DIR_LIST.find(d => DIRS[d].x === b.x - a.x && DIRS[d].y === b.y - a.y)!);
      s.c.setDepth(Math.max(this.depthOf(a), this.depthOf(b)) + 5);
      const startX = s.c.x, startY = s.c.y;
      // small hop when the height changes
      const hop = ha !== hb ? 14 : 0;
      await new Promise<void>(done =>
        this.tweens.addCounter({
          from: 0, to: 1, duration: hop ? 200 : 130,
          onUpdate: tw => {
            const t = tw.getValue() ?? 0;
            s.c.x = Phaser.Math.Linear(startX, to.x, t);
            s.c.y = Phaser.Math.Linear(startY, to.y, t) - Math.sin(t * Math.PI) * hop;
          },
          onComplete: () => done(),
        }),
      );
    }
  }

  floatText(unit: Unit, text: string, color: string) {
    const p = this.at(unit.pos);
    const t = this.add.text(p.x, p.y - 64, text, { fontFamily: '"Jersey 15", system-ui', fontSize: '28px', color, stroke: '#1b1712', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(10_000);
    this.tweens.add({ targets: t, y: t.y - 30, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }
}
