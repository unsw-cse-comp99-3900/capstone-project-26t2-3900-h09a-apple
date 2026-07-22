/** Friction heat colour: low #3fa87f → mid #e8b23a → high #ef4444 */

const LO = { r: 0x3f, g: 0xa8, b: 0x7f };
const MID = { r: 0xe8, g: 0xb2, b: 0x3a };
const HI = { r: 0xef, g: 0x44, b: 0x44 };

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mix(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): string {
  return `rgb(${lerp(a.r, b.r, t)} ${lerp(a.g, b.g, t)} ${lerp(a.b, b.b, t)})`;
}

export function frictionHeatColor(score: number): string {
  const t = Math.min(1, Math.max(0, score / 100));
  if (t <= 0.5) {
    return mix(LO, MID, t / 0.5);
  }
  return mix(MID, HI, (t - 0.5) / 0.5);
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

export function initialFromEmail(email: string): string {
  const name = displayNameFromEmail(email);
  return (name.charAt(0) || '?').toUpperCase();
}
