(() => {
  const RDR_EVENT = 'rdr';
  const RT_EVENT = 'rt';
  let port = null;

  const getPort = () => {
    if (port) return port;

    try {
      port = chrome.runtime.connect({ name: 'cosmic-eye-content' });
      port.onDisconnect.addListener(() => { port = null; });
    } catch (_) {
      port = null;
    }

    return port;
  };

  const forward = (source, e) => {
    const p = getPort();
    if (p && e.detail) {
      try {
        p.postMessage({ source, ...e.detail });
      } catch (_) {
        port = null;
      }
    }
  };

  window.addEventListener(RDR_EVENT, (e) => forward('rdr', e));
  window.addEventListener(RT_EVENT, (e) => forward('rt', e));
})();
