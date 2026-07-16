/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      colors: {
        ember: { DEFAULT: '#f59e0b', dark: '#b45309' },
        ash: { 900: '#0c0a09', 800: '#1c1917', 700: '#292524', 600: '#44403c' },
      },
    },
  },
  plugins: [],
}
