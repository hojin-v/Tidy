# Tidy

[한국어](../README.md) · [English](README.en.md)

Window tiling for GNOME

Drag a window to the top of a monitor, choose a layout, and move between monitors with keyboard shortcuts.
Tidy brings familiar ideas from Windows Snap Layouts and macOS Magnet to Ubuntu GNOME.

![GNOME](https://img.shields.io/badge/GNOME-46%E2%80%9350-4a86cf)
![Session](https://img.shields.io/badge/session-Wayland-555555)
![Languages](https://img.shields.io/badge/languages-KO%20%7C%20EN-555555)
[![npm](https://img.shields.io/npm/v/@hnode/tidy)](https://www.npmjs.com/package/@hnode/tidy)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-green)](../LICENSE)

[Install](#install) · [Features](#features) · [Quick Start](#quick-start) · [Shortcuts](#shortcuts) · [Uninstall](#uninstall)

## Overview

Tidy is a GNOME Shell extension for arranging windows. Its layout picker opens inside the top-center area of each monitor, making it easier to use across multiple displays.

<img src="preview.png" alt="Tidy's top layout picker with grayscale layout diagrams" width="760">

The interface follows your desktop language. Korean and English are supported; other languages fall back to English.

## Features

| Feature | Behavior |
| --- | --- |
| Top layout picker | Drop a window into a cell in one of seven layouts. |
| Edge snapping | Other top edges maximize; left and right edges tile halves. |
| Overview integration | Press Super to open GNOME's overview and the picker together, then drag a window preview onto a layout. |
| Custom shortcuts | Use Super+Alt for halves, quarters, thirds and two-thirds; customize the bindings in settings. |
| Multiple monitors | Repeat a horizontal shortcut to move to the monitor in that direction. Picker size adapts to each monitor. |
| Linked resizing | Drag shared boundaries to resize adjacent tiled windows together. Enabled by default. |
| Optional snap assist | Choose running app icons inside empty regions to fill the remaining space. Disabled by default. |
| Size and spacing | Adjust picker sizes and window gaps, including a separate overview picker size. |

## Platform Support

| Environment | Status |
| --- | --- |
| Ubuntu 26.04 · GNOME 50.1 · Wayland | Tested with real Wayland windows and two virtual monitors in an isolated GNOME session |
| GNOME 46–49 | Declared compatible; not yet tested on those versions |
| X11 | Not yet tested |
| KDE · Xfce · Windows · macOS | Outside the supported platform |

Runtime requirements: system Python 3 with PyGObject, GJS, and GTK 4/libadwaita. npm commands require Node.js 18 or later. Building from source also requires `glib-compile-schemas`. The installed GNOME extension does not run a Node.js or npm process.

## Install

### npm

The package is **`@hnode/tidy`** and the command is **`tidy`**. Once published to npm, install the package and register the GNOME extension:

```bash
npm install -g @hnode/tidy
tidy install
```

Or install without keeping a global npm package:

```bash
npx @hnode/tidy@latest install
```

Use `tidy doctor` to check system requirements and `tidy --help` to list commands. Run `tidy install` as your GNOME desktop user, without sudo. Installing the npm package alone does not change desktop settings.

**After the initial installation and logout/login, Tidy starts automatically. You do not need a terminal for daily use.** Open settings from **Tidy** in the app list or the top-panel grid icon.

### Source

You can also download the repository and install directly:

```bash
git clone https://github.com/hojin-v/Tidy.git
cd Tidy
/usr/bin/python3 scripts/manage.py install
```

Alternatively, use [Download ZIP](https://github.com/hojin-v/Tidy/archive/refs/heads/main.zip), extract it, and run the last command from that folder. Installation runs under your user account.

**Log out and back in after the first installation.** Tidy activates automatically. Open its settings from **Tidy** in the application list or the grid icon in the top panel.

All runtime tools are copied into the installation. **You can delete the downloaded ZIP, source folder and npm cache after installation succeeds**, even before the first logout/login.

## Quick Start

1. Grab a window by its title bar. A thin hint appears at the top of the monitor.
2. Drag into that area to reveal the layouts and shrink the window into a small preview. Move the pointer onto the desired layout cell.
3. Release to tile the window. Release over empty space to cancel.

Press **Super** to open the native window/app overview and the layout picker together. Drag a window preview into a cell, or click a cell to place the previously focused window. Search appears when you type.

With snap assist enabled, select an app icon in an empty region to tile its window there. Click the current window or another area, or press Esc, to finish without any additional placements.

The picker slides down using Ubuntu Dock's animation duration and curve. Leaving the selection area restores the window's size; dropping onto a cell animates directly from the miniature to its destination.

## Shortcuts

Placement shortcuts consistently use **Super+Alt**. Change them in the **Shortcuts** tab.

| Shortcut | Action |
| --- | --- |
| Super | Open / close GNOME's overview and the layout picker |
| Super + A | Toggle GNOME's application grid |
| Super + Alt + ← / → | Tile to the left / right half; repeat to move in that direction, wrapping at the outer edges |
| Super + Alt + ↑ / ↓ | Tile to the top / bottom half |
| Super + Alt + Enter | Maximize / restore the previous size and placement |
| Super + Alt + U / I / J / K | Top-left / top-right / bottom-left / bottom-right quarter |
| Super + Alt + D / F / G | Left / center / right third |
| Super + Alt + E / T | Left / right two-thirds |
| Super + Alt + C | Centered three-quarter size |
| Super + Alt + Space | Open the layout picker |
| Super + Alt + N | Move to the next monitor |

From the left half of the leftmost monitor, **Super+Alt+←** wraps to the right half of the rightmost monitor. From the right half of the rightmost monitor, **Super+Alt+→** wraps to the left half of the leftmost monitor. The window slides out through one outer edge and enters through the opposite edge. A single monitor does not wrap.

## Settings

Open **Tidy** from the application list, or choose **Settings and shortcuts…** from the top-panel grid icon. Changes take effect immediately.

- **Disable native Super+arrow tiling** disables GNOME's original tiling shortcuts. Turning it off or disabling Tidy restores them.
- **Adapt picker size to each monitor** keeps the built-in display as the baseline and gently enlarges the picker on larger external displays. Enabled by default.
- **Layout picker size / Overview picker size** default to equal sizes. The overview picker has its own relative size setting.
- **Match activation width to picker** keeps the activation area and drag hint aligned with the picker on each monitor. Enabled by default; turn it off to use your custom width.
- **Choose windows for the remaining space** shows running app icons in empty layout regions. Disabled by default.

Open settings or check status from the CLI:

```bash
tidy prefs
tidy status
```

You can also use the installed management tool directly. The source folder is not needed:

```bash
tidy_manager="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/winubun@winubun.local/scripts/manage.py"
/usr/bin/python3 "$tidy_manager" prefs
/usr/bin/python3 "$tidy_manager" status
```

## Update

Update the npm package, then apply its extension version. `tidy update` installs the version bundled with the currently installed npm package:

```bash
npm install -g @hnode/tidy@latest
tidy update
```

For npx installations, rerun `npx @hnode/tidy@latest install`. For source installations, download the latest source and rerun the installer:

```bash
git pull --ff-only
/usr/bin/python3 scripts/manage.py install
```

Log out and back in when the extension code version changes. GNOME caches JavaScript for the session, so toggling the extension does not reload it. Existing settings and shortcuts are preserved.

## Uninstall

Remove the extension first, then the npm CLI:

```bash
tidy uninstall
npm uninstall -g @hnode/tidy
```

For npx installations, use `npx @hnode/tidy@latest uninstall`. **Removing only the npm package leaves the GNOME extension installed.**

Without the CLI, run the installed tool from any directory:

```bash
/usr/bin/python3 "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/winubun@winubun.local/scripts/manage.py" uninstall
```

This removes the extension and application launcher and restores the GNOME settings and competing tiling-extension state that Tidy changed. Tidy's custom settings and shortcuts are kept for reinstallation.

The `winubun` path is a stable internal name retained for compatibility with existing settings and pinned launchers.

## Notes

- If **Ubuntu Tiling Assistant** is enabled, the installer records its state and disables it. `uninstall` restores it. Disabling only Tidy in GNOME's extension manager leaves Tiling Assistant disabled.
- Application minimum sizes and terminal resize increments can prevent an exact fit. Fullscreen windows and windows that disallow movement or resizing are excluded.
- When reporting a problem in [Issues](https://github.com/hojin-v/Tidy/issues), include your GNOME version, Wayland/X11 session, monitor arrangement and reproduction steps.

See [Development](DEVELOPMENT.md) for development commands, test coverage and diagnostic paths, and [Releasing](RELEASING.md) for npm publication.

## License

Copyright © 2026 hojin-v. Distributed under **GNU GPL v3.0 or later**.

See [LICENSE](../LICENSE) for the full terms and [NOTICE](../NOTICE) for the project notice.
