import type { CSSProperties } from "react";

// Mood palettes picked from words in the style, so a song's cover hints at its sound.
const MOODS: [RegExp, number[]][] = [
  [/techno|synth|electro|glitch|cyber|drum and bass|dark/, [258, 200, 312]],
  [/piano|jazz|soul|r&b|blues|bossa|gospel/, [28, 12, 48]],
  [/folk|acoustic|country|guitar|flamenco/, [42, 90, 18]],
  [/lo-fi|chill|ambient|dream|bedroom|trip hop/, [190, 240, 160]],
  [/rock|punk|garage|metal|anthem/, [356, 18, 330]],
  [/pop|sparkle|funk|disco|city/, [320, 280, 20]],
  [/cinematic|orchestral|strings|ballad|film/, [212, 40, 250]],
  [/reggae|afro|latin|tropical|sunshine/, [140, 50, 90]],
];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function coverStyle(id: string, style: string): CSSProperties {
  const h = hash(id);
  const lower = style.toLowerCase();
  const base = MOODS.find(([pattern]) => pattern.test(lower))?.[1] ?? [
    h % 360,
    (h >> 9) % 360,
    (h >> 18) % 360,
  ];
  const shift = (h % 24) - 12;
  const [a, b, c] = base.map((hue) => (hue + shift + 360) % 360);
  const x = 30 + (h % 40);
  const y = 26 + ((h >> 6) % 30);
  const r = 22 + ((h >> 12) % 14);
  return {
    "--r": `${r}%`,
    "--c1": `hsl(${a} 86% 66%)`,
    "--c2": `hsl(${b} 72% 46%)`,
    "--c3": `hsl(${c} 52% 16%)`,
    "--x": `${x}%`,
    "--y": `${y}%`,
    "--turn": `${h % 360}deg`,
  } as CSSProperties;
}

export default function CoverArt({
  id,
  style,
  active = false,
  size = "md",
}: {
  id: string;
  style: string;
  active?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      className={`cover cover-${size}${active ? " cover-active" : ""}`}
      style={coverStyle(id, style)}
      aria-hidden="true"
    >
      <span className="cover-light" />
      <span className="cover-grooves" />
    </span>
  );
}
