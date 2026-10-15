/** @type {import('tailwindcss').Config} */
export default {
  // src/mobile is plain scoped CSS (iOS-style shell) — keep it out of the Tailwind scan so ordinary
  // words in that code don't generate global utilities.
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '!./src/mobile/**'],
  theme: {
    extend: {},
  },
  plugins: [],
}
