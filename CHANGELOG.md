# Changelog

All notable changes to Smart Jingle are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-09-15

### Added
- **Fade in / fade out per jingle** (ms, editable in Edit settings) — click-free IN/OUT points.
- **Retrigger lock per jingle** — optionally blocks re-triggering a jingle while it is playing.
- **VU meter + ON-AIR indicator** in the header (16-segment LED meter with peak levels).
- **OSC server** (UDP, port 4410 by default): `/jingle/:id`, `/transport/:cmd`, `/playlist/:id`.
- **Remote PIN protection** — optional PIN for the HTTP/WS API and the web remote.
- **Companion module**: PIN config field and jingle colours applied to the generated preset buttons.
- **Global hotkeys** — F1–F12 and 0–9 work system-wide; letters use Ctrl+Alt+<key>.
- **Automatic backups** — the data file is backed up (max 5 copies) in `userData/backups`.
- **CHANGELOG.md** and CI smoke test on Windows.

### Changed
- Companion module display name: `SMART-JINGLE - by Nelson Teixeira`.
- Repository renamed to `Smart-Jingle`.

## [0.2.0] - 2026-09-14

### Added
- QLab-style transport buttons, TIME REMAINING box (black bg, white text).
- i18n: EN / PT / FR (Settings → Language).
- Jingle IDs (J1, J2, …), grid/rows views, cart sizes S/M/L, search.
- Drag & drop reorder, per-jingle loop/once mode, playlist loop, master volume,
  output device selection (Dante DVS auto-detected), dB gain per jingle.
- Project save/open (.smartjingle), GitHub update checker, README screenshots.

### Changed
- Proprietary license (All rights reserved — Nelson Teixeira, Smartchoice@2026).

## [0.1.1] - 2026-09-14

### Added
- Bundled default jingles (SWEEPER, TRANSITION, BED MUSIC) seeded on first run.
- macOS ad-hoc signing, larger branding.

## [0.1.0] - 2026-09-14

### Added
- Initial release: QCart grid, waveform bar, IN/OUT editing, playlists,
  GO/PAUSE/RESET/STOP ALL transport, HTTP + WebSocket remote API, web remote,
  Bitfocus Companion module, Windows (.exe/.msi) and macOS (.dmg) installers.
