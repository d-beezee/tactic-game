// Grid ↔ screen geometry of the isometric map, with the camera turned in 90° steps. No Phaser: the scene draws, this only measures.
import { DIRS, heightAt, type Dir, type MapData, type Pos } from '@tactics/core';

/** Terrain block art: width, top face height and side height in texels, and the world scale. */
export const BLOCK = { w: 48, top: 24, side: 12, scale: 1.25 } as const;

// One texel of terrain = one texel of a unit sprite = 1.25 world px.
export const TW = BLOCK.w * BLOCK.scale, TH = BLOCK.top * BLOCK.scale, HS = BLOCK.side * BLOCK.scale;

/** Screen position of the centre of a cell's top face, from VIEW coordinates (after camera rotation). */
export const iso = (x: number, y: number, h: number) => ({ x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 - h * HS });

const DIR_LIST = Object.keys(DIRS) as Dir[];

/** Rotate a position n quarter turns inside a w×h grid. */
function turn(p: Pos, w: number, h: number, n: number): Pos {
  let { x, y } = p;
  for (let i = 0; i < n; i++) [x, y, w, h] = [h - 1 - y, x, h, w];
  return { x, y };
}

function rotateDir(d: Dir, steps: number): Dir {
  let x: number = DIRS[d].x, y: number = DIRS[d].y;
  for (let i = 0; i < ((steps % 4) + 4) % 4; i++) [x, y] = [-y, x];
  return DIR_LIST.find(k => DIRS[k].x === x && DIRS[k].y === y)!;
}

/** The map as the camera sees it. Game logic stays in grid coordinates; only drawing uses view coordinates. */
export class IsoView {
  /** camera rotation in 90° steps, 0–3 */
  rot = 0;

  constructor(public map: MapData) {}

  /** Grid cell to view position. */
  view(p: Pos): Pos { return turn(p, this.map.width, this.map.height, this.rot); }

  /** Grid cell shown at a view position, or null outside the map. */
  fromView(v: Pos): Pos | null {
    const { w, h } = this.dims();
    if (v.x < 0 || v.y < 0 || v.x >= w || v.y >= h) return null;
    return turn(v, w, h, (4 - this.rot) % 4);
  }

  /** Width and height of the map as seen. */
  dims() {
    const { width: w, height: h } = this.map;
    return this.rot % 2 ? { w: h, h: w } : { w, h };
  }

  /** Where a cell is drawn: grid pos + height to world coordinates. */
  at(p: Pos, h = heightAt(this.map, p)) {
    const v = this.view(p);
    return iso(v.x, v.y, h);
  }

  /** Draw order of a cell: further back is lower. */
  depthOf(p: Pos) {
    const v = this.view(p);
    return (v.x + v.y) * 10;
  }

  /** Grid facing as seen on screen. */
  viewDir(d: Dir): Dir { return rotateDir(d, this.rot); }

  /** Screen direction (as the HUD arrows show it) back to a grid facing. */
  gridDir(screen: Dir): Dir { return rotateDir(screen, -this.rot); }
}
