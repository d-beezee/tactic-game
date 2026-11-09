import { DEFAULT_ROSTER, parseRoster, type RosterUnit } from '@tactics/core';

const KEY = 'tactics.roster';

// shortcut: roster lives in localStorage until the backend exists; move to the server with accounts.
export function loadRoster(): RosterUnit[] {
  try {
    return parseRoster(JSON.parse(localStorage.getItem(KEY) ?? 'null')) ?? structuredClone(DEFAULT_ROSTER);
  } catch {
    return structuredClone(DEFAULT_ROSTER);
  }
}

export function saveRoster(r: RosterUnit[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* private mode: changes last for this session only */
  }
}
