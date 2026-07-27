// Theme registry. Each round's world JSON carries a `theme` name; main.js looks
// it up here and applies the palette/sky/lighting. New rounds register a theme
// object (see peach.js for the shape). Falls back to peach if unknown.

import { peach } from './peach.js';
import { city } from './city.js';
import { fossilfalls } from './fossilfalls.js';
import { ruined } from './ruined.js';
import { tostarena } from './tostarena.js';

const THEMES = {
  peach,         // Round 1: Peach's Castle throne room (VI vs PI gridworld)
  city,
  fossilfalls,
  ruined,        // Round 4: continuous DQN arena
  tostarena,     // Round 5: continuous Policy Gradient arena (Actor-Critic vs PPO)
};

export function getTheme(name) {
  return THEMES[name] || peach;
}
