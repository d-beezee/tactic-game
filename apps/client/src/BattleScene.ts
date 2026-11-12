import Phaser from 'phaser';
import { CLASSES, DIRS, heightAt, key, raceOf, terrainAt, type Dir, type MapData, type Pos, type Side, type StatusId, type Unit } from '@tactics/core';
import { buzz, play } from './sfx';
import { COLOR, TEAM_COLOR, reducedMotion, settings } from './theme';
import { ALL_SPRITE_DIRS, spriteDir } from './sprites';
import { BLOCK, WATER_FRAMES, makeTextures } from './tiles';

export { TEAM_COLOR } from './theme';

// One texel of terrain = one texel of a unit sprite = 1.25 world px.
const TW = BLOCK.w * BLOCK.scale, TH = BLOCK.top * BLOCK.scale, HS = BLOCK.side * BLOCK.scale, BASE = HS;
const UNIT_TOP = 64; // sprite height above the tile, for camera bounds

/** Screen position of the centre of a cell's top face, from VIEW coordinates (after camera rotation). */
const iso = (x: number, y: number, h: number) => ({ x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - h * HS });
const DIR_LIST = Object.keys(DIRS) as Dir[];

interface UnitSprite {
  c: Phaser.GameObjects.Container; arrow: Phaser.GameObjects.Graphics; hp: Phaser.GameObjects.Graphics; ring: Phaser.GameObjects.Graphics;
  glow: Phaser.GameObjects.Image; img?: Phaser.GameObjects.Image; body: Phaser.GameObjects.Container; dir: string | null;
  statuses: Phaser.GameObjects.Graphics;
}

// 48×48 pixel-art idle frames, one per view facing (view N/E/S/W = screen NE/SE/SW/NW). Units without art use the placeholder body.
const SPRITE_SCALE = BLOCK.scale, SPRITE_FEET_Y = 46 / 48;
const spriteKey = (dir: string, d: Dir) => `${dir}-${d}`;

/** Pip colour of each status, above the HP bar. */
const STATUS_COLOR: Record<StatusId, number> = {
  poison: 0x9ad13b, regen: 0x22c3b0, stun: 0xffc83d, root: 0xa0703a, 'atk-up': 0xff8a3d, 'def-up': 0x6aa8ff, 'atk-down': 0x8a7f72, 'def-down': 0x5f574d,
};

/** Screen space kept free for HTML UI around the map. */
export interface Insets { top: number; right: number; bottom: number; left: number }
// phones: timeline + banner on top, unit card + two button rows below
const battleInsets = (w: number): Insets => ({ top: w < 640 ? 140 : 150, right: 0, bottom: w < 640 ? 300 : 120, left: 0 });

const SIDE_LABEL: Record<Side, string> = { front: '', flank: 'Di fianco ×1,25', back: 'Alle spalle ×1,5' };

export class BattleScene extends Phaser.Scene {
  private overlays = new Map<string, Phaser.GameObjects.Graphics>();
  private sprites = new Map<string, UnitSprite>();
  private hits = new Map<string, { p: Pos; poly: Phaser.Geom.Polygon; depth: number }>();
  private cellObjects = new Map<string, Phaser.GameObjects.GameObject[]>();
  private water = new Set<Phaser.GameObjects.Image>();
  /** Camera rotation in 90° steps. Game logic stays in grid coordinates; only drawing uses view coordinates. */
  private rot = 0;
  private units = new Map<string, Unit>();
  private lit: { cells: Pos[]; color: number; alpha: number }[] = [];
  /** cells a battle goal asks to reach: always lit, under every other highlight */
  private goalCells: Pos[] = [];
  private cursor!: Phaser.GameObjects.Graphics;
  private path!: Phaser.GameObjects.Graphics;
  private hovered: string | null = null;
  private active: string | null = null;
  private moteZone = new Phaser.Geom.Rectangle();
  private portraits = new Map<string, string>();
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

