/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f2f1ed",
      "foreground": "#263450",
      "border": "#c8cdda",
      "card": "#faf9f6",
      "cardForeground": "#263450",
      "popover": "#faf9f6",
      "popoverForeground": "#263450",
      "primary": "#3d5684",
      "primaryForeground": "#faf9f6",
      "secondary": "#e3e6ee",
      "secondaryForeground": "#263450",
      "muted": "#e8e9ed",
      "mutedForeground": "#55627a",
      "accent": "#d7dfed",
      "accentForeground": "#30476f",
      "destructive": "#963e54",
      "destructiveForeground": "#faf9f6",
      "input": "#a5adc0",
      "ring": "#3d5684",
      "chart1": "#3d5684",
      "chart2": "#4b686a",
      "chart3": "#636192",
      "chart4": "#8c6254",
      "chart5": "#963e54",
      "sidebar": "#e8e9ed",
      "sidebarForeground": "#263450",
      "sidebarBorder": "#c8cdda",
      "sidebarPrimary": "#3d5684",
      "sidebarPrimaryForeground": "#faf9f6",
      "sidebarAccent": "#d7dfed",
      "sidebarAccentForeground": "#30476f",
      "sidebarRing": "#3d5684",
      "success": "#4b686a",
      "successForeground": "#faf9f6",
      "warning": "#8c6254",
      "warningForeground": "#faf9f6",
      "overlay": "#0B0D14"
    },
    "dark": {
      "background": "#0B0D14",
      "foreground": "#E6ECFF",
      "border": "#202A5A",
      "card": "#202A5A",
      "cardForeground": "#E6ECFF",
      "popover": "#202A5A",
      "popoverForeground": "#E6ECFF",
      "primary": "#A9B7E8",
      "primaryForeground": "#0B0D14",
      "secondary": "#202A5A",
      "secondaryForeground": "#E6ECFF",
      "muted": "#151d2e",
      "mutedForeground": "#a3adc3",
      "accent": "#202A5A",
      "accentForeground": "#E6ECFF",
      "destructive": "#E53935",
      "destructiveForeground": "#0B0D14",
      "input": "#28334a",
      "ring": "#A9B7E8",
      "chart1": "#A9B7E8",
      "chart2": "#91b7b3",
      "chart3": "#b0a9dc",
      "chart4": "#cead9a",
      "chart5": "#E53935",
      "sidebar": "#0B0D14",
      "sidebarForeground": "#E6ECFF",
      "sidebarBorder": "#202A5A",
      "sidebarPrimary": "#A9B7E8",
      "sidebarPrimaryForeground": "#0B0D14",
      "sidebarAccent": "#202A5A",
      "sidebarAccentForeground": "#E6ECFF",
      "sidebarRing": "#A9B7E8",
      "success": "#91b7b3",
      "successForeground": "#0B0D14",
      "warning": "#cead9a",
      "warningForeground": "#0B0D14",
      "overlay": "#0B0D14"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "sans-serif"
    ],
    "serif": [
      "Inter",
      "sans-serif"
    ],
    "mono": [
      "IBM Plex Mono",
      "monospace"
    ]
  },
  "radius": "0.75rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
