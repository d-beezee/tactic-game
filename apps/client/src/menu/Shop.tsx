import { ITEMS, SLOT_LABELS, itemBonus, unitFromRoster, type ItemDef, type RosterUnit, type Stats } from '@tactics/core';
import { Fragment, useState } from 'react';
import type { Account } from '../api';
import { Page, type PageProps } from './Page';

const STAT_SHORT: Record<keyof Stats, string> = { maxHp: 'PV', atk: 'ATT', def: 'DIF', mag: 'MAG', speed: 'VEL', move: 'MOV', jump: 'SALTO' };

export function Shop({ player, selected, buy, ...page }: PageProps & {
  player: Account;
  /** the unit open in the barracks: items are compared against it */
  selected: string;
  /** resolves to false when the purchase failed */
  buy: (itemId: string) => Promise<boolean>;
}) {
  /** item waiting for a second tap to confirm, and the last purchase */
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  const unit = player.roster.find(u => u.id === selected) ?? player.roster[0];

  return (
    <Page title={`Negozio · ${player.gold} oro`} {...page}>
      <p className="notice" role="status" hidden={!notice}>{notice}</p>
      <div className="class-grid shop">
        {Object.values(ITEMS).map(i => {
          const missing = i.price - player.gold;
          const confirm = pending === i.id && missing <= 0;
          // two taps: the first asks, the second buys (a purchase cannot be undone)
          const onClick = () => {
            setNotice('');
            if (!confirm) return setPending(i.id);
            setPending('');
            void buy(i.id).then(ok => setNotice(ok ? `Comprato: ${i.name}. Equipaggialo in caserma.` : ''));
          };
          return (
            <button key={i.id} className={`class-card${confirm ? ' confirm' : ''}`} disabled={missing > 0} onClick={onClick}>
              <span className="cn">{i.name}</span>
              <span className="cl">{SLOT_LABELS[i.slot]}, {itemBonus(i)}</span>
              <Compare item={i} unit={unit} />
              <span className="cl">Possedute: {player.inventory[i.id] ?? 0}</span>
              <span className="price">{missing > 0 ? `${i.price} oro · mancano ${missing}` : confirm ? `Tocca di nuovo per comprare · ${i.price} oro` : `Compra · ${i.price} oro`}</span>
            </button>
          );
        })}
      </div>
    </Page>
  );
}

/** What the item would change on the unit, against what it wears now. */
function Compare({ item, unit }: { item: ItemDef; unit: RosterUnit }) {
  if (unit.equip?.[item.slot] === item.id) return <span className="delta">Già addosso a {unit.name}</span>;
  const now = unitFromRoster(unit, 'A', { x: 0, y: 0 }, 'S').stats;
  const next = unitFromRoster({ ...unit, equip: { ...unit.equip, [item.slot]: item.id } }, 'A', { x: 0, y: 0 }, 'S').stats;
  const diffs = (Object.keys(STAT_SHORT) as (keyof Stats)[]).filter(k => next[k] !== now[k]);
  return (
    <span className="delta">
      {unit.name}: {diffs.map((k, n) => (
        <Fragment key={k}>{n ? ', ' : ''}{STAT_SHORT[k]} {now[k]} {next[k] > now[k] ? <b>{next[k]}</b> : <em>{next[k]}</em>}</Fragment>
      ))}
    </span>
  );
}
