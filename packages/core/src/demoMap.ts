import type { MapData } from './map';
import demo from './maps/demo.json';

/** The map shipped with the game: read-only, used by test battles and PvP. */
export const DEMO_MAP = demo as MapData;
