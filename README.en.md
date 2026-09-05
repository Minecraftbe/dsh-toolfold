# dsh-toolfold · Tool Call Folding

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

English | [中文](README.md)

> A DSH Web GUI plugin that provides a **simple tool call collapsing**: consecutive **tool calls** are collapsed into a single compact bar showing only a one‑line summary of the last call. Click to expand/collapse.  
> It does not replace any built‑in renderer, and uninstallation restores the UI completely.

![Demo folding effect](assets/demo-fold.gif)

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Default Behaviour – First Use](#default-behaviour--first-use)
- [Features](#features)
- [Settings](#settings)
  - [Options](#options)
  - [Storage Location](#storage-location)
- [Performance](#performance)
- [Limitations & Compatibility](#limitations--compatibility)

---

## Installation

### Recommended (via npm)

```sh
dsh plugin --profile web add dsh-toolfold
```

### Alternative Methods

```sh
# From GitHub
dsh plugin --profile web add github:Minecraftbe/dsh-toolfold

# From source
git clone https://github.com/Minecraftbe/dsh-toolfold.git
dsh plugin --profile web add ./dsh-toolfold
```

After installation, **restart dsh and refresh your browser** – the plugin will be active. You can verify that it is included in the final bundle with:

```sh
dsh --profile web --dump-config
```

### Uninstallation

```sh
dsh plugin --profile web remove dsh-toolfold
```

After restart, the interface returns to its original state.

---

## Quick Start

Once installed, consecutive tool calls are automatically folded into a single bar in any DSH conversation.

- **Click the fold bar** to expand or collapse the tool‑call cards (keyboard `Enter` / `Space` also work)
- **The bar shows**: a one‑line summary of the last call plus the label “N tool calls folded · click to expand”

![Expand/collapse animation](assets/expand-collapse.gif)

---

## Default Behaviour – First Use

The plugin works immediately after installation, but you might notice two things that seem “unexpected” at first. Both are intentional defaults and can be changed easily.

### ❓ Why did my thinking content disappear?

**Reason**: “Keep thinking” is off by default (`keepThink: false`). Completed thinking blocks are hidden to keep the conversation cleaner.

**How to restore**: go to `Settings → Plugins → Tool Fold` and turn on **“Keep thinking”**.

### ❓ Why are my tool calls split into two separate fold bars?

**Reason**: “Split thinking across call groups” is on by default (`splitThink: true`). The plugin treats a completed thinking block as a logical separator, folding calls before and after it independently.

**How to merge them**: go to `Settings → Plugins → Tool Fold` and turn off **“Split thinking across call groups”**.

> Ongoing (streaming) thinking is always visible regardless of these settings, and will only be processed according to the rules once it finishes.

---

## Features

### Core Folding Behaviour

- **Automatic folding of consecutive tool calls** – adjacent tool calls are collapsed into one bar, showing only the last call’s summary line and the number of folded items.
- **Thinking splits call groups (enabled by default)** – a completed thinking block separates the tool calls before and after it into two independent fold bars; they are never merged across a thinking block.
- **Thinking hidden by default, can be kept** – completed thinking is hidden to save space; when “Keep thinking” is enabled, thinking appears between fold bars (in split mode) or interpolated back between calls on expansion (in merged mode).
- **Ongoing thinking always visible** – streaming thinking remains visible until it finishes, then follows the above rules.

### Animation & Experience

- **Spring‑loaded waterfall animation** – cards drop one by one on expand (with spring bounce), and on collapse they rise while heights shrink synchronously, so content below moves continuously without jumping.
- **Sticks to the bottom without pushing out** – when expanding near the bottom, the fold bar’s viewport position is pinned so that automatic scrolling does not push it off screen.
- **Respects system preferences** – if the system has “Reduce motion” enabled, animations are automatically disabled.

### Performance & Resource Usage

- **Near‑zero performance impact** – no page‑wide observers, zero engine work during streaming, and all activity is paused when the tab is hidden. Measured idle overhead is about 0.03% of a single CPU core.
- **Optional real‑time stats** – enable “Performance stats” in the settings card to see per‑step timings and verify overhead.

---

## Settings

Settings are found at: **Settings → Plugins → Tool Fold** (the card looks like other built‑in plugin cards and follows the light/dark theme).

![Settings card](assets/settings.png)

### Options

| Option | Description |
| --- | --- |
| **Expand animation duration** | Duration of the expand/collapse animation per card (0–1000 ms, default 240 ms; 0 = instant) |
| **Keep thinking** | Hide completed thinking by default; when enabled, thinking is shown – between fold bars in split mode, or interpolated back between calls on expansion in merged mode |
| **Split thinking across call groups** | Enabled by default: a completed thinking block separates tool calls before and after it into independent fold bars. Disabled: thinking is folded together with the surrounding call group (legacy behaviour) |
| **Performance stats** | Show real‑time plugin timing in the card (cumulative count and ms/s for observation callbacks, engine refresh, merge recalculation, safe rescan, summary cloning, plus the number of streaming batches short‑circuited with zero overhead) |

---

### Storage Location

Plugin settings are persisted automatically, with the following priority:

- **Primary (installed/bundle mode)** – stored via the DSH **settings service** in `~/.dsh/settings.yaml` (namespace `toolfold`). They follow the dsh host, so they persist across browsers/devices. You can also edit the file manually:

  ```yaml
  toolfold:
    durMs: 240        # expand animation duration 0–2000 ms
    keepThink: false  # whether to keep completed thinking visible
    splitThink: true  # whether to split call groups by thinking
    stats: false      # whether to enable performance stats
  ```

- **Fallback (when settings service is unavailable)** – falls back to browser `localStorage` (key `dsh-toolfold.settings.v1`), so settings are only kept in that browser. The old key `dsh-codex-collapse.settings.v1` is automatically migrated on first load.

The settings card shows the current storage method (“Settings saved in DSH host config” or “Saved only in this browser”).

---

## Performance

- **Measured on a real GUI page (8 s idle window)** – total engine time ~1.6–2.8 ms (~0.3 ms/s, ~0.03% single‑core); during a 5‑s CPU profile, engine functions appeared zero times.
- **Zero work during streaming** – streaming thinking/text tokens are short‑circuited with O(1) checks and do not trigger any recalculation (~0.1–0.4 µs per node).
- **Hidden tab = literally zero** – all observers and timers are disconnected when the tab is hidden; they are re‑attached and a single reconciliation run is performed when the tab becomes visible again.
- Enable **“Performance stats”** in the settings card to see detailed timings for every plugin operation.

---

## Limitations & Compatibility

- **DOM‑based** – folding relies on stable product DOM markers. If markers change, the worst case is that folding stops working – it will not break the chat.
- **Splitting rules**:
  - Ongoing thinking and plain text output separate tool call groups.
  - Completed thinking also separates groups by default (when “Split thinking across call groups” is on); when off, thinking is folded together with its surrounding call group.
- **State memory** – expand/collapse state is remembered per conversation flow and node key; re‑opening a conversation with the same key restores the state.
- **Browser requirements** – needs `MutationObserver` and `requestAnimationFrame`. If unsupported, it falls back to “fold once on initial render”.
- **Settings storage** – uses the DSH host config (`~/.dsh/settings.yaml`) when available; only falls back to `localStorage` when the host bridge is unreachable (in which case settings are browser‑local only).

---

> This project is entirely built with dsh + deepseek v4 flash(max).
