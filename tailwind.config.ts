import type { Config } from 'tailwindcss';

/* AlgoPlay Design System tokens — single source of truth is app/globals.css
   (:root RGB triplets). Tailwind maps them plugin-free with <alpha-value>
   so opacity modifiers like bg-accent/15 keep working. */
const token = (v: string) => `rgb(var(--${v}-rgb) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: token('ground'),   /* #0b0b0d app background */
        pit: token('pit'),        /* #141416 guide header stripes */
        deck: token('deck'),      /* #161618 tile gradient end */
        card: token('card'),      /* #1c1c1e cards & sheets */
        card2: token('card2'),    /* #29292c shimmer mid */
        raise: token('raise'),    /* #2c2c2e tile gradient start */
        haze: token('haze'),      /* #3a3a3c placeholder gradient */
        accent: token('accent'),  /* #ff7a2a brand */
        berry: token('berry'),    /* #ff2d55 brand gradient / now-line */
        link: token('link'),      /* #0a84ff links */
        star: token('star'),      /* #ffd60a ratings */
        violet: token('violet'),  /* #7c3aed aurora */
      },
    },
  },
  plugins: [],
};
export default config;
