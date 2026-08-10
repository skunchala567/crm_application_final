/* =====================================================================
   BRAND THEME — derive the whole palette from one business-unit colour.

   theme.css defines the design tokens (--brand-*, --ink-*, surfaces) and
   every other sheet reads them. This module regenerates those tokens from
   the active business unit's colour, so switching units retints the entire
   UI rather than just a swatch.

   Colours are interpolated in OKLab, not HSL: OKLab's lightness axis is
   perceptual, so the ramp keeps the same visual weight at every step no
   matter the hue. An HSL ramp makes yellows look washed out and blues
   look muddy at identical "lightness" values.
   ===================================================================== */

const STORAGE_KEY = 'crm_brand_color';
const STYLE_ELEMENT_ID = 'crm-brand-theme';
export const DEFAULT_BRAND_COLOR = '#0b7a4f';

/* The reference ramp is the hand-tuned green palette that shipped with the
   design system, measured in OKLab. Chroma is expressed as a ratio of the
   seed's chroma so a muted seed yields a muted ramp and a vivid one stays
   vivid. Feeding DEFAULT_BRAND_COLOR back in reproduces the original palette
   to within a rounding step.

   The third number is how much of the seed's own lightness offset each step
   takes on. It is 1 at step 600 — the primary, which should be the colour that
   was actually chosen — and tapers towards the ends, so a dark navy seed does
   not drag the pale tints down into mid-greys, nor a light seed push the dark
   end up into them. */
const BRAND_STEPS = [
  [50, 0.9725, 0.117, 0.10],
  [100, 0.9389, 0.278, 0.18],
  [200, 0.8659, 0.618, 0.32],
  [300, 0.7652, 0.982, 0.50],
  [400, 0.6698, 1.180, 0.70],
  [500, 0.5811, 1.127, 0.88],
  [600, 0.5125, 1.000, 1.00],
  [700, 0.4330, 0.828, 0.88],
  [800, 0.3758, 0.709, 0.75],
  [900, 0.2750, 0.497, 0.55],
];

/* How far the primary may sit from the reference lightness. Dark brand
   colours are reproduced almost exactly; light ones are pulled down, because
   a pale primary cannot carry the white text that the UI puts on it and its
   tints would collapse into the page background. */
const MIN_LIGHTNESS_SHIFT = -0.18;
const MAX_LIGHTNESS_SHIFT = 0.06;

/* The greys are not neutral — they carry a trace of the brand hue, which is
   what makes the chrome feel of a piece with the accent. Chroma here is
   absolute (a hint), scaled down for low-chroma seeds so a grey brand
   colour produces genuinely grey text rather than a colour cast. */
const INK_STEPS = [
  [100, 0.9487, 0.0091],
  [200, 0.8943, 0.0134],
  [300, 0.7813, 0.0200],
  [400, 0.6551, 0.0262],
  [500, 0.5292, 0.0284],
  [600, 0.4277, 0.0269],
  [700, 0.3347, 0.0262],
  [800, 0.2452, 0.0225],
  [900, 0.2037, 0.0210],
];

const SURFACE_STEPS = [
  ['bg', 0.9755, 0.0050],
  ['surface-2', 0.9923, 0.0025],
  ['surface-3', 0.9715, 0.0066],
  ['line', 0.9359, 0.0100],
  ['line-2', 0.9595, 0.0066],
];

const REFERENCE_CHROMA = 0.1136; // chroma of DEFAULT_BRAND_COLOR
const MIN_WHITE_CONTRAST = 4.5; // WCAG AA for normal text on the primary

/* ---------------------------------------------------------------- colour */

const toLinear = channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const toGamma = channel => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);
const clamp01 = value => Math.min(1, Math.max(0, value));

