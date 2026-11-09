import Phaser from 'phaser';
import { CLASSES, DIRS, heightAt, key, terrainAt, type Dir, type MapData, type Pos, type Terrain, type Unit } from '@tactics/core';

const TW = 64, TH = 32, HS = 16, BASE = 16;
const UNIT_TOP = 64; // sprite height above the tile, for camera bounds

export const TEAM_COLOR = { A: 0x4f8cff, B: 0xe8673c } as const;

// Kenney "Isometric Landscape" (CC0): top face is 132×66 centred at (66,33), one block side is 33px = one height step once scaled to TW.
const TILE_SRC_W = 132, TILE_TOP_CY = 33;
const TILE_FOR: Record<Terrain, string> = { grass: 'grass', dirt: 'dirt', stone: 'stone', water: 'water', blocked: 'grass' };
const FILLER = 'dirt';

/** Screen position of the centre of a cell's top face. */
export const iso = (x: number, y: number, h: number) => ({ x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - h * HS });
const depthOf = (p: Pos) => (p.x + p.y) * 10;

interface UnitSprite { c: Phaser.GameObjects.Container; arrow: Phaser.GameObjects.Graphics; hp: Phaser.GameObjects.Graphics; ring: Phaser.GameObjects.Graphics; img?: Phaser.GameObjects.Image; classId: string }

// 48×48 pixel-art idle frames, one per grid facing (grid N/E/S/W = screen NE/SE/SW/NW). Classes without art use the placeholder body.
const SPRITE_CLASSES = ['warrior', 'archer', 'cleric'];
const SPRITE_SCALE = 1.25, SPRITE_FEET_Y = 46 / 48;
const spriteKey = (classId: string, d: Dir) => `${classId}-${d}`;

/** Screen space kept free for HTML UI around the map. */
export interface Insets { top: number; right: number; bottom: number; left: number }
const battleInsets = (w: number): Insets => ({ top: 70, right: 0, bottom: w < 640 ? 190 : 110, left: 0 });

export class BattleScene extends Phaser.Scene {
  private overlays = new Map<string, Phaser.GameObjects.Graphics>();
  private sprites = new Map<string, UnitSprite>();
  private hits = new Map<string, { p: Pos; poly: Phaser.Geom.Polygon; depth: number }>();
  private cellObjects = new Map<string, Phaser.GameObjects.GameObject[]>();

  constructor(
    private mapData: MapData,
    private initialUnits: Unit[],
    private onReady: (scene: BattleScene) => void,
    private insets: (width: number, height: number) => Insets = battleInsets,
  ) {
    super('battle');
  }

  preload() {
    for (const t of ['grass', 'dirt', 'stone', 'water']) this.load.image(t, `tiles/${t}.png`);
    for (const c of SPRITE_CLASSES) for (const d of Object.keys(DIRS) as Dir[]) this.load.image(spriteKey(c, d), `units/${c}/${d}.png`);
  }

  create() {
    for (const c of SPRITE_CLASSES) for (const d of Object.keys(DIRS) as Dir[]) this.textures.get(spriteKey(c, d)).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.setMap(this.mapData);
    for (const u of this.initialUnits) this.addUnit(u);
    this.scale.on('resize', () => this.fitCamera());
    this.onReady(this);
  }

  /** Redraw the whole map (new map or new size) and refit the camera. */
  setMap(m: MapData) {
    for (const objs of this.cellObjects.values()) for (const o of objs) o.destroy();
    this.cellObjects.clear();
    this.hits.clear();
    this.overlays.clear();
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
    const c = iso(p.x, p.y, h), down = h * HS + BASE;
    const top = { x: c.x, y: c.y - TH / 2 }, right = { x: c.x + TW / 2, y: c.y }, bottom = { x: c.x, y: c.y + TH / 2 }, left = { x: c.x - TW / 2, y: c.y };
    // stack one block per height step: filler blocks below, terrain block on top
    for (let l = 0; l <= h; l++) {
      const tex = l === h ? TILE_FOR[t] : FILLER;
      const at = iso(p.x, p.y, l);
      const img = this.add.image(at.x, at.y, tex).setDepth(depthOf(p) + l * 0.05);
      img.setOrigin(0.5, TILE_TOP_CY / img.height).setScale(TW / TILE_SRC_W);
      objs.push(img);
    }
    const g = this.add.graphics().setDepth(depthOf(p) + 0.9);
    g.lineStyle(1, 0x000000, 0.18).strokePoints([top, right, bottom, left], true);
    if (t === 'blocked') {
      // a pine tree: impassable marker
      g.fillStyle(0x5a3d22).fillRect(c.x - 3, c.y - 10, 6, 10);
      g.fillStyle(0x2e5e2a).fillTriangle(c.x - 16, c.y - 8, c.x + 16, c.y - 8, c.x, c.y - 46);
    }
    // hit area covers the whole visible column, so tapping a cliff face picks the cell in front
    const hit = new Phaser.Geom.Polygon([top, right, { x: right.x, y: right.y + down }, { x: bottom.x, y: bottom.y + down }, { x: left.x, y: left.y + down }, left]);
    g.setInteractive(hit, Phaser.Geom.Polygon.Contains);
    this.hits.set(key(p), { p, poly: hit, depth: depthOf(p) });
    g.on('pointerdown', () => this.events.emit('cell', p));
    const overlay = this.add.graphics().setDepth(depthOf(p) + 1);
    this.overlays.set(key(p), overlay);
    objs.push(g, overlay);
    this.cellObjects.set(key(p), objs);
  }

