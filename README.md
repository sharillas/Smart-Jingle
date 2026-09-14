# Smart Jingle

QCart jingle player for radio, broadcast and live events — launch jingles like hot cues,
edit IN/OUT points on a waveform, organise files in playlist groups, and control everything
remotely from a tablet, another PC or a Bitfocus Companion surface.

> All rights Reserved - Smartchoice@2026 - Copyright @ developed by Nelson Teixeira

## Features

- **QCart buttons** — click a cart to launch the jingle instantly (hot-start, polyphonic).
- **Waveform bar** — live waveform overview of the selected jingle with playhead.
- **IN / OUT editing** — drag green/red markers on the waveform, type exact seconds or
  use *Set IN/OUT at playhead* while previewing. Playback always respects the points.
- **Playlist groups** — organise jingles in multiple playlists (groups), drag & drop audio
  files, duplicate, rename, per-cart colours.
- **Transport** — GO (relaunch selected jingle), PAUSE/RESUME, RESET, STOP ALL.
- **Remote server (API)** — built-in HTTP + WebSocket server: trigger jingles from an iPad,
  tablet or any PC. A ready-to-use web remote is served at `http://<host>:4405`.
- **Bitfocus Companion module** — `Smart-Jingle : by Nelson Teixeira` (`.tgz`) with preset
  buttons generated from the jingles configured in the GUI, plus GO/RESET/PAUSE/STOP ALL.
- **Modern dark UI** — blue / dark-grey template.
- Installers for **Windows (.exe / .msi)** and **macOS (.dmg)**.

## Download & install

Get the latest installers from
[Releases](https://github.com/sharillas/smart-jingle/releases):

- Windows: `Smart.Jingle.Setup.<version>.exe` (or `.msi`)
- macOS: `Smart.Jingle-<version>-universal.dmg`
- Companion: `smart-jingle-<version>.tgz`

On first start the app creates a **Default Jingles** playlist with 3 built-in
jingles (SWEEPER, TRANSITION, BED MUSIC) so you can try everything immediately.

### macOS Gatekeeper warning

The DMG is ad-hoc signed but not notarized yet (notarization requires an Apple
Developer ID). On first open macOS may show *"cannot be opened because Apple
cannot check it for malicious software"* — this is normal for open-source
unsigned apps. Bypass it once:

1. Right-click the app icon and choose **Open** → confirm **Open**,
   or run `xattr -cr "/Applications/Smart Jingle.app"` in Terminal.

To remove the warning entirely, build with a Developer ID and notarization
(see "Building releases" below).

## Remote API

| Method | Path | Action |
| ------ | ---- | ------ |
| GET  | `/api/state` | Full state (jingles, playlists, playing, transport) |
| GET  | `/api/info` | App info |
| POST | `/api/jingles/:id/play` | Launch jingle cart |
| POST | `/api/jingles/:id/stop` | Stop jingle cart |
| POST | `/api/transport/go` | GO — launch selected jingle |
| POST | `/api/transport/pause` | PAUSE / RESUME all |
| POST | `/api/transport/reset` | RESET — stop all + clear selection |
| POST | `/api/transport/stop-all` | STOP ALL |
| POST | `/api/playlists/:id/activate` | Switch active playlist |
| WS   | `/ws` | Live state push (JSON `{type:"state", payload}`) |

Web remote (tablet friendly): `http://<host-ip>:4405/`

Default port: **4405** (change in *Settings*; restart required).

## Companion module

In Companion: *Settings → Modules → Import module* and pick `smart-jingle-<version>.tgz`.
Add a connection with the Smart Jingle machine IP and port 4405. Presets are generated
automatically from the jingles configured in the app GUI:

- `Transport (GO/PAUSE/RESET/STOP)`
- `Jingles 1-8`, `Jingles 9-16`, … (one button per jingle, green when playing, blue when selected)

Actions: Play Jingle, Stop Jingle, Transport, Select Playlist.
Feedbacks: playing, selected, paused, connected. Variables: per-jingle status, transport
state, active playlist.

## Development

```bash
npm install
npm start              # run the app
npm run dist:win       # build exe + msi
npm run dist:mac       # build dmg (on macOS)
npm run pack:companion # pack companion module into release/companion/
powershell -ExecutionPolicy Bypass -File scripts/gen-icon.ps1   # regenerate icons
```

Data (playlists/jingles/settings) is stored in `smart-jingle-data.json` in the OS
user-data folder (File → Reveal Data File).

## Building releases

Push a tag `v*` (e.g. `v0.1.1`) — GitHub Actions builds the Windows and macOS
installers plus the Companion `.tgz` and attaches everything to the release.

To fully sign and notarize the macOS build (removes the Gatekeeper warning),
add these secrets to the repository and enable the commented lines in
`.github/workflows/build.yml`, then set `"hardenedRuntime": true` in `build.mac`:

- `CSC_LINK` (base64 of the Developer ID .p12) and `CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