export function normaliseHexColor(input) {
  const raw = String(input ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('')}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase();
  return '';
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToOklch([r, g, b]) {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
}

function oklchToRgb({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  const a = Math.cos(rad) * C;
  const b = Math.sin(rad) * C;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const inGamut = ([r, g, b]) => [r, g, b].every(channel => channel >= -0.0005 && channel <= 1.0005);

/* Out-of-gamut requests are unavoidable: a vivid seed asks for chroma at
   light and dark steps that sRGB cannot render. Reducing chroma while
   holding lightness keeps the ramp's rhythm intact — clipping the channels
   instead would flatten several steps onto the same visible colour. */
function oklchToHex({ L, C, h }) {
  let chroma = C;
  let rgb = oklchToRgb({ L, C: chroma, h });
  if (!inGamut(rgb)) {
    let low = 0;
    let high = chroma;
    for (let i = 0; i < 18; i += 1) {
      chroma = (low + high) / 2;
      rgb = oklchToRgb({ L, C: chroma, h });
      if (inGamut(rgb)) low = chroma; else high = chroma;
    }
    rgb = oklchToRgb({ L, C: low, h });
  }
  return `#${rgb.map(channel => Math.round(clamp01(toGamma(channel)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel => toLinear(channel / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrastWithWhite = hex => 1.05 / (relativeLuminance(hex) + 0.05);

/* ----------------------------------------------------------------- ramps */

export function buildBrandPalette(seedInput) {
  const seed = normaliseHexColor(seedInput) || DEFAULT_BRAND_COLOR;
  const { L: seedLightness, C: seedChroma, h } = rgbToOklch(hexToRgb(seed));
  const hue = Number.isNaN(h) ? 0 : h;
  const seedShift = Math.min(MAX_LIGHTNESS_SHIFT, Math.max(MIN_LIGHTNESS_SHIFT, seedLightness - 0.5125));

  /* The primary carries white text in dozens of places (buttons, the active
     sidebar row, badges). A yellow or cyan seed at the reference lightness
     is far brighter than the green it replaces, so white on it would fail
     AA. Darkening the mid-to-dark half of the ramp until the primary clears
     4.5:1 keeps every existing `color:#fff` rule legible. */
  let contrastShift = 0;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = oklchToHex({ L: 0.5125 + seedShift - contrastShift, C: seedChroma, h: hue });
    if (contrastWithWhite(candidate) >= MIN_WHITE_CONTRAST) break;
    contrastShift += 0.012;
  }

  const brand = {};
  let previous = Infinity;
  for (const [step, lightness, chromaRatio, seedWeight] of BRAND_STEPS) {
    // Only the half that sits under white text takes the contrast correction;
    // the tints stay put so pale backgrounds keep their contrast against
    // brand-coloured text.
    const corrected = lightness + seedShift * seedWeight - (step >= 500 ? contrastShift : 0);
    // The ramp must stay strictly ordered even at the extremes, or two steps
    // collapse onto one colour and the UI loses a level of hierarchy.
    const resolved = Math.min(Math.max(0.14, corrected), previous - 0.012, 0.985);
    previous = resolved;
    brand[step] = oklchToHex({ L: resolved, C: seedChroma * chromaRatio, h: hue });
  }

  // A grey seed should not tint the chrome; a vivid one should not tint it
  // any harder than the original green did.
  const neutralScale = Math.min(1, seedChroma / REFERENCE_CHROMA);
  const ink = {};
  for (const [step, lightness, chroma] of INK_STEPS) ink[step] = oklchToHex({ L: lightness, C: chroma * neutralScale, h: hue });
  const surfaces = {};
  for (const [name, lightness, chroma] of SURFACE_STEPS) surfaces[name] = oklchToHex({ L: lightness, C: chroma * neutralScale, h: hue });

  const shadowRgb = hexToRgb(brand[900]).join(', ');
  const primaryRgb = hexToRgb(brand[600]).join(', ');

  return {
    seed,
    brand,
    ink,
    surfaces,
    primaryRgb,
    shadowRgb,
    // Kept for surfaces that are not the primary itself — a caller placing
    // text on brand-400, say, cannot assume white works there.
    onBrand: contrastWithWhite(brand[600]) >= MIN_WHITE_CONTRAST ? '#ffffff' : brand[900],
  };
}

export function paletteToCss(palette) {
  const { brand, ink, surfaces, primaryRgb, shadowRgb } = palette;
  const lines = [];
  for (const [step, value] of Object.entries(brand)) lines.push(`--brand-${step}:${value}`);
  for (const [step, value] of Object.entries(ink)) lines.push(`--ink-${step}:${value}`);
  for (const [name, value] of Object.entries(surfaces)) lines.push(`--${name}:${value}`);
  lines.push(`--brand-seed:${palette.seed}`);
  lines.push(`--on-brand:${palette.onBrand}`);
  lines.push(`--primary-rgb:${primaryRgb}`);
  lines.push(`--sh-xs:0 1px 2px rgba(${shadowRgb}, .05)`);
  lines.push(`--sh-sm:0 2px 6px rgba(${shadowRgb}, .06), 0 1px 2px rgba(${shadowRgb}, .04)`);
  lines.push(`--sh-md:0 8px 22px -8px rgba(${shadowRgb}, .16), 0 2px 6px rgba(${shadowRgb}, .05)`);
  lines.push(`--sh-lg:0 22px 48px -18px rgba(${shadowRgb}, .28), 0 6px 16px rgba(${shadowRgb}, .07)`);
  lines.push(`--sh-brand:0 14px 30px -12px rgba(${primaryRgb}, .45)`);
  return `:root{${lines.join(';')}}`;
}

/* ---------------------------------------------------------------- applying */

// A stylesheet rather than inline styles on <html>: inline styles would
// outrank the [data-theme="dark"] block in theme.css, which is how a dark
// theme would silently lose its surface overrides.
function writeStyleElement(css) {
  if (typeof document === 'undefined') return;
  let element = document.getElementById(STYLE_ELEMENT_ID);
  if (!element) {
    element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    document.head.appendChild(element);
  }
  if (element.textContent !== css) element.textContent = css;
}

/** Retint the UI. Returns the resolved hex, or '' when the input is unusable. */
export function applyBrandTheme(colorInput) {
  const seed = normaliseHexColor(colorInput);
  if (!seed) return '';
  writeStyleElement(paletteToCss(buildBrandPalette(seed)));
  try { localStorage.setItem(STORAGE_KEY, seed); } catch { /* private mode */ }
  return seed;
}

/**
 * Paint the last known brand colour before React mounts. Business units load
 * over the network, so without this the app renders in the default green for
 * a beat and then flips — a visible flash on every reload.
 */
export function applyCachedBrandTheme() {
  let cached = '';
  try { cached = localStorage.getItem(STORAGE_KEY) || ''; } catch { /* private mode */ }
  const seed = normaliseHexColor(cached);
  if (!seed || seed === DEFAULT_BRAND_COLOR) return '';
  writeStyleElement(paletteToCss(buildBrandPalette(seed)));
  return seed;
}
