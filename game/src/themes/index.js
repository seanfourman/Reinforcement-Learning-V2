// Theme registry. Each round's world JSON carries a `theme` name; main.js looks
// it up here and applies the palette/sky/lighting. New rounds register a theme
// object (see medieval.js for the shape). Falls back to medieval if unknown.

import { medieval } from './medieval.js';
import { city } from './city.js';

const THEMES = {
  medieval,
  city,
  // paris, harbor, asteroid — added in Phases C-E
};

export function getTheme(name) {
  return THEMES[name] || medieval;
}
