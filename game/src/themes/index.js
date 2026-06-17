// Theme registry. Each round's world JSON carries a `theme` name; main.js looks
// it up here and applies the palette/sky/lighting. New rounds register a theme
// object (see medieval.js for the shape). Falls back to medieval if unknown.

import { medieval } from './medieval.js';

const THEMES = {
  medieval,
  // city, paris, harbor, asteroid — added in Phases B-E
};

export function getTheme(name) {
  return THEMES[name] || medieval;
}
