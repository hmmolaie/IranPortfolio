/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f3f6fb',
          100: '#e4ebf5',
          700: '#16325c',
          800: '#0f2748',
          900: '#0b1f3a',
        },
        cream: '#f7f5f1',
        gold: {
          400: '#c4a35a',
          500: '#a8893e',
        },
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 40px rgba(11, 31, 58, 0.08)',
      },
    },
  },
  plugins: [],
};