  /** Rotate a position n quarter turns inside a w×h grid. */
  private turn(p: Pos, w: number, h: number, n: number): Pos {
    let { x, y } = p;
    for (let i = 0; i < n; i++) [x, y, w, h] = [h - 1 - y, x, h, w];
    return { x, y };
  }

  private view(p: Pos): Pos { return this.turn(p, this.mapData.width, this.mapData.height, this.rot); }

  /** Grid cell shown at a view position, or null outside the map. */
  private fromView(v: Pos): Pos | null {
    const { w, h } = this.viewDims();
    if (v.x < 0 || v.y < 0 || v.x >= w || v.y >= h) return null;
    return this.turn(v, w, h, (4 - this.rot) % 4);
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

  /** Rotate the camera by 90° steps; redraws map, units and current highlights behind a short fade. */
  rotate(steps: 1 | -1) {
    const swap = () => {
      this.rot = (this.rot + steps + 4) % 4;
      const lit = this.lit;
      this.setMap(this.mapData);
      for (const u of this.units.values()) this.syncUnit(u);
      for (const l of lit) this.highlight(l.cells, l.color, l.alpha);
    };
    const cam = this.cameras.main;
    if (reducedMotion()) return swap();
    cam.fadeOut(90, 21, 17, 14);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => { swap(); cam.fadeIn(140, 21, 17, 14); });
  }

  preload() {
    for (const dir of ALL_SPRITE_DIRS) for (const d of DIR_LIST) this.load.image(spriteKey(dir, d), `${dir}/${d}.png`);
  }

  create() {
    makeTextures(this);
    for (const dir of ALL_SPRITE_DIRS) for (const d of DIR_LIST) this.textures.get(spriteKey(dir, d)).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.cursor = this.add.graphics().setVisible(false);
    this.path = this.add.graphics().setDepth(9000);
    this.setMap(this.mapData);
    for (const u of this.initialUnits) this.addUnit(u);
    this.scale.on('resize', () => this.fitCamera());
    this.setupPanZoom();
    this.animateWorld();
    this.onReady(this);
  }

