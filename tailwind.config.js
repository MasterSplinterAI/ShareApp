/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/*.{html,js}",
    "./public/**/*.{html,js}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3498db',
          dark: '#2980b9'
        },
        secondary: {
          DEFAULT: '#95a5a6',
          dark: '#7f8c8d'
        },
        success: {
          DEFAULT: '#27ae60',
          dark: '#2ecc71'
        },
        danger: {
          DEFAULT: '#e74c3c',
          dark: '#c0392b'
        },
        dark: {
          DEFAULT: '#2c3e50',
          light: '#34495e'
        }
      },
      height: {
        'video-main': '400px',
        'video-main-mobile': '250px',
        'video-thumb': '150px',
        'video-thumb-mobile': '120px'
      }
    },
  },
  plugins: [],
} 