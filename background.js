const connections = {};

const postRouteReset = (tabId, reason) => {
  const panelPort = connections[tabId];
  if (!panelPort) return;

  try {
    panelPort.postMessage({
      tabId,
      source: 'rdr',
      type: 'flush',
      data: {
        trigger: 'route-change',
        meta: { source: 'browser', reason },
      },
    });
  } catch (_) {
    delete connections[tabId];
  }
};

const setConnection = (tabId, port) => {
  if (tabId == null) return;

  if (port._ceTabId && connections[port._ceTabId] === port) {
    delete connections[port._ceTabId];
  }

  port._ceTabId = tabId;
  connections[tabId] = port;
};

const clearConnection = (port) => {
  const tabId = port._ceTabId;
  if (tabId != null && connections[tabId] === port) {
    delete connections[tabId];
  }
};

// Browser-level signal: full tab reload/navigation started.
// Panel applies this only when "Clear on route" toggle is enabled.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') {
    return;
  }

  postRouteReset(tabId, changeInfo.url ? 'navigation' : 'reload');
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'cosmic-eye-panel') {
    port.onMessage.addListener((msg) => {
      if (msg.type === 'panel-init') {
        setConnection(msg.tabId, port);
      }
    });

    port.onDisconnect.addListener(() => {
      clearConnection(port);
    });
  }

  if (port.name === 'cosmic-eye-content') {
    port.onMessage.addListener((msg) => {
      const tabId = port.sender?.tab?.id;
      const panelPort = connections[tabId];

      if (!panelPort) return;

      try {
        panelPort.postMessage({ tabId, ...msg });
      } catch (_) {
        delete connections[tabId];
      }
    });
  }
});
