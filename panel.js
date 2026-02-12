(() => {
  const ROUTE_RESET_STORAGE_KEY = 'cosmic-eye.route-reset-enabled';

  // ─── State ───
  const rdrLogs = [];
  const rtLogs = [];
  let activeTab = 'rdr';
  let routeResetEnabled = false;
  let currentDetailEntry = null;
  let copyResetTimer = null;

  // ─── Elements ───
  const $ = (id) => document.getElementById(id);

  const els = {
    appVersion: $('appVersion'),
    connStatus: $('connStatus'),
    btnClear: $('btnClear'),
    toggleRouteResetWrap: $('toggleRouteResetWrap'),
    toggleRouteReset: $('toggleRouteReset'),
    // RDR
    rdrCount: $('rdrCount'),
    rdrEndpoints: $('rdrEndpoints'),
    rdrDuplicates: $('rdrDuplicates'),
    rdrAvgDelta: $('rdrAvgDelta'),
    rdrTopEndpoint: $('rdrTopEndpoint'),
    rdrList: $('rdrList'),
    // RT
    rtCount: $('rtCount'),
    rtAvgRender: $('rtAvgRender'),
    rtAvgTti: $('rtAvgTti'),
    rtTimedOut: $('rtTimedOut'),
    rtList: $('rtList'),
    // Detail
    detailOverlay: $('detailOverlay'),
    detailTitle: $('detailTitle'),
    detailJson: $('detailJson'),
    btnCopyDetail: $('btnCopyDetail'),
    btnCloseDetail: $('btnCloseDetail'),
  };

  const setExtensionVersion = () => {
    if (!els.appVersion) return;

    try {
      const version = chrome.runtime?.getManifest?.().version;
      if (version) {
        els.appVersion.textContent = `v${version}`;
        return;
      }
    } catch (_) {
      // nothing
    }

    els.appVersion.textContent = 'v—';
  };

  const readRouteResetSetting = () => {
    try {
      const raw = localStorage.getItem(ROUTE_RESET_STORAGE_KEY);
      if (raw === '1') return true;
      if (raw === '0') return false;
    } catch (_) {
      // nothing
    }
    return null;
  };

  const writeRouteResetSetting = (enabled) => {
    try {
      localStorage.setItem(ROUTE_RESET_STORAGE_KEY, enabled ? '1' : '0');
    } catch (_) {
      // nothing
    }
  };

  // Keep runtime flag and checkbox in sync across panel reloads/reopens.
  const storedRouteResetEnabled = readRouteResetSetting();
  if (storedRouteResetEnabled === null) {
    routeResetEnabled = Boolean(els.toggleRouteReset?.checked);
  } else {
    routeResetEnabled = storedRouteResetEnabled;
    if (els.toggleRouteReset) {
      els.toggleRouteReset.checked = storedRouteResetEnabled;
    }
  }

  setExtensionVersion();

  // ─── Helpers ───
  const fmtMs = (ms) => {
    if (ms == null) return '—';
    if (ms < 1) return '<1ms';
    return Math.round(ms) + 'ms';
  };

  const safeStringify = (value) => {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'bigint') return val.toString() + 'n';
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }, 2);
  };

  const escapeHtml = (t) =>
    String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const highlightJson = (value) => {
    const escaped = escapeHtml(safeStringify(value));
    const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;
    return escaped.replace(re, (m) => {
      let cls = 'json-number';
      if (m[0] === '"') cls = /":\s*$/.test(m) ? 'json-key' : 'json-string';
      else if (m === 'true' || m === 'false') cls = 'json-boolean';
      else if (m === 'null') cls = 'json-null';
      return '<span class="' + cls + '">' + m + '</span>';
    });
  };

  // ─── RDR rendering ───
  const updateRdrSummary = () => {
    els.rdrCount.textContent = rdrLogs.length;
    els.rdrDuplicates.textContent = rdrLogs.length;

    const endpoints = new Set(rdrLogs.map((l) => l.endpoint));
    els.rdrEndpoints.textContent = endpoints.size;

    if (rdrLogs.length > 0) {
      const sum = rdrLogs.reduce((acc, l) => acc + (l.deltaMs || 0), 0);
      els.rdrAvgDelta.textContent = Math.round(sum / rdrLogs.length) + 'ms';
    } else {
      els.rdrAvgDelta.textContent = '—';
    }

    const freq = {};
    rdrLogs.forEach((l) => { freq[l.endpoint] = (freq[l.endpoint] || 0) + 1; });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);

    if (sorted.length > 0) {
      els.rdrTopEndpoint.textContent = sorted[0][0];
      els.rdrTopEndpoint.title = sorted[0][0] + ' (' + sorted[0][1] + ')';
    } else {
      els.rdrTopEndpoint.textContent = '—';
      els.rdrTopEndpoint.title = '';
    }
  };

  const renderRdrRow = (entry, idx) => {
    const row = document.createElement('div');
    row.className = 'ce-row';
    row.dataset.idx = idx;

    const actionText = entry.lastAction
      ? entry.lastAction.type + (entry.lastAction.rum_id ? ' → ' + entry.lastAction.rum_id : '')
      : '—';
    const envText = entry.env?.visibility || '—';

    row.innerHTML =
      '<div class="ce-row__delta">' + fmtMs(entry.deltaMs) + '</div>' +
      '<div class="ce-row__endpoint" title="' + escapeHtml(entry.endpoint) + '">' + escapeHtml(entry.endpoint) + '</div>' +
      '<div class="ce-row__meta" title="' + escapeHtml(actionText) + '">' + escapeHtml(actionText) + '</div>' +
      '<div class="ce-row__env">' + escapeHtml(envText) + '</div>' +
      '<div class="ce-row__idx">#' + (idx + 1) + '</div>';

    row.addEventListener('click', () => showDetail(entry, entry.endpoint));
    return row;
  };

  const renderRdrList = () => {
    els.rdrList.innerHTML = '';
    if (rdrLogs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ce-empty';
      empty.textContent = 'No duplicate requests';
      els.rdrList.appendChild(empty);
      return;
    }
    for (let i = rdrLogs.length - 1; i >= 0; i--) {
      els.rdrList.appendChild(renderRdrRow(rdrLogs[i], i));
    }
  };

  const addRdrRow = (entry) => {
    const emptyEl = els.rdrList.querySelector('.ce-empty');
    if (emptyEl) emptyEl.remove();
    els.rdrList.insertBefore(renderRdrRow(entry, rdrLogs.length - 1), els.rdrList.firstChild);
  };

  // ─── RT rendering ───
  const updateRtSummary = () => {
    els.rtCount.textContent = rtLogs.length;

    const rendered = rtLogs.filter((l) => l.routeRenderMs != null);
    const withTti = rtLogs.filter((l) => l.routeTtiMs != null);
    const timedOut = rtLogs.filter((l) => l.timedOut);

    if (rendered.length > 0) {
      const sum = rendered.reduce((acc, l) => acc + l.routeRenderMs, 0);
      els.rtAvgRender.textContent = Math.round(sum / rendered.length) + 'ms';
    } else {
      els.rtAvgRender.textContent = '—';
    }

    if (withTti.length > 0) {
      const sum = withTti.reduce((acc, l) => acc + l.routeTtiMs, 0);
      els.rtAvgTti.textContent = Math.round(sum / withTti.length) + 'ms';
    } else {
      els.rtAvgTti.textContent = '—';
    }

    els.rtTimedOut.textContent = timedOut.length;
  };

  const renderRtRow = (entry, idx) => {
    const row = document.createElement('div');
    row.className = 'ce-row';
    row.dataset.idx = idx;

    const routeName = entry.routeName || '—';
    const renderMs = fmtMs(entry.routeRenderMs);
    const ttiMs = fmtMs(entry.routeTtiMs);
    const badge = entry.timedOut ? '<span class="ce-badge ce-badge--warn">timeout</span>'
                : entry.aborted ? '<span class="ce-badge ce-badge--abort">aborted</span>'
                : '';

    row.innerHTML =
      '<div class="ce-row__delta">' + renderMs + '</div>' +
      '<div class="ce-row__endpoint" title="' + escapeHtml(routeName) + '">' + escapeHtml(routeName) + '</div>' +
      '<div class="ce-row__meta">TTI: ' + ttiMs + '</div>' +
      '<div class="ce-row__env">' + badge + '</div>' +
      '<div class="ce-row__idx">#' + (idx + 1) + '</div>';

    row.addEventListener('click', () => showDetail(entry, routeName));
    return row;
  };

  const renderRtList = () => {
    els.rtList.innerHTML = '';
    if (rtLogs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ce-empty';
      empty.textContent = 'No route transitions';
      els.rtList.appendChild(empty);
      return;
    }
    for (let i = rtLogs.length - 1; i >= 0; i--) {
      els.rtList.appendChild(renderRtRow(rtLogs[i], i));
    }
  };

  const addRtRow = (entry) => {
    const emptyEl = els.rtList.querySelector('.ce-empty');
    if (emptyEl) emptyEl.remove();
    els.rtList.insertBefore(renderRtRow(entry, rtLogs.length - 1), els.rtList.firstChild);
  };

  // ─── Detail overlay ───
  const showDetail = (entry, title) => {
    els.detailTitle.textContent = title || 'Detail';
    currentDetailEntry = entry;
    try {
      els.detailJson.innerHTML = highlightJson(entry);
    } catch (_) {
      els.detailJson.textContent = 'Serialization error';
    }
    if (els.btnCopyDetail) els.btnCopyDetail.textContent = 'Copy';
    els.detailOverlay.classList.add('is-open');
  };

  const hideDetail = () => {
    els.detailOverlay.classList.remove('is-open');
    currentDetailEntry = null;
  };

  // ─── Clear ───
  const clearRdr = () => {
    rdrLogs.length = 0;
    updateRdrSummary();
    renderRdrList();
  };

  const clearRt = () => {
    rtLogs.length = 0;
    updateRtSummary();
    renderRtList();
  };

  const clearAll = () => {
    if (activeTab === 'rdr') {
      clearRdr();
    } else {
      clearRt();
    }
  };

  const clearBoth = () => {
    clearRdr();
    clearRt();
  };

  // ─── Connection status ───
  const setConnectionStatus = (isOnline) => {
    if (!els.connStatus) return;
    if (isOnline) {
      els.connStatus.textContent = 'Connected';
      els.connStatus.classList.remove('ce-status--offline');
      els.connStatus.classList.add('ce-status--online');
    } else {
      els.connStatus.textContent = 'Disconnected';
      els.connStatus.classList.remove('ce-status--online');
      els.connStatus.classList.add('ce-status--offline');
    }
  };

  // ─── Copy ───
  const fallbackCopy = (text) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  };

  const copyDetail = async () => {
    if (!currentDetailEntry) return;
    let text = '';
    try { text = safeStringify(currentDetailEntry) || ''; } catch (_) { text = ''; }

    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); copied = true; } catch (_) {}
    }
    if (!copied) copied = fallbackCopy(text);

    if (els.btnCopyDetail) {
      els.btnCopyDetail.textContent = copied ? 'Copied!' : 'Error';
      if (copyResetTimer) clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => {
        els.btnCopyDetail.textContent = 'Copy';
        copyResetTimer = null;
      }, 1500);
    }
  };

  // ─── Tabs ───
  const switchTab = (tabName) => {
    activeTab = tabName;
    document.querySelectorAll('.ce-tab').forEach((t) => {
      t.classList.toggle('ce-tab--active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.ce-tab-content').forEach((c) => {
      c.classList.toggle('ce-tab-content--active', c.id === 'tab-' + tabName);
    });

    if (els.toggleRouteResetWrap) {
      els.toggleRouteResetWrap.hidden = tabName !== 'rdr';
    }
  };

  document.querySelectorAll('.ce-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // ─── Event listeners ───
  els.btnClear.addEventListener('click', clearAll);
  els.btnCloseDetail.addEventListener('click', hideDetail);
  if (els.btnCopyDetail) els.btnCopyDetail.addEventListener('click', copyDetail);

  els.detailOverlay.addEventListener('click', (e) => {
    if (e.target === els.detailOverlay) hideDetail();
  });

  els.toggleRouteReset.addEventListener('change', (e) => {
    routeResetEnabled = e.target.checked;
    writeRouteResetSetting(routeResetEnabled);
  });

  // ─── Message handling ───
  // Library dispatches CustomEvent(name, { detail: { type, data } }).
  // content.js forwards: { source: 'rdr'|'rt', type, data }.
  const handleMessage = (msg) => {
    if (msg.source === 'rdr') {
      const payload = msg.data;

      // type='log' — single duplicate entry
      if (msg.type === 'log' && payload) {
        rdrLogs.push(payload);
        addRdrRow(payload);
        updateRdrSummary();
      }

      // type='flush' — used here only as route-reset signal from app code
      if (
        msg.type === 'flush'
        && routeResetEnabled
        && payload?.trigger === 'route-change'
      ) {
        clearRdr();
      }
      return;
    }

    if (msg.source === 'rt') {
      const payload = msg.data;

      // RT payload is { type: 'transition'|'abort', entry: RTLogEntry }
      const entry = payload?.entry || payload;
      if (entry) {
        // Copy abort/timedOut flags from entry fields
        rtLogs.push(entry);
        addRtRow(entry);
        updateRtSummary();
      }
      return;
    }

    // Legacy format (old __RDR_LOG__ custom event)
    if (msg.type === 'log' && msg.data) {
      rdrLogs.push(msg.data);
      addRdrRow(msg.data);
      updateRdrSummary();
    }
    if (msg.type === 'reset' && routeResetEnabled) {
      clearRdr();
    }
  };

  // ─── Connection (with reconnect) ───
  let port = null;
  let reconnectTimer = null;

  const connectPort = () => {
    if (port) return;

    try {
      port = chrome.runtime.connect({ name: 'cosmic-eye-panel' });
    } catch (_) {
      port = null;
    }

    if (!port) {
      setConnectionStatus(false);
      console.warn('[CosmicEye] Panel connect failed, retrying...');
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connectPort(); }, 1000);
      }
      return;
    }

    port.postMessage({
      type: 'panel-init',
      tabId: chrome.devtools.inspectedWindow.tabId,
    });

    port.onMessage.addListener(handleMessage);
    setConnectionStatus(true);
    console.info('[CosmicEye] Panel connected');

    port.onDisconnect.addListener(() => {
      port = null;
      setConnectionStatus(false);
      console.warn('[CosmicEye] Panel disconnected, retrying...');
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connectPort(); }, 1000);
      }
    });
  };

  connectPort();
  switchTab(activeTab);

  // ─── Initial render ───
  updateRdrSummary();
  renderRdrList();
  updateRtSummary();
  renderRtList();

  // ─── External API ───
  window.__COSMIC_EYE_PANEL__ = {
    clearRdr,
    clearRt,
    clearAll: clearBoth,
    getRdrLogs: () => rdrLogs.slice(),
    getRtLogs: () => rtLogs.slice(),
  };
})();
