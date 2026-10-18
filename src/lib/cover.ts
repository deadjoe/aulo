/**
 * Song covers, drawn on this computer from the song's id and the words of its
 * style: no model, no download, the same picture every time for the same song.
 * The style picks a composition and its colours (synthwave grid for electronic
 * music, hills for folk, mist for lo-fi…); the id varies everything else.
 *
 * Only numbers derived from the id and style reach the markup, never the text
 * itself, so the SVG is safe to insert as is.
 */

type Composition =
  | "grid"
  | "rings"
  | "hills"
  | "mist"
  | "shards"
  | "confetti"
  | "peaks"
  | "sunburst"
  | "blocks";

// First match wins, so more specific genres come before broad ones.
const FAMILIES: [RegExp, Composition, number[]][] = [
  [/hip ?hop|rap|trap|drill|boom ?bap|grime/, "blocks", [48, 8, 280]],
  [
    /lo-?fi|chill|ambient|dream|bedroom|trip ?hop|shoegaze|new age/,
    "mist",
    [190, 250, 160],
  ],
  [
    /techno|synth|electro|edm|house|trance|glitch|cyber|drum and bass|dubstep|idm/,
    "grid",
    [285, 195, 320],
  ],
  [
    /cinematic|orchestral|strings|film|score|epic|choir/,
    "peaks",
    [215, 35, 255],
  ],
  [/metal|punk|rock|grunge|garage|hardcore|emo/, "shards", [356, 20, 330]],
  [
    /folk|acoustic|country|bluegrass|americana|guitar|flamenco|celtic/,
    "hills",
    [38, 95, 18],
  ],
  [
    /piano|jazz|soul|r&b|blues|bossa|gospel|lounge|swing|neo-?soul/,
    "rings",
    [28, 345, 48],
  ],
  [
    /reggae|afro|latin|tropical|salsa|samba|cumbia|dancehall|sunshine|summer/,
    "sunburst",
    [36, 160, 8],
  ],
  [
    /pop|disco|funk|dance|k-?pop|city|sparkle|bubblegum/,
    "confetti",
    [325, 265, 45],
  ],
];

const COMPOSITIONS: Composition[] = [
  "grid",
  "rings",
  "hills",
  "mist",
  "shards",
  "confetti",
  "peaks",
  "sunburst",
  "blocks",
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small seeded random source (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (low: number, high: number) => low + (high - low) * next(),
    int: (low: number, high: number) =>
      Math.floor(low + (high - low + 1) * next()),
    pick: <T>(items: T[]) => items[Math.floor(next() * items.length)],
  };
}

type Random = ReturnType<typeof random>;

const n = (value: number) => Math.round(value * 10) / 10;
const hsl = (h: number, s: number, l: number, a = 1) =>
  a === 1
    ? `hsl(${n(((h % 360) + 360) % 360)} ${n(s)}% ${n(l)}%)`
    : `hsl(${n(((h % 360) + 360) % 360)} ${n(s)}% ${n(l)}% / ${n(a)})`;

interface Palette {
  /** Deep background. */
  deep: string;
  /** Background toward the light. */
  mid: string;
  /** The bright main shape. */
  light: string;
  /** A second colour for details. */
  accent: string;
  /** A soft highlight. */
  glow: string;
  hues: number[];
}

function palette(hues: number[], r: Random): Palette {
  // Songs of one genre share a look but not a colour.
  const shift = r.between(-38, 38);
  const [a, b, c] = hues.map((h) => h + shift);
  return {
    deep: hsl(c, 46, r.between(9, 14)),
    mid: hsl(b, 62, r.between(32, 42)),
    light: hsl(a, 88, r.between(64, 72)),
    accent: hsl(b + 24, 82, r.between(55, 64)),
    glow: hsl(a + 10, 95, 86),
    hues: [a, b, c],
  };
}

