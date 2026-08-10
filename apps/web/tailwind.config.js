// Accent ramps derived from the reference tokens. Shared by the named
// semantic colours and by the built-in palette overrides below.
//
// BRAND and NEUTRAL resolve through the design tokens rather than fixed hex,
// so Tailwind-styled chrome (the sidebar, headers, buttons) retints with the
// active business unit exactly like the hand-written CSS does. The hex values
// they fall back to are the shipped green palette, which is what theme.css
// defines when no unit colour has been applied yet.
const BRAND = {
  50: "var(--brand-50, #eef9f4)", 100: "var(--brand-100, #d8f2e6)", 200: "var(--brand-200, #a9e2c6)",
  300: "var(--brand-300, #69c99e)", 400: "var(--brand-400, #2fae7a)", 500: "var(--brand-500, #12915f)",
  600: "var(--brand-600, #0b7a4f)", 700: "var(--brand-700, #07603f)", 800: "var(--brand-800, #064e33)",
  900: "var(--brand-900, #04301f)", 950: "var(--brand-900, #04301f)", DEFAULT: "var(--brand-600, #0b7a4f)",
};

const NEUTRAL = {
  50: "var(--surface-2, #f7faf8)", 100: "var(--ink-100, #e9f0ec)", 200: "var(--ink-200, #d5dfd9)",
  300: "var(--ink-300, #adbcb4)", 400: "var(--ink-400, #83968c)", 500: "var(--ink-500, #5d7167)",
  600: "var(--ink-600, #42544b)", 700: "var(--ink-700, #2a3b33)", 800: "var(--ink-800, #16241e)",
  900: "var(--ink-900, #0d1a15)", 950: "var(--ink-900, #0d1a15)", DEFAULT: "var(--ink-500, #5d7167)",
};

const RED = {
  50: "#fdeeed", 100: "#fad9d7", 200: "#f2b3af", 300: "#e68a84", 400: "#d5645c",
  500: "#c33d35", 600: "#a83229", 700: "#8a2820", 800: "#6d1f19", 900: "#501712",
  950: "#380f0b", DEFAULT: "#c33d35",
};

const AMBER = {
  50: "#fdf4e3", 100: "#fae6bf", 200: "#f2cd85", 300: "#e3b055", 400: "#d49730",
  500: "#c47f0a", 600: "#a66a08", 700: "#855406", 800: "#663f05", 900: "#4a2d03",
  950: "#331e02", DEFAULT: "#c47f0a",
};

const TEAL = {
  50: "#e8f6f9", 100: "#c6e9ef", 200: "#92d3de", 300: "#5bb8c9", 400: "#2b9fb4",
  500: "#0e8ca0", 600: "#0b7286", 700: "#095c6c", 800: "#074654", 900: "#05333d",
  950: "#03222a", DEFAULT: "#0e8ca0",
};

const INFO = {
  50: "#ecf3fb", 100: "#d3e4f6", 200: "#a8c8ec", 300: "#79a8df", 400: "#4f8bcd",
  500: "#2a6fb8", 600: "#225a97", 700: "#1b4878", 800: "#14365b", 900: "#0e2540",
  950: "#09182b", DEFAULT: "#2a6fb8",
};

