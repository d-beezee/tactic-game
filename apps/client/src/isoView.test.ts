import { blankMap } from '@tactics/core';
import { describe, expect, it } from 'vitest';
import { IsoView } from './isoView';

describe('IsoView', () => {
  it('every rotation maps each cell back to itself and turns facings the same way', () => {
    const v = new IsoView(blankMap('t', 5, 3));
    for (let rot = 0; rot < 4; rot++) {
      v.rot = rot;
      const { w, h } = v.dims();
      expect([w, h]).toEqual(rot % 2 ? [3, 5] : [5, 3]);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) expect(v.fromView(v.view({ x, y }))).toEqual({ x, y });
      expect(v.fromView({ x: w, y: 0 })).toBeNull();
      for (const d of ['N', 'E', 'S', 'W'] as const) expect(v.gridDir(v.viewDir(d))).toBe(d);
    }
    v.rot = 1;
    expect(v.viewDir('N')).toBe('E');
  });
});