/** Which composition and colours a style gets; unknown styles are varied by the id. */
export function coverKind(id: string, style: string) {
  const lower = style.toLowerCase();
  const match = FAMILIES.find(([pattern]) => pattern.test(lower));
  if (match) return { composition: match[1], hues: match[2] };
  const h = hash(id);
  return {
    composition: COMPOSITIONS[h % COMPOSITIONS.length],
    hues: [h % 360, (h >> 9) % 360, (h >> 18) % 360],
  };
}

function sky(key: string, p: Palette) {
  return {
    defs: `<linearGradient id="${key}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.deep}"/><stop offset="1" stop-color="${p.mid}"/></linearGradient>`,
    body: `<rect width="100" height="100" fill="url(#${key}s)"/>`,
  };
}

function grid(key: string, p: Palette, r: Random) {
  const s = sky(key, p);
  const horizon = r.between(56, 66);
  const cx = r.between(34, 66);
  const radius = r.between(17, 25);
  const sunTop = horizon - radius * 1.6;
  let cuts = "";
  for (let i = 0; i < 5; i++) {
    const y = horizon - radius * 0.15 - i * radius * 0.22;
    cuts += `<rect x="0" y="${n(y)}" width="100" height="${n(1 + i * 0.35)}" fill="${p.deep}"/>`;
  }
  let lines = "";
  for (let i = 0; i < 7; i++) {
    const y = horizon + Math.pow(i / 6, 1.8) * (100 - horizon);
    lines += `<line x1="0" y1="${n(y)}" x2="100" y2="${n(y)}"/>`;
  }
  for (let i = -6; i <= 6; i++) {
    lines += `<line x1="${n(50 + i * 4)}" y1="${n(horizon)}" x2="${n(50 + i * 22)}" y2="100"/>`;
  }
  let ridge = "";
  if (r.next() < 0.5) {
    let d = `M0 ${n(horizon)}`;
    for (let x = 0; x <= 100; x += r.between(6, 12))
      d += `L${n(x)} ${n(horizon - r.between(2, 12))}`;
    ridge = `<path d="${d}L100 ${n(horizon)}Z" fill="${p.deep}"/><path d="${d}" fill="none" stroke="${p.accent}" stroke-width=".6"/>`;
  }
  return `<defs>${s.defs}<linearGradient id="${key}u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.glow}"/><stop offset="1" stop-color="${p.light}"/></linearGradient><clipPath id="${key}c"><rect width="100" height="${n(horizon)}"/></clipPath></defs>${s.body}<g clip-path="url(#${key}c)"><circle cx="${n(cx)}" cy="${n(sunTop + radius)}" r="${n(radius)}" fill="url(#${key}u)"/>${cuts}</g>${ridge}<rect y="${n(horizon)}" width="100" height="${n(100 - horizon)}" fill="${p.deep}"/><g stroke="${p.accent}" stroke-width=".6" opacity=".85">${lines}</g>`;
}

