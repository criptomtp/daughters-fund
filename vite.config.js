import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// Позначка збірки — щоб було видно, яка саме версія відкрита на телефоні.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    VitePWA({
      // Service worker вимкнено навмисно, і ось чому.
      //
      // За один день він тричі поклав застосунок: спершу віддавав стару збірку
      // після деплою, потім не міг підтягнути окремий чанк («Importing a module
      // script failed»), потім віддавав прекешену сторінку з посиланнями на вже
      // видалені файли — чорний екран. Причина спільна: керування версією
      // застосунку віддано кешу, який живе на телефоні й оновлюється, коли
      // сам захоче.
      //
      // selfDestroying генерує SW, який знімає власну реєстрацію і чистить
      // кеші — це прибирає вже встановлені зламані копії з пристроїв.
      //
      // Ціна рішення: застосунок більше не працює офлайн. Для щомісячного
      // запису покупок, який робиться з інтернетом, це прийнятний обмін —
      // на відміну від чорного екрана. Дані в IndexedDB не залежать від SW
      // взагалі й лишаються на місці.
      selfDestroying: true,
      // Сторінка більше НЕ реєструє service worker. Це критично: із injectRegister
      // самознищувальний SW створював нескінченний цикл — registerSW.js реєстрував
      // його при кожному завантаженні, SW на activate знімав реєстрацію і
      // перезавантажував сторінку, та реєструвала знову. Сторінка не встигала
      // відрендеритись — чорний екран.
      //
      // Файл sw.js далі віддається, щоб уже встановлені на пристроях копії
      // оновились до самознищувальної версії й прибрали себе один раз.
      injectRegister: false,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Daughters Fund — облік ОВДП',
        short_name: 'Daughters Fund',
        description: 'Особистий трекер ОВДП для сім\'ї',
        lang: 'uk',
        theme_color: '#c9a96a',
        background_color: '#0a0d14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // vite-plugin-pwa підставляє navigateFallback: 'index.html' за
        // замовчуванням — вимикаємо явно, інакше все нижче не має сенсу.
        navigateFallback: null,
        // navigateFallback навмисне НЕ вмикаємо. З ним service worker віддавав
        // прекешений index.html на кожну навігацію, і після деплою застосунок
        // відкривав стару сторінку, яка тягне вже видалені з сервера хеші
        // ассетів → 404 → чорний екран. Замість цього — мережа спершу,
        // а кеш лише як запасний варіант в офлайні.
        runtimeCaching: [{
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'html-shell',
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 4 },
          },
        }],
        // Без цього старі прекеші лишаються назавжди, і встановлений на iOS
        // застосунок продовжує показувати попередню збірку після деплою.
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Запит на ассет ніколи не має підмінятись на index.html — саме так
        // виникає «Importing a module script failed»: браузер отримує HTML
        // там, де чекав JS.
      },
    }),
  ],
})
