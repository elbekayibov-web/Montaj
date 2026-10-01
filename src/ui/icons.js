// One icon family: 24px grid, 1.8 stroke, rounded joins and a soft duotone
// fill. The same shapes are reused, filled and enlarged, as the glowing
// glyphs on the reading tiles.

export const ICON_PATHS = {
  heater: '<rect x="4" y="5.5" width="4" height="13.5" rx="2"/><rect x="10" y="5.5" width="4" height="13.5" rx="2"/><rect x="16" y="5.5" width="4" height="13.5" rx="2"/><path d="M3 20.5h18" class="line"/>',
  propane: '<rect x="6.5" y="7.5" width="11" height="13.5" rx="4.5"/><path d="M9.5 7.5V4.5h5v3" class="line"/><path d="M6.5 13h11" class="line"/>',
  methane: '<path d="M12 3.2c3.1 3.2 5.6 5.9 5.6 9.7a5.6 5.6 0 0 1-11.2 0c0-2.4 1.2-4.1 2.6-5.4.2 1.9 1.1 3 2.4 3.3-.4-2.7-.1-5.1.6-7.6z"/>',
  window: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M12 3.5v17M4.5 12h15" class="line"/>',
  temperature: '<path d="M9.5 14.2V5.5a2.5 2.5 0 0 1 5 0v8.7a4.5 4.5 0 1 1-5 0z"/><path d="M12 9.5v7" class="line"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
};

export function icon(name, cls = 'ic') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

// Filled glyph with a vertical gradient, used large on the reading tiles.
export function glyph(name, id) {
  const shapes = ICON_PATHS[name].replace(/ class="line"/g, ' class="cut"');
  return `<svg class="t-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient></defs>
    <g fill="url(#g-${id})">${shapes}</g></svg>`;
}
