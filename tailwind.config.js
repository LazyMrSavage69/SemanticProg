/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#050810',
        surface: '#0d1117',
        border: '#1e2a3a',
        text: '#c9d8f0',
        muted: '#4a6080',
        variable: '#00d4ff',
        loop: '#7c3aed',
        condition: '#f59e0b',
        function: '#10b981',
        recursion: '#ef4444',
        expression: '#64748b',
        particle: '#ffffff',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
