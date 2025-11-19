/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#6366F1',  // Indigo/Purple for buttons
        'primary-hover': '#5558E3',
        accent: '#00FFFF',  // Cyan/Teal for icon accents
        'background-light': '#EAEAEA',
        'background-dark': '#0F172A',  // Dark blue/navy
        'background-card': '#1E293B',  // Slightly lighter for cards
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        full: '9999px',
      },
    },
  },
  plugins: [],
}
