/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f4f0e8',
          100: '#e7e0d4',
          700: '#1a3348',
          800: '#102033',
          900: '#08131f',
        },
        cream: '#f3eee6',
        gold: {
          400: '#e2b56a',
          500: '#c48a3c',
        },
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 40px rgba(8, 19, 31, 0.08)',
      },
    },
  },
  plugins: [],
};
