// GitHub Pages lets browsers reuse files for 10 minutes (and Home Screen apps can hold them longer).
// The deploy stamps the build into BUILD and version.txt; if the server has a newer build, reload once.
const BUILD = '__V__';

if (!BUILD.startsWith('__')) { // unstamped when served locally
  fetch('version.txt', { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : BUILD))
    .then((latest) => {
      latest = latest.trim();
      let reloadedFor = null;
      try { reloadedFor = sessionStorage.getItem('reloadedFor'); } catch {}
      if (latest !== BUILD && reloadedFor !== latest) {
        try { sessionStorage.setItem('reloadedFor', latest); } catch {}
        location.reload();
      }
    })
    .catch(() => {}); // offline: keep the cached version
}
