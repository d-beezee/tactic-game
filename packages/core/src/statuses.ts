export type StatusId = 'poison' | 'regen' | 'stun' | 'root' | 'atk-up' | 'def-up' | 'atk-down' | 'def-down';

export interface StatusDef {
  name: string;
  /** % of max HP at the start of each of the unit's turns: positive heals, negative hurts */
  tickPct?: number;
  skipTurn?: boolean;
  noMove?: boolean;
  stat?: { key: 'atk' | 'def'; pct: number };
  /** good for the unit: lasts longer with the Rifrazione passive */
  buff?: boolean;
}

export const STATUSES: Record<StatusId, StatusDef> = {
  poison: { name: 'Veleno', tickPct: -8 },
  regen: { name: 'Rigenerazione', tickPct: 8, buff: true },
  stun: { name: 'Stordito', skipTurn: true },
  root: { name: 'Radicato', noMove: true },
  'atk-up': { name: 'Forza', stat: { key: 'atk', pct: 20 }, buff: true },
  'def-up': { name: 'Scudo', stat: { key: 'def', pct: 30 }, buff: true },
  'atk-down': { name: 'Indebolito', stat: { key: 'atk', pct: -20 } },
  'def-down': { name: 'Spezzato', stat: { key: 'def', pct: -30 } },
};

/** A status on a unit; `turns` drops by 1 at the end of each of its turns. */
export interface StatusInst { id: StatusId; turns: number }
