/** Deterministic placeholder artwork for synthetic products (no external images needed). */

const GLYPHS: Record<string, string> = {
  "mens-clothing": '<path d="M150 110 l50-30 h40 a20 20 0 0 0 40 0 h40 l50 30 -25 55 -30-15 v135 h-170 v-135 l-30 15 z"/>',
  "womens-clothing": '<path d="M200 80 h80 l-10 50 50 170 h-210 l50-170 z"/><circle cx="240" cy="70" r="10"/>',
  footwear: '<path d="M120 250 q0-40 30-50 l60-10 40-60 h40 l10 70 q60 10 70 50 v20 h-250 z"/>',
  electronics: '<rect x="150" y="110" width="180" height="160" rx="24"/><circle cx="240" cy="190" r="45" fill-opacity="0.35"/>',
  "home-kitchen": '<path d="M160 150 h140 v110 a30 30 0 0 1-30 30 h-80 a30 30 0 0 1-30-30 z"/><path d="M300 175 h20 a25 25 0 0 1 0 50 h-20" fill="none" stroke="#fff" stroke-width="14"/>',
  beauty: '<rect x="205" y="90" width="70" height="40" rx="8"/><rect x="180" y="130" width="120" height="170" rx="28"/>',
  "sports-fitness": '<rect x="120" y="175" width="240" height="30" rx="15"/><rect x="140" y="140" width="34" height="100" rx="10"/><rect x="306" y="140" width="34" height="100" rx="10"/>',
  "books-stationery": '<path d="M140 110 h90 q10 0 10 10 v180 q-10-15-30-15 h-70 z"/><path d="M340 110 h-90 q-10 0-10 10 v180 q10-15 30-15 h70 z" fill-opacity="0.75"/>',
  "toys-games": '<rect x="150" y="160" width="80" height="80" rx="10"/><rect x="250" y="160" width="80" height="80" rx="10" fill-opacity="0.75"/><rect x="200" y="90" width="80" height="70" rx="10" fill-opacity="0.9"/>',
  "bags-accessories": '<rect x="150" y="150" width="180" height="140" rx="20"/><path d="M200 150 v-25 a40 40 0 0 1 80 0 v25" fill="none" stroke="#fff" stroke-width="14"/>',
};

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function productSvg(category: string, kind: string, hue: number): string {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  const h2 = (h + 40) % 360;
  const label = escapeXml(kind.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 28));
  const glyph = GLYPHS[category] ?? GLYPHS["toys-games"]!;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" width="480" height="480" role="img" aria-label="${label}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 62%)"/><stop offset="1" stop-color="hsl(${h2} 65% 42%)"/></linearGradient></defs>
<rect width="480" height="480" fill="url(#g)"/>
<circle cx="400" cy="70" r="120" fill="#fff" fill-opacity="0.08"/><circle cx="60" cy="430" r="90" fill="#fff" fill-opacity="0.06"/>
<g fill="#fff" fill-opacity="0.92">${glyph}</g>
<text x="240" y="400" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" font-weight="600" fill="#fff" fill-opacity="0.95">${label}</text>
</svg>`;
}
