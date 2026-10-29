# Tidy

[한국어](../README.md) · [English](README.en.md)

Window tiling for GNOME

Drag a window to the top of a monitor, choose a layout, and move between monitors with keyboard shortcuts.
Tidy brings familiar ideas from Windows Snap Layouts and macOS Magnet to Ubuntu GNOME.

![GNOME](https://img.shields.io/badge/GNOME-46%E2%80%9350-4a86cf)
![Session](https://img.shields.io/badge/session-Wayland-555555)
![Languages](https://img.shields.io/badge/languages-KO%20%7C%20EN-555555)
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

Runtime requirements: system Python 3 with PyGObject, GJS, GTK 4/libadwaita, and `glib-compile-schemas`. The installer builds and installs the extension. Node.js is used only for development checks.

## Install

Download the repository and install it:

```bash
git clone https://github.com/hojin-v/Tidy.git
cd Tidy
/usr/bin/python3 scripts/manage.py install
```

Alternatively, use [Download ZIP](https://github.com/hojin-v/Tidy/archive/refs/heads/main.zip), extract it, and run the last command from that folder. Installation runs under your user account.

**Log out and back in after the first installation.** Tidy activates automatically. Open its settings from **Tidy** in the application list or the grid icon in the top panel.

All runtime tools are copied into the installation. **You can delete the downloaded ZIP and source folder after installation succeeds**, even before the first logout/login.

## Quick Start

1. Drag a window by its title bar to the top center of a monitor.
2. Move the pointer onto the desired layout cell.
3. Release to tile the window. Release over empty space to cancel.

Press **Super** to open the native window/app overview and the layout picker together. Drag a window preview into a cell, or click a cell to place the previously focused window. Search appears when you type.

With snap assist enabled, select an app icon in an empty region to tile its window there. Click the current window or another area, or press Esc, to finish without any additional placements.

## Shortcuts

Placement shortcuts consistently use **Super+Alt**. Change them in the **Shortcuts** tab.

| Shortcut | Action |
| --- | --- |
| Super | Open / close GNOME's overview and the layout picker |
| Super + A | Toggle GNOME's application grid |
| Super + Alt + ← / → | Tile to the left / right half; repeat to move to the monitor in that direction |
| Super + Alt + ↑ / ↓ | Tile to the top / bottom half |
| Super + Alt + Enter | Maximize / restore the previous size and placement |
| Super + Alt + U / I / J / K | Top-left / top-right / bottom-left / bottom-right quarter |
| Super + Alt + D / F / G | Left / center / right third |
| Super + Alt + E / T | Left / right two-thirds |
| Super + Alt + C | Centered three-quarter size |
| Super + Alt + Space | Open the layout picker |
| Super + Alt + N | Move to the next monitor |

## Settings

Open **Tidy** from the application list, or choose **Settings and shortcuts…** from the top-panel grid icon. Changes take effect immediately.

- **Disable native Super+arrow tiling** disables GNOME's original tiling shortcuts. Turning it off or disabling Tidy restores them.
- **Adapt picker size to each monitor** keeps the built-in display as the baseline and gently enlarges the picker on larger external displays. Enabled by default.
- **Layout picker size / Overview picker size** default to equal sizes. The overview picker has its own relative size setting.
- **Choose windows for the remaining space** shows running app icons in empty layout regions. Disabled by default.

You can also open settings or check status using the installed management tool. The source folder is not needed:

```bash
tidy_manager="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/winubun@winubun.local/scripts/manage.py"
/usr/bin/python3 "$tidy_manager" prefs
/usr/bin/python3 "$tidy_manager" status
```

## Update

Download the new source and run the installer again. If you kept your checkout:

```bash
git pull --ff-only
/usr/bin/python3 scripts/manage.py install
```

Log out and back in when the extension code version changes. GNOME caches JavaScript for the session, so toggling the extension does not reload it. Existing settings and shortcuts are preserved.

## Uninstall

Run this command from any directory:

```bash
/usr/bin/python3 "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/winubun@winubun.local/scripts/manage.py" uninstall
```

This removes the extension and application launcher and restores the GNOME settings and competing tiling-extension state that Tidy changed. Tidy's custom settings and shortcuts are kept for reinstallation.

The `winubun` path is a stable internal name retained for compatibility with existing settings and pinned launchers.

## Notes

- If **Ubuntu Tiling Assistant** is enabled, the installer records its state and disables it. `uninstall` restores it. Disabling only Tidy in GNOME's extension manager leaves Tiling Assistant disabled.
- Application minimum sizes and terminal resize increments can prevent an exact fit. Fullscreen windows and windows that disallow movement or resizing are excluded.
- When reporting a problem in [Issues](https://github.com/hojin-v/Tidy/issues), include your GNOME version, Wayland/X11 session, monitor arrangement and reproduction steps.

See [Development](DEVELOPMENT.md) for development commands, test coverage and diagnostic paths.

## License

Copyright © 2026 hojin-v. Distributed under **GNU GPL v3.0 or later**.

See [LICENSE](../LICENSE) for the full terms and [NOTICE](../NOTICE) for the project notice.
