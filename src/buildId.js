/* global __BUILD_ID__ */
// Позначка збірки, підставляється Vite (define у vite.config.js).
// Потрібна, щоб на телефоні було видно, яка саме версія зараз відкрита:
// встановлений PWA може віддавати стару збірку з кешу service worker.
export const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