  private fitCamera() {
    const m = this.mapData;
    const maxH = Math.max(...m.heights.flat());
    const minX = iso(0, m.height - 1, 0).x - TW / 2, maxX = iso(m.width - 1, 0, 0).x + TW / 2;
    const minY = iso(0, 0, maxH).y - TH / 2 - UNIT_TOP, maxY = iso(m.width - 1, m.height - 1, 0).y + TH / 2 + BASE;
    const { width, height } = this.scale;
    const ins = this.insets(width, height);
    const cam = this.cameras.main;
    cam.setZoom(Math.min((width - ins.left - ins.right) / (maxX - minX), (height - ins.top - ins.bottom) / (maxY - minY)) * 0.95);
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
      figure = [img];
    } else {
      const body = this.add.graphics();
      body.fillStyle(TEAM_COLOR[u.team]).lineStyle(2, 0x1b1712).fillRoundedRect(-10, -34, 20, 28, 5).strokeRoundedRect(-10, -34, 20, 28, 5);
      body.fillStyle(0xf1c9a0).fillCircle(0, -42, 8).strokeCircle(0, -42, 8);
      const letter = this.add.text(0, -20, CLASSES[u.classId].name[0], { fontFamily: 'system-ui', fontSize: '14px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
      figure = [body, letter];
    }
    c.add([base, ring, arrow, ...figure, hp]);
    this.sprites.set(u.id, { c, arrow, hp, ring, img, classId: u.classId });
    this.syncUnit(u);
  }

  syncUnit(u: Unit) {
    const s = this.sprites.get(u.id)!;
    const p = iso(u.pos.x, u.pos.y, heightAt(this.mapData, u.pos));
    s.c.setPosition(p.x, p.y).setDepth(depthOf(u.pos) + 5);
    this.face(s, u.facing);
    s.hp.clear().fillStyle(0x000000, 0.6).fillRect(-16, -64, 32, 5).fillStyle(u.hp / u.stats.maxHp > 0.35 ? 0x6cc04a : 0xf2c14e).fillRect(-16, -64, (32 * u.hp) / u.stats.maxHp, 5);
    if (u.hp <= 0 && s.c.alpha === 1) this.tweens.add({ targets: s.c, alpha: 0, y: p.y + 8, duration: 400 });
  }

  private face(s: UnitSprite, f: Dir) {
    s.img?.setTexture(spriteKey(s.classId, f));
    const d = DIRS[f];
    const v = { x: ((d.x - d.y) * TW) / 2, y: ((d.x + d.y) * TH) / 2 };
    const len = Math.hypot(v.x, v.y), n = { x: v.x / len, y: v.y / len }, perp = { x: -n.y * 6, y: n.x * 6 };
    const tri = [n.x * 26, n.y * 26, n.x * 14 + perp.x, n.y * 14 + perp.y, n.x * 14 - perp.x, n.y * 14 - perp.y] as const;
    s.arrow.clear().fillStyle(0xfff3c4).lineStyle(1.5, 0x1b1712).fillTriangle(...tri).strokeTriangle(...tri);
  }

  setActive(unitId: string | null) {
    for (const [id, s] of this.sprites) {
      s.ring.clear();
      if (id === unitId) s.ring.lineStyle(3, 0xf2c14e).strokeEllipse(0, 0, 40, 18);
    }
  }

  highlight(cells: Pos[], color: number, alpha = 0.45) {
    for (const p of cells) {
      const c = iso(p.x, p.y, heightAt(this.mapData, p));
      const pts = [{ x: c.x, y: c.y - TH / 2 + 2 }, { x: c.x + TW / 2 - 3, y: c.y }, { x: c.x, y: c.y + TH / 2 - 2 }, { x: c.x - TW / 2 + 3, y: c.y }];
      this.overlays.get(key(p))!.fillStyle(color, alpha).fillPoints(pts, true).lineStyle(2, color, Math.min(1, alpha * 2)).strokePoints(pts, true);
    }
  }

  clearHighlights() {
    for (const g of this.overlays.values()) g.clear();
  }

  async animateMove(unitId: string, path: Pos[]) {
    const s = this.sprites.get(unitId)!;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const ha = heightAt(this.mapData, a), hb = heightAt(this.mapData, b);
      const to = iso(b.x, b.y, hb);
      this.face(s, (Object.keys(DIRS) as Dir[]).find(d => DIRS[d].x === b.x - a.x && DIRS[d].y === b.y - a.y)!);
      s.c.setDepth(Math.max(depthOf(a), depthOf(b)) + 5);
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
    const p = iso(unit.pos.x, unit.pos.y, heightAt(this.mapData, unit.pos));
    const t = this.add.text(p.x, p.y - 64, text, { fontFamily: 'system-ui', fontSize: '22px', fontStyle: 'bold', color, stroke: '#1b1712', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(10_000);
    this.tweens.add({ targets: t, y: t.y - 30, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }
}
