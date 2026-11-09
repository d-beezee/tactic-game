import { CLASSES, type Stats } from './classes';
import type { Dir, Pos, Team } from './map';

export interface Unit {
  id: string;
  name: string;
  team: Team;
  classId: string;
  stats: Stats;
  hp: number;
  pos: Pos;
  facing: Dir;
}

export function createUnit(id: string, name: string, team: Team, classId: string, pos: Pos, facing: Dir): Unit {
  const cls = CLASSES[classId];
  if (!cls) throw new Error(`unknown class ${classId}`);
  return { id, name, team, classId, stats: { ...cls.stats }, hp: cls.stats.maxHp, pos: { ...pos }, facing };
}
