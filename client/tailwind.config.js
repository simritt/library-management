/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#FBFBFA',
          100: '#F7F7F4',
          200: '#EFEFEA',
          300: '#E2E2D8',
          400: '#CBCBC0',
          800: '#2A2925',
          900: '#1C1B18',
        },
        navy: {
          50: '#F0F3F7',
          100: '#DCE3EC',
          500: '#34495E',
          700: '#203040',
          800: '#172330',
          900: '#0F1722',
        },
        sage: {
          50: '#F2F6F3',
          100: '#E1EBE3',
          600: '#4A6B53',
          700: '#3D5944',
          800: '#2F4534',
        },
        terracotta: {
          600: '#9E4733',
          700: '#823827',
        }
      },
      fontFamily: {
        serif: ['Georgia', 'Cambria', 'Palatino', 'serif'],
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
