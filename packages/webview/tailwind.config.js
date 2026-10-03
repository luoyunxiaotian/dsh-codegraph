/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Montserrat',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        panel: '28px',
      },
      colors: {
        dsh: {
          base: 'var(--dsw-alias-bg-base)',
          platform: 'var(--dsw-alias-bg-module-platform)',
          layer1: 'var(--dsw-alias-bg-layer-1)',
          layer2: 'var(--dsw-alias-bg-layer-2)',
          layer3: 'var(--dsw-alias-bg-layer-3)',
          border1: 'var(--dsw-alias-border-l1)',
          border2: 'var(--dsw-alias-border-l2)',
          border3: 'var(--dsw-alias-border-l3)',
          border4: 'var(--dsw-alias-border-l4)',
          primary: 'var(--dsw-alias-label-primary)',
          secondary: 'var(--dsw-alias-label-secondary)',
          tertiary: 'var(--dsw-alias-label-tertiary)',
          dimmed: 'var(--dsw-alias-label-dimmed)',
          blue: {
            DEFAULT: '#4176e6',
            hover: '#5686fe',
            active: '#3462c7',
            tint: 'var(--dsw-blue-tint)',
            border: 'var(--dsw-blue-border)',
          },
          green: {
            DEFAULT: '#16a34a',
            tint: 'var(--dsw-green-tint)',
            border: 'var(--dsw-green-border)',
          },
          amber: {
            DEFAULT: '#d97706',
            tint: 'var(--dsw-amber-tint)',
            border: 'var(--dsw-amber-border)',
          },
        },
      },
    },
  },
  plugins: [],
}