function rings(key: string, p: Palette, r: Random) {
  const cx = r.between(38, 62);
  const cy = r.between(40, 60);
  const outer = r.between(34, 42);
  let grooves = "";
  for (
    let radius = outer - 3;
    radius > outer * 0.4;
    radius -= r.between(2.2, 3.4)
  ) {
    grooves += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="none" stroke="${p.light}" stroke-opacity="${n(r.between(0.08, 0.22))}" stroke-width=".5"/>`;
  }
  const arcs = [0, 1, 2]
    .map(() => {
      const radius = r.between(outer * 0.5, outer + 8);
      const start = r.between(0, Math.PI * 2);
      const end = start + r.between(0.6, 1.6);
      const x1 = cx + radius * Math.cos(start);
      const y1 = cy + radius * Math.sin(start);
      const x2 = cx + radius * Math.cos(end);
      const y2 = cy + radius * Math.sin(end);
      return `<path d="M${n(x1)} ${n(y1)}A${n(radius)} ${n(radius)} 0 0 1 ${n(x2)} ${n(y2)}" fill="none" stroke="${p.accent}" stroke-width="${n(r.between(1.2, 2.6))}" stroke-linecap="round"/>`;
    })
    .join("");
  return `<defs><radialGradient id="${key}b" cx=".3" cy=".25" r="1"><stop offset="0" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.deep}"/></radialGradient></defs><rect width="100" height="100" fill="url(#${key}b)"/><circle cx="${n(cx + 3)}" cy="${n(cy + 4)}" r="${n(outer)}" fill="#000" opacity=".35"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(outer)}" fill="${p.deep}"/>${grooves}<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(outer * 0.32)}" fill="${p.light}"/><circle cx="${n(cx)}" cy="${n(cy)}" r="1.6" fill="${p.deep}"/>${arcs}`;
}

function wave(r: Random, base: number, height: number, bumps: number) {
  const points: string[] = [];
  const phase = r.between(0, Math.PI * 2);
  for (let i = 0; i <= 20; i++) {
    const x = i * 5;
    const y =
      base +
      Math.sin((i / 20) * Math.PI * bumps + phase) * height +
      Math.sin((i / 20) * Math.PI * bumps * 2.3 + phase * 1.7) * height * 0.35;
    points.push(`${x} ${n(y)}`);
  }
  return `M0 100L${points.join("L")}L100 100Z`;
}

function hills(key: string, p: Palette, r: Random) {
  const [a, b, c] = p.hues;
  const night = r.next() < 0.4;
  const sunX = r.between(25, 75);
  const sunY = r.between(24, 38);
  const layers = [0, 1, 2, 3]
    .map((i) => {
      const fill = night
        ? hsl(i % 2 ? c : b, 30 + i * 4, 30 - i * 6)
        : hsl(i % 2 ? b : a + 20, 40 + i * 6, 52 - i * 11);
      return `<path d="${wave(r, 52 + i * 12, r.between(3, 7), r.between(1.2, 2.6))}" fill="${fill}"/>`;
    })
    .join("");
  const top = night ? hsl(c + 200, 50, 12) : hsl(c + 30, 55, 82);
  const bottom = night ? hsl(b + 180, 45, 30) : hsl(a, 70, 72);
  let stars = "";
  if (night)
    for (let i = 0; i < 25; i++)
      stars += `<circle cx="${n(r.between(0, 100))}" cy="${n(r.between(0, 50))}" r="${n(r.between(0.15, 0.45))}"/>`;
  const sun = night ? hsl(a + 20, 70, 88) : hsl(a - 10, 90, 62);
  return `<defs><linearGradient id="${key}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${key}s)"/><g fill="#fff" opacity=".7">${stars}</g><circle cx="${n(sunX)}" cy="${n(sunY)}" r="${n(r.between(night ? 6 : 9, night ? 9 : 13))}" fill="${sun}"/>${layers}`;
}

function mist(key: string, p: Palette, r: Random) {
  const blobs = [0, 1, 2, 3]
    .map((i) => {
      const color = [p.light, p.accent, p.mid, p.glow][i];
      return `<radialGradient id="${key}g${i}"><stop offset="0" stop-color="${color}" stop-opacity="${n(r.between(0.55, 0.85))}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
    })
    .join("");
  const shapes = [0, 1, 2, 3]
    .map(
      (i) =>
        `<ellipse cx="${n(r.between(10, 90))}" cy="${n(r.between(15, 85))}" rx="${n(r.between(30, 55))}" ry="${n(r.between(22, 40))}" fill="url(#${key}g${i})"/>`,
    )
    .join("");
  let grain = "";
  for (let i = 0; i < 60; i++)
    grain += `<circle cx="${n(r.between(0, 100))}" cy="${n(r.between(0, 100))}" r="${n(r.between(0.15, 0.45))}"/>`;
  return `<defs>${blobs}</defs><rect width="100" height="100" fill="${p.deep}"/>${shapes}<g fill="#fff" opacity=".35">${grain}</g>`;
}

function shards(key: string, p: Palette, r: Random) {
  const lean = r.next() < 0.5 ? 1 : -1;
  const pieces = [0, 1, 2, 3, 4]
    .map((i) => {
      const x = r.between(-10, 90);
      const w = r.between(10, 34);
      const tilt = r.between(18, 40) * lean;
      const color = [p.light, p.accent, p.mid, p.glow, p.light][i];
      return `<polygon points="${n(x)},-5 ${n(x + w)},-5 ${n(x + w - tilt)},105 ${n(x - tilt)},105" fill="${color}" opacity="${n(r.between(0.55, 0.95))}"/>`;
    })
    .join("");
  let stripes = "";
  const sy = r.between(55, 80);
  for (let i = 0; i < 6; i++)
    stripes += `<rect x="0" y="${n(sy + i * 2.4)}" width="100" height="1.1" fill="${p.deep}"/>`;
  return `<defs><linearGradient id="${key}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.deep}"/><stop offset="1" stop-color="#050505"/></linearGradient></defs><rect width="100" height="100" fill="url(#${key}b)"/>${pieces}${stripes}<rect width="100" height="100" fill="none" stroke="${p.deep}" stroke-width="6"/>`;
}

function confetti(key: string, p: Palette, r: Random) {
  const colors = [p.light, p.accent, p.glow, p.deep];
  let bits = "";
  for (let i = 0; i < 26; i++) {
    const x = r.between(4, 96);
    const y = r.between(4, 96);
    const size = r.between(1.6, 4.2);
    const color = r.pick(colors);
    const kind = r.int(0, 2);
    if (kind === 0)
      bits += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(size / 1.6)}" fill="${color}"/>`;
    else if (kind === 1)
      bits += `<rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" transform="rotate(${n(r.between(0, 90))} ${n(x)} ${n(y)})" fill="${color}"/>`;
    else
      bits += `<path d="M${n(x)} ${n(y)}q${n(size)} ${n(-size)} ${n(size * 2)} 0t${n(size * 2)} 0" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round"/>`;
  }
  const cx = r.between(35, 65);
  const cy = r.between(35, 65);
  return `<defs><linearGradient id="${key}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.deep}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${key}b)"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r.between(22, 30))}" fill="${p.light}"/><circle cx="${n(cx + r.between(-12, 12))}" cy="${n(cy + r.between(-12, 12))}" r="${n(r.between(9, 14))}" fill="${p.accent}" opacity=".9"/>${bits}`;
}

function peaks(key: string, p: Palette, r: Random) {
  const [a, b] = p.hues;
  let stars = "";
  for (let i = 0; i < 30; i++)
    stars += `<circle cx="${n(r.between(0, 100))}" cy="${n(r.between(0, 45))}" r="${n(r.between(0.15, 0.5))}"/>`;
  const ranges = [0, 1, 2]
    .map((i) => {
      let d = `M0 100L0 ${n(70 + i * 8)}`;
      let x = 0;
      while (x < 100) {
        x += r.between(8, 18);
        d += `L${n(x)} ${n(r.between(38 + i * 12, 60 + i * 12))}`;
        x += r.between(6, 14);
        d += `L${n(x)} ${n(r.between(62 + i * 10, 78 + i * 8))}`;
      }
      d += "L100 100Z";
      return `<path d="${d}" fill="${hsl(b, 40 - i * 8, 30 - i * 9)}"/>`;
    })
    .join("");
  const lake =
    r.next() < 0.45
      ? `<rect y="86" width="100" height="14" fill="${hsl(a, 50, 40)}"/><g stroke="${p.glow}" stroke-width=".5" opacity=".6"><line x1="${n(r.between(20, 40))}" y1="90" x2="${n(r.between(55, 75))}" y2="90"/><line x1="${n(r.between(30, 45))}" y1="94" x2="${n(r.between(50, 65))}" y2="94"/></g>`
      : "";
  return `<defs><linearGradient id="${key}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.deep}"/><stop offset=".7" stop-color="${hsl(a, 60, 48)}"/><stop offset="1" stop-color="${hsl(a + 20, 80, 70)}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${key}s)"/><g fill="#fff" opacity=".7">${stars}</g><circle cx="${n(r.between(20, 80))}" cy="${n(r.between(16, 30))}" r="${n(r.between(5, 8))}" fill="${p.glow}"/>${ranges}${lake}`;
}

function sunburst(key: string, p: Palette, r: Random) {
  const cx = r.between(22, 78);
  const cy = r.between(60, 80);
  const count = r.int(10, 16);
  let rays = "";
  for (let i = 0; i < count; i++) {
    const a1 = Math.PI + (i / count) * Math.PI;
    const a2 = a1 + (Math.PI / count) * 0.5;
    rays += `<polygon points="${n(cx)},${n(cy)} ${n(cx + 160 * Math.cos(a1))},${n(cy + 160 * Math.sin(a1))} ${n(cx + 160 * Math.cos(a2))},${n(cy + 160 * Math.sin(a2))}"/>`;
  }
  let waves = "";
  for (let i = 0; i < 4; i++)
    waves += `<path d="${wave(r, cy + 6 + i * 6, 1.6, 6)}" fill="${i % 2 ? p.accent : p.mid}"/>`;
  return `<defs><linearGradient id="${key}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.light}"/><stop offset="1" stop-color="${p.accent}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${key}b)"/><g fill="${p.glow}" opacity=".45">${rays}</g><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r.between(14, 20))}" fill="${p.glow}"/>${waves}`;
}

function blocks(key: string, p: Palette, r: Random) {
  const columns = r.int(6, 9);
  const width = 100 / columns;
  let bars = "";
  for (let i = 0; i < columns; i++) {
    const height = r.between(18, 78);
    const color = r.next() > 0.75 ? p.accent : p.light;
    bars += `<rect x="${n(i * width + width * 0.12)}" y="${n(100 - height)}" width="${n(width * 0.76)}" height="${n(height)}" fill="${color}" opacity="${n(r.between(0.75, 1))}"/>`;
  }
  const bx = r.between(8, 50);
  const by = r.between(8, 28);
  return `<defs><linearGradient id="${key}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0b0b"/><stop offset="1" stop-color="${p.deep}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${key}b)"/><rect x="${n(bx)}" y="${n(by)}" width="${n(r.between(30, 44))}" height="${n(r.between(12, 20))}" fill="${p.glow}"/><rect x="${n(bx + 4)}" y="${n(by + 4)}" width="${n(r.between(30, 44))}" height="${n(r.between(12, 20))}" fill="none" stroke="${p.accent}" stroke-width="1.2"/>${bars}`;
}

const DRAW: Record<
  Composition,
  (key: string, p: Palette, r: Random) => string
> = {
  grid,
  rings,
  hills,
  mist,
  shards,
  confetti,
  peaks,
  sunburst,
  blocks,
};

const cache = new Map<string, string>();

/**
 * A square SVG cover for a song. `key` keeps gradient ids unique when the
 * same markup is inlined more than once on a page.
 */
export function coverSvg(id: string, style: string, key = "c"): string {
  const cacheKey = `${id}\u0000${style}\u0000${key}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const { composition, hues } = coverKind(id, style);
  const r = random(hash(id));
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "");
  const p = palette(hues, r);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${DRAW[composition](safeKey, p, r)}</svg>`;
  if (cache.size > 500) cache.clear();
  cache.set(cacheKey, svg);
  return svg;
}

/** The cover as PNG bytes, for writing into downloaded and shared audio files. */
export async function coverPng(
  id: string,
  style: string,
  size = 800,
): Promise<number[]> {
  const svg = coverSvg(id, style, "x").replace(
    "<svg ",
    `<svg width="${size}" height="${size}" `,
  );
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(size, size);
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.drawImage(image, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("No image");
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    URL.revokeObjectURL(url);
  }
}
