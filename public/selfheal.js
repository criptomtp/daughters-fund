// Самолікування завантаження.
//
// Якщо головний бандл не підвантажився — найчастіше тому, що старий service
// worker віддав сторінку з посиланням на вже видалені з сервера файли, — знімаємо
// реєстрацію SW, чистимо кеші й перезавантажуємось.
//
// ВАЖЛИВО: caches.delete() чистить лише кеш файлів застосунку. Дані портфеля
// лежать в IndexedDB і цим не зачіпаються.
//
// Спрацьовує один раз за сесію, щоб не зациклитись, коли просто немає інтернету.
(function () {
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "SCRIPT" || window.__appBooted) return;
    try {
      if (sessionStorage.getItem("df_selfheal")) return;
      sessionStorage.setItem("df_selfheal", "1");
    } catch { /* приватний режим — просто пробуємо один раз */ }

    var reload = function () { location.reload(); };
    var step = navigator.serviceWorker && navigator.serviceWorker.getRegistrations
      ? navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        })
      : Promise.resolve();

    step.then(function () {
      return window.caches
        ? caches.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) { return caches.delete(k); }));
          })
        : null;
    }).then(reload, reload);
  }, true);
})();
