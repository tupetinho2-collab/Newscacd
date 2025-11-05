
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brandBlue: '#1d4ed8',
        brandGreen: '#16a34a',
        brandRed: '#ef4444',
        brandWhite: '#ffffff',
      },
      boxShadow: {
        smooth: '0 10px 30px -12px rgba(0,0,0,0.25)',
      },
      backgroundImage: {
        'hero-worldmap': "url('data:image/svg+xml;utf8," + encodeURIComponent(`
          <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 480' preserveAspectRatio='xMidYMid slice'>
            <defs>
              <filter id='blur' x='-10%' y='-10%' width='120%' height='120%'>
                <feGaussianBlur stdDeviation='2' />
              </filter>
            </defs>
            <rect width='1440' height='480' fill='white'/>
            <g fill='none' stroke='#1d4ed8' stroke-width='0.8' opacity='0.25' filter='url(#blur)'>
              <path d='M100 200 C 150 150, 250 150, 300 200 S 450 250, 500 200'/>
              <path d='M200 300 C 300 250, 400 250, 500 300 S 700 350, 900 300'/>
              <path d='M600 220 C 650 180, 750 180, 800 220 S 950 260, 1000 220'/>
              <path d='M800 170 C 900 130, 1000 130, 1100 170 S 1250 210, 1350 170'/>
              <circle cx='260' cy='220' r='18' fill='#1d4ed8' opacity='0.08'/>
              <circle cx='1060' cy='190' r='22' fill='#16a34a' opacity='0.08'/>
              <circle cx='760' cy='260' r='16' fill='#ef4444' opacity='0.08'/>
            </g>
          </svg>
        `) }
      }
    },
  },
  plugins: [],
}