  /** Water ripples, a pulse on the action highlights and on the active unit's light. */
  private animateWorld() {
    if (reducedMotion()) return;
    let frame = 0;
    this.time.addEvent({ delay: 420, loop: true, callback: () => {
      frame = (frame + 1) % WATER_FRAMES;
      for (const w of this.water) w.setTexture(`blk-water-${frame}`);
    } });
    this.tweens.addCounter({ from: 0, to: 1, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', onUpdate: tw => {
      const t = tw.getValue() ?? 0;
      for (const o of this.overlays.values()) o.setAlpha(0.7 + 0.3 * t);
      const s = this.active && this.sprites.get(this.active);
      if (s) s.glow.setAlpha(0.45 + 0.25 * t);
    } });
  }

  /**
   * Light and lens effects: warmer colour, a light tilt-shift, vignette, drifting dust. WebGL only, off with light graphics.
   * No Phaser bloom: on a transparent canvas it darkens and smears the pixels; the glows are additive sprites instead.
   */
  enableFx() {
    if (!settings().fx || this.game.renderer.type !== Phaser.WEBGL) return;
    const fx = this.cameras.main.postFX;
    const grade = fx.addColorMatrix();
    grade.brightness(1.06, true);
    grade.saturate(0.08, true);
    fx.addTiltShift(0.5, 0.15, 0, 1, 1, 0.25);
    fx.addVignette(0.5, 0.5, 0.95, 0.15);
    this.game.canvas.parentElement?.classList.add('fx');
    if (reducedMotion()) return;
    this.add.particles(0, 0, 'mote', {
      emitZone: { type: 'random', source: this.moteZone } as Phaser.Types.GameObjects.Particles.EmitZoneData,
      lifespan: 7000, frequency: 260, speedX: { min: -3, max: 7 }, speedY: { min: -8, max: -2 },
      alpha: { start: 0.55, end: 0 }, scale: { min: 0.8, max: 1.6 }, tint: 0xffd9a0, blendMode: 'ADD',
    }).setDepth(9500);
  }

  private setupPanZoom() {
    this.input.addPointer(1); // second finger, for pinch
    const cam = this.cameras.main;
    // pointers pressed on the canvas; Phaser's own isDown can stay stuck after touches on the HTML UI
    const down = new Map<number, { x: number; y: number }>();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // Phaser also reports touches that start on the HTML UI; their end can be lost when the button re-renders,
      // leaving a phantom finger that turns the next tap into a pinch
      if (p.downElement !== this.game.canvas) return;
      if (!down.size) this.dragged = false;
      down.set(p.id, { x: p.x, y: p.y });
      this.pinch = 0;
    });
    const release = (p: Phaser.Input.Pointer) => { down.delete(p.id); this.pinch = 0; };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
    this.input.on('gameout', () => this.hover(null));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!down.has(p.id)) {
        if (!p.wasTouch) this.hover(this.cellAtWorld(p.worldX, p.worldY));
        return;
      }
      down.set(p.id, { x: p.x, y: p.y });
      if (!this.pannable || this.panLock) return;
      if (down.size >= 2) {
        const [a, b] = [...down.values()];
        const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        if (this.pinch) this.zoomBy(d / this.pinch);
        this.pinch = d;
        this.dragged = true;
        return;
      }
      if (!this.dragged && Phaser.Math.Distance.Between(p.x, p.y, p.downX, p.downY) < 10) return;
      this.dragged = true;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      this.clampCamera();
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => { if (this.pannable) this.zoomBy(dy < 0 ? 1.15 : 1 / 1.15); });
  }

  /** Mouse only: a bobbing diamond on the cell under the pointer, and a 'hover' event for previews. */
  private hover(p: Pos | null) {
    const k = p ? key(p) : null;
    if (k === this.hovered) return;
    this.hovered = k;
    this.events.emit('hover', p);
    this.tweens.killTweensOf(this.cursor);
    if (!p) return void this.cursor.setVisible(false);
    const c = this.at(p);
    const pts = [{ x: 0, y: -TH / 2 }, { x: TW / 2, y: 0 }, { x: 0, y: TH / 2 }, { x: -TW / 2, y: 0 }];
    this.cursor.clear().lineStyle(2, COLOR.brass, 1).strokePoints(pts, true)
      .setPosition(c.x, c.y).setDepth(this.depthOf(p) + 1.5).setVisible(true);
    if (!reducedMotion()) this.tweens.add({ targets: this.cursor, y: c.y - 2, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
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
    this.water.clear();
    this.lit = [];
    this.mapData = m;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) this.drawCell({ x, y });
    this.paint(this.goalCells, COLOR.brass, 0.5);
    this.fitCamera();
  }

  /** Redraw one cell after its height or terrain changed, plus the cells it shades. Camera stays put. */
  redrawCell(m: MapData, p: Pos) {
    this.mapData = m;
    const v = this.view(p);
    for (const q of [p, this.fromView({ x: v.x + 1, y: v.y }), this.fromView({ x: v.x + 2, y: v.y })]) {
      if (!q) continue;
      for (const o of this.cellObjects.get(key(q)) ?? []) { this.water.delete(o as Phaser.GameObjects.Image); o.destroy(); }
      this.drawCell(q);
    }
  }

  /** Height of the cell n steps toward the sun (view −x), or -1 off the map. */
  private sunward(p: Pos, n: number) {
    const v = this.view(p), q = this.fromView({ x: v.x - n, y: v.y });
    return q ? heightAt(this.mapData, q) : -1;
  }

  private drawCell(p: Pos) {
    const m = this.mapData;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const h = heightAt(m, p), t = terrainAt(m, p);
    const c = this.at(p, h), down = h * HS + BASE, depth = this.depthOf(p);
    const top = { x: c.x, y: c.y - TH / 2 }, right = { x: c.x + TW / 2, y: c.y }, bottom = { x: c.x, y: c.y + TH / 2 }, left = { x: c.x - TW / 2, y: c.y };
    // a taller column toward the sun casts a cool shadow on this one
    const shade = this.sunward(p, 1) > h ? 0xa9adc4 : this.sunward(p, 2) > h + 1 ? 0xcfd1de : 0xffffff;
    // stack one block per height step: dirt below, terrain block on top
    for (let l = 0; l <= h; l++) {
      const tex = l < h ? 'blk-dirt' : t === 'water' ? 'blk-water-0' : t === 'blocked' ? 'blk-grass' : `blk-${t}`;
      const at = this.at(p, l);
      const img = this.add.image(at.x, at.y, tex).setDepth(depth + l * 0.05).setOrigin(0.5, BLOCK.top / 2 / (BLOCK.top + BLOCK.side)).setScale(BLOCK.scale);
      if (l === h) img.setTint(shade);
      if (l === h && t === 'water') this.water.add(img);
      objs.push(img);
    }
    if (t === 'blocked') objs.push(this.add.image(c.x, c.y + 4, 'tree').setOrigin(0.5, 1).setScale(BLOCK.scale).setDepth(depth + 4).setTint(shade));
    const g = this.add.graphics().setDepth(depth + 0.9);
    // hit area covers the whole visible column, so tapping a cliff face picks the cell in front
    const hit = new Phaser.Geom.Polygon([top, right, { x: right.x, y: right.y + down }, { x: bottom.x, y: bottom.y + down }, { x: left.x, y: left.y + down }, left]);
    g.setInteractive(hit, Phaser.Geom.Polygon.Contains);
    this.hits.set(key(p), { p, poly: hit, depth });
    // on release, so a drag that pans the camera is not also a tap
    g.on('pointerup', () => { if (!this.dragged) this.events.emit('cell', p); });
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
    this.moteZone.setTo(minX, minY, maxX - minX, maxY - minY);
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

  /** Slow sideways drift, for the title screen. */
  drift() {
    if (reducedMotion()) return;
    const cam = this.cameras.main;
    this.tweens.add({ targets: cam, scrollX: cam.scrollX + 40, duration: 9000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private cellAtWorld(x: number, y: number): Pos | null {
    let best: { p: Pos; depth: number } | null = null;
    for (const h of this.hits.values()) if ((!best || h.depth > best.depth) && h.poly.contains(x, y)) best = h;
    return best?.p ?? null;
  }

  /** Cell under a page (client) coordinate; front-most column wins. */
  cellAt(clientX: number, clientY: number): Pos | null {
    const rect = this.game.canvas.getBoundingClientRect();
    const w = this.cameras.main.getWorldPoint(clientX - rect.left, clientY - rect.top);
    return this.cellAtWorld(w.x, w.y);
  }

  removeUnit(id: string) {
    this.sprites.get(id)?.c.destroy();
    this.sprites.delete(id);
    this.units.delete(id);
  }

  addUnit(u: Unit) {
    const c = this.add.container();
    const team = TEAM_COLOR[u.team];
    // soft shadow, slightly away from the sun, and a thin team ring on the ground
    const shadow = this.add.image(-2, 1, 'glow').setTint(0x0a0e1e).setAlpha(0.55).setDisplaySize(38, 15);
    const glow = this.add.image(0, -10, 'glow').setTint(COLOR.ember).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(120, 110).setAlpha(0.55).setVisible(false);
    const base = this.add.graphics().lineStyle(1.5, team, 0.9).strokeEllipse(0, 0, 32, 13);
    const ring = this.add.graphics();
    const arrow = this.add.graphics();
    const hp = this.add.graphics();
    const statuses = this.add.graphics();
    const body = this.add.container();
    const dir = spriteDir(u.raceId, u.classId);
    let img: Phaser.GameObjects.Image | undefined;
    if (dir) {
      img = this.add.image(0, 0, spriteKey(dir, u.facing)).setOrigin(0.5, SPRITE_FEET_Y).setScale(SPRITE_SCALE);
      // both teams share the art: a 1px outline in the team colour tells them apart without dirtying the pixels
      if (img.preFX) img.preFX.addGlow(team, 4, 0, false, 0.2, 1);
      else if (u.team === 'B') img.setTint(0xffbfa8);
      body.add(img);
    } else {
      const g = this.add.graphics();
      g.fillStyle(team).lineStyle(2, COLOR.night).fillRoundedRect(-10, -34, 20, 28, 5).strokeRoundedRect(-10, -34, 20, 28, 5);
      g.fillStyle(0xf1c9a0).fillCircle(0, -42, 8).strokeCircle(0, -42, 8);
      const letter = this.add.text(0, -20, CLASSES[u.classId].name[0], { fontFamily: '"Jersey 15"', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
      body.add([g, letter]);
    }
    c.add([glow, shadow, base, ring, arrow, body, hp, statuses]);
    // idle: a whole-pixel bob, out of step between units (fractional scaling would make the pixels shimmer)
    if (!reducedMotion()) this.tweens.add({ targets: body, y: -1.25, duration: 800, yoyo: true, repeat: -1, ease: 'Stepped', delay: Math.random() * 800 });
    this.sprites.set(u.id, { c, arrow, hp, ring, glow, img, body, dir, statuses });
    this.syncUnit(u);
  }

  syncUnit(u: Unit) {
    const s = this.sprites.get(u.id)!;
    this.units.set(u.id, u);
    const p = this.at(u.pos);
    s.c.setPosition(p.x, p.y + (u.hp <= 0 && s.c.alpha < 1 ? 8 : 0)).setDepth(this.depthOf(u.pos) + 5);
    this.face(s, u.facing);
    const pct = u.hp / u.stats.maxHp;
    s.hp.clear().fillStyle(0x0b0806, 0.85).fillRect(-17, -67, 34, 6).fillStyle(pct > 0.35 ? COLOR.hp : COLOR.hpLow).fillRect(-16, -66, 32 * pct, 4)
      .fillStyle(TEAM_COLOR[u.team]).fillRect(-17, -68, 34, 1);
    s.statuses.clear();
    (u.statuses ?? []).forEach((st, i) => s.statuses.fillStyle(0x0b0806).fillRect(-17 + i * 7, -76, 6, 6).fillStyle(STATUS_COLOR[st.id]).fillRect(-16 + i * 7, -75, 4, 4));
    if (u.hp <= 0 && s.c.alpha === 1) this.tweens.add({ targets: s.c, alpha: 0, y: p.y + 8, duration: 500 });
  }

  private face(s: UnitSprite, gridFacing: Dir) {
    const f = this.viewDir(gridFacing);
    if (s.dir) s.img?.setTexture(spriteKey(s.dir, f));
    const d = DIRS[f];
    const v = { x: ((d.x - d.y) * TW) / 2, y: ((d.x + d.y) * TH) / 2 };
    const len = Math.hypot(v.x, v.y), n = { x: v.x / len, y: v.y / len }, perp = { x: -n.y * 5, y: n.x * 5 };
    const tri = [n.x * 26, n.y * 26, n.x * 16 + perp.x, n.y * 16 + perp.y, n.x * 16 - perp.x, n.y * 16 - perp.y] as const;
    s.arrow.clear().fillStyle(0xfff1d6).lineStyle(1.5, COLOR.night).fillTriangle(...tri).strokeTriangle(...tri);
  }

  /** Show a facing without changing the unit: preview before the turn ends. */
  showFacing(unitId: string, d: Dir) {
    const s = this.sprites.get(unitId);
    if (s) this.face(s, d);
  }

  setActive(unitId: string | null) {
    this.active = unitId;
    for (const [id, s] of this.sprites) {
      s.ring.clear();
      s.glow.setVisible(id === unitId);
      if (id === unitId) s.ring.lineStyle(2.5, COLOR.brass).strokeEllipse(0, 0, 40, 17);
    }
  }

  highlight(cells: Pos[], color: number, alpha = 0.45) {
    this.lit.push({ cells, color, alpha });
    this.paint(cells, color, alpha);
  }

  private paint(cells: Pos[], color: number, alpha: number) {
    for (const p of cells) {
      const c = this.at(p);
      const pts = [{ x: c.x, y: c.y - TH / 2 + 3 }, { x: c.x + TW / 2 - 5, y: c.y }, { x: c.x, y: c.y + TH / 2 - 3 }, { x: c.x - TW / 2 + 5, y: c.y }];
      this.overlays.get(key(p))!.fillStyle(color, alpha * 0.55).fillPoints(pts, true).lineStyle(2, color, Math.min(1, alpha * 2.2)).strokePoints(pts, true);
    }
  }

  clearHighlights() {
    for (const g of this.overlays.values()) g.clear();
    this.lit = [];
    this.paint(this.goalCells, COLOR.brass, 0.5);
  }

  /** Battle goal "reach these cells": they stay lit in brass for the whole battle. */
  markGoal(cells: Pos[]) {
    this.goalCells = cells;
    this.clearHighlights();
  }

  /** A brass crown over a unit's HP bar: the enemy to bring down. */
  markBoss(unitId: string) {
    const s = this.sprites.get(unitId);
    if (!s) return;
    const crown = [-8, -72, -8, -80, -4, -76, 0, -82, 4, -76, 8, -80, 8, -72];
    const pts = [];
    for (let i = 0; i < crown.length; i += 2) pts.push({ x: crown[i], y: crown[i + 1] });
    s.c.add(this.add.graphics().fillStyle(COLOR.brass).lineStyle(1.5, COLOR.night).fillPoints(pts, true).strokePoints(pts, true));
  }

  /** Planned route: a line through the cell centres with an arrowhead on the last one. */
  showPath(path: Pos[]) {
    this.path.clear();
    if (path.length < 2) return;
    const pts = path.map(p => this.at(p));
    this.path.lineStyle(4, COLOR.night, 0.6).strokePoints(pts.map(p => ({ x: p.x, y: p.y + 1 })));
    this.path.lineStyle(2.5, 0xfff1d6, 0.95).strokePoints(pts);
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const tip = (r: number, da: number) => ({ x: b.x - Math.cos(ang + da) * r, y: b.y - Math.sin(ang + da) * r });
    this.path.fillStyle(0xfff1d6).fillTriangle(b.x, b.y, tip(10, 0.5).x, tip(10, 0.5).y, tip(10, -0.5).x, tip(10, -0.5).y);
  }

  clearPath() { this.path.clear(); }

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
      play('step');
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

  /** Attacker leans into the target; resolves at the moment of impact. */
  lunge(attackerId: string, target: Pos): Promise<void> {
    const s = this.sprites.get(attackerId);
    if (!s || reducedMotion()) return Promise.resolve();
    const from = { x: s.c.x, y: s.c.y }, to = this.at(target);
    const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return new Promise(done => this.tweens.add({
      targets: s.c, x: from.x + ((to.x - from.x) / d) * 10, y: from.y + ((to.y - from.y) / d) * 10,
      duration: 110, yoyo: true, ease: 'Quad.easeOut', onYoyo: () => done(),
    }));
  }

  /** The hit lands: white flash, a short freeze, shake, sound and the damage number with the side it hit. */
  impact(unit: Unit, amount: number, side: Side) {
    const s = this.sprites.get(unit.id);
    s?.img?.setTintFill(0xffffff);
    this.tweens.timeScale = 0; // hit-stop
    this.time.delayedCall(70, () => { this.tweens.timeScale = 1; s?.img?.clearTint(); });
    if (!reducedMotion()) this.cameras.main.shake(side === 'back' ? 180 : 120, side === 'back' ? 0.006 : 0.003);
    play(side === 'front' ? 'hit' : 'heavy');
    buzz(30);
    this.popText(unit, String(amount), '#ffffff', SIDE_LABEL[side]);
  }

  healFx(unit: Unit, amount: number) {
    play('heal');
    this.popText(unit, `+${amount}`, '#8fe08a');
    const p = this.at(unit.pos);
    const e = this.add.particles(p.x, p.y - 20, 'mote', {
      x: { min: -16, max: 16 }, y: { min: -10, max: 20 }, speedY: { min: -60, max: -30 }, lifespan: 800,
      alpha: { start: 1, end: 0 }, scale: { start: 1.6, end: 0.6 }, tint: COLOR.mend, blendMode: 'ADD', emitting: false,
    }).setDepth(9600);
    e.explode(16);
    this.time.delayedCall(1000, () => e.destroy());
  }

  koFx(unit: Unit) {
    play('ko');
    buzz(60);
    const p = this.at(unit.pos);
    const e = this.add.particles(p.x, p.y - 24, 'mote', {
      speed: { min: 20, max: 60 }, angle: { min: 200, max: 340 }, lifespan: 900, alpha: { start: 0.9, end: 0 },
      scale: { start: 2, end: 0.5 }, tint: 0xfff1d6, blendMode: 'ADD', emitting: false,
    }).setDepth(9600);
    e.explode(20);
    this.time.delayedCall(1100, () => e.destroy());
  }

  /** Land a freshly deployed unit with a small bounce. */
  dropIn(unitId: string) {
    const s = this.sprites.get(unitId);
    play('drop');
    if (!s || reducedMotion()) return;
    const y = s.c.y;
    s.c.y -= 26;
    this.tweens.add({ targets: s.c, y, duration: 320, ease: 'Bounce.easeOut' });
  }

  /** A number or a word rising over a unit: damage, status, "Schivata". */
  popText(unit: Unit, text: string, color: string, label = '') {
    const p = this.at(unit.pos);
    const box = this.add.container(p.x, p.y - 70).setDepth(10_000).setScale(0.4);
    const num = this.add.text(0, 0, text, { fontFamily: '"Jersey 15"', fontSize: '40px', color, stroke: '#0b0806', strokeThickness: 6 }).setOrigin(0.5, 1);
    box.add(num);
    if (label) box.add(this.add.text(0, 2, label, { fontFamily: '"Alegreya Sans"', fontStyle: '800 italic', fontSize: '15px', color: '#e0ac4a', stroke: '#0b0806', strokeThickness: 4 }).setOrigin(0.5, 0));
    this.tweens.chain({ targets: box, tweens: [
      { scale: 1, y: box.y - 16, duration: 240, ease: 'Back.easeOut' },
      { y: box.y - 30, alpha: 0, duration: 600, delay: 450, ease: 'Cubic.easeIn' },
    ], onComplete: () => box.destroy() });
  }

  /** A head-and-shoulders crop of the unit's front sprite, as a data URL for the HTML UI. */
  portrait(u: { raceId?: string; classId: string }): string {
    const dir = spriteDir(raceOf(u), u.classId);
    if (!dir) return '';
    const cached = this.portraits.get(dir);
    if (cached) return cached;
    const src = this.textures.get(spriteKey(dir, 'S')).getSourceImage() as CanvasImageSource;
    const c = Object.assign(document.createElement('canvas'), { width: 26, height: 26 });
    c.getContext('2d')!.drawImage(src, 11, 0, 26, 26, 0, 0, 26, 26);
    const url = c.toDataURL();
    this.portraits.set(dir, url);
    return url;
  }
}