const VIOLET = {
  50: "#f0edfb", 100: "#ded7f5", 200: "#c0b3ec", 300: "#a08ee1", 400: "#836dd4",
  500: "#6b53c4", 600: "#5842a6", 700: "#463586", 800: "#362867", 900: "#261c4a",
  950: "#191233", DEFAULT: "#6b53c4",
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand green scale. `primary-*` keeps its existing name so no
        // component class has to change.
        primary: BRAND,
        // Neutral scale, green-tinted to sit with the brand.
        secondary: NEUTRAL,
        border: "var(--line, #e4ece8)",
        background: "var(--bg, #f4f8f6)",
        foreground: "var(--ink-900, #0d1a15)",
        card: "#ffffff",
        "card-foreground": "var(--ink-900, #0d1a15)",
        muted: "var(--ink-500, #5d7167)",
        "muted-foreground": "var(--ink-400, #83968c)",
        accent: "var(--brand-600, #0b7a4f)",
        "accent-foreground": "#ffffff",
        surface: {
          DEFAULT: "#ffffff",
          2: "var(--surface-2, #fbfdfc)",
          3: "var(--surface-3, #f2f7f4)",
        },
        line: {
          DEFAULT: "var(--line, #e4ece8)",
          2: "var(--line-2, #eef3f0)",
        },
        // Semantic accents from the reference.
        danger: { DEFAULT: "#c33d35", bg: "#fdeeed" },
        warning: { DEFAULT: "#c47f0a", bg: "#fdf4e3" },
        info: { DEFAULT: "#2a6fb8", bg: "#ecf3fb" },
        success: { DEFAULT: "#0b7a4f", bg: "#e7f5ee" },

        // --- Built-in palette overrides -------------------------------------
        // Components across the app use stock classes (bg-emerald-100,
        // text-red-600, …). Re-pointing the built-in scales at the reference
        // accents brings all of them into the theme without editing markup.
        emerald: BRAND,
        green: BRAND,
        lime: BRAND,
        red: RED,
        rose: RED,
        amber: AMBER,
        yellow: AMBER,
        orange: AMBER,
        teal: TEAL,
        cyan: TEAL,
        sky: INFO,
        blue: INFO,
        indigo: VIOLET,
        purple: VIOLET,
        violet: VIOLET,
        fuchsia: VIOLET,
        pink: VIOLET,
        gray: NEUTRAL,
        slate: NEUTRAL,
        zinc: NEUTRAL,
        neutral: NEUTRAL,
        stone: NEUTRAL,
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        xs: ["11.5px", { lineHeight: "16px" }],
        sm: ["12.5px", { lineHeight: "18px" }],
        base: ["14px", { lineHeight: "21px" }],
        lg: ["16px", { lineHeight: "24px" }],
        xl: ["18px", { lineHeight: "26px" }],
        "2xl": ["21px", { lineHeight: "29px" }],
        "3xl": ["25px", { lineHeight: "33px" }],
        "4xl": ["32px", { lineHeight: "40px" }],
        "5xl": ["40px", { lineHeight: "48px" }],
      },
      // Radii from the reference token set (--r-xs … --r-xl).
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "26px",
      },
      // Elevation reuses the --sh-* tokens, which brand-theme.js retints with
      // the active unit; the literals are the shipped green fallbacks.
      boxShadow: {
        xs: "var(--sh-xs, 0 1px 2px rgba(9,42,29,.05))",
        sm: "var(--sh-sm, 0 2px 6px rgba(9,42,29,.06), 0 1px 2px rgba(9,42,29,.04))",
        md: "var(--sh-md, 0 8px 22px -8px rgba(9,42,29,.16), 0 2px 6px rgba(9,42,29,.05))",
        lg: "var(--sh-lg, 0 22px 48px -18px rgba(9,42,29,.28), 0 6px 16px rgba(9,42,29,.07))",
        xl: "var(--sh-lg, 0 22px 48px -18px rgba(9,42,29,.28), 0 6px 16px rgba(9,42,29,.07))",
        brand: "var(--sh-brand, 0 14px 30px -12px rgba(11,122,79,.45))",
      },
      // Keys are prefixed with `ease-` by Tailwind, so these produce
      // `ease-soft` and `ease-out-soft`.
      transitionTimingFunction: {
        soft: "cubic-bezier(.4,0,.2,1)",
        "out-soft": "cubic-bezier(.16,1,.3,1)",
      },
      // NOTE: do not add t-shirt-sized keys (xs/sm/md/lg/xl/2xl…) to `spacing`.
      // The spacing scale also feeds width/max-width, so those keys shadow the
      // container scale and turn `max-w-sm` into 8px instead of 24rem.
      // Use the numeric scale (p-1, gap-4, …) for spacing instead.
    },
  },
  plugins: [],
}
