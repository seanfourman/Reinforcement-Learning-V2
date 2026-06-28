// Theme registry. Each round's world JSON carries a `theme` name; main.js looks
// it up here and applies the palette/sky/lighting. New rounds register a theme
// object (see medieval.js for the shape). Falls back to medieval if unknown.

import { medieval } from './medieval.js';
import { peach } from './peach.js';
import { city } from './city.js';
import { fossilfalls } from './fossilfalls.js';
import { ruined } from './ruined.js';

const THEMES = {
  medieval,
  peach,         // Round 1: Peach's Castle throne room (VI vs PI gridworld)
  city,
  fossilfalls,
  ruined,        // Round 4: continuous DQN arena
};

export function getTheme(name) {
  return THEMES[name] || medieval;
}
