# CosmicEye — Chrome DevTools Extension

Chrome DevTools panel for monitoring [CosmicEye](https://github.com/jayonez1/CosmicEye/) events in real time.

Two tabs:

- **RDR** — duplicate API request detection (endpoints, delta, frequency)
- **RT** — route transition metrics (render time, TTI, timeouts)

## Requirements

- Chrome 88+
- Website must use `cosmic-eye` library with `chromeExtensionEvents` enabled

## Setup in your app

```ts
import { initRDR, initRT } from 'cosmic-eye';

initRDR({
  chromeExtensionEvents: true,
  // ...other options
});

initRT({
  chromeExtensionEvents: true,
  // ...other options
});
```

## Install (unpacked)

1. Clone or download this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the repository root folder
5. Open DevTools on any matching page → **CosmicEye** tab appears

## Features

| Feature | Description |
|---------|-------------|
| RDR tab | Live list of duplicate requests with delta, endpoint, action context |
| RT tab | Route transitions with render time, TTI, timeout/abort badges |
| Summary cards | Aggregate stats per tab (endpoints, avg delta, avg render, etc.) |
| Detail overlay | Click any row to inspect full JSON payload, copy to clipboard |
| Connection status | Green/red indicator showing extension ↔ page link |
| Clear on route | Toggle to auto-clear RDR logs on `route-change` signals and full page reload |
| Reconnect | Auto-reconnects if DevTools panel is reopened |

## Cookbook: Make `Clear on route` work

`Clear on route` in DevTools panel reacts only to `rdr.flush()` with trigger `route-change`.
Other flush triggers are ignored by the panel reset logic.
Additionally, on full page reload the extension sends a browser-level `route-change` reset signal automatically.

```ts
import { createBrowserHistory } from 'history';
import { initRDR, observeHistory, rdr } from 'cosmic-eye';

const history = createBrowserHistory();
const observer = observeHistory(history);
let prevPathname: string | null = null;

const ok = initRDR({
  chromeExtensionEvents: true,
});

if (ok) {
  observer.subscribe(({ action, pathname }) => {
    if (action === 'INIT' || pathname !== prevPathname) {
      prevPathname = pathname;
      rdr.flush('route-change');
    }
  });
}
```

## File structure

```
.
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — routes messages between panel & content
├── content.js         # Injected into pages — listens for rdr/rt CustomEvents
├── devtools.html      # DevTools entry point
├── devtools.js        # Creates the CosmicEye panel
├── panel.html         # Panel UI (two tabs)
├── panel.js           # Panel logic (state, rendering, connection)
├── panel.css          # Dark theme styles
└── README.md
```

## License

Internal tool — same license as the parent CosmicEye library.
