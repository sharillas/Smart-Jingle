# Smart Jingle : by Nelson Teixeira

Bitfocus Companion module for **Smart Jingle** — QCart jingle player with waveform editing,
playlist groups and a built-in remote API.

## Features

- **Play Jingle** — launch any jingle cart configured in the Smart Jingle GUI
- **Stop Jingle** — stop a running cart
- **Transport** — GO / PAUSE / RESET / STOP ALL
- **Select Playlist** — switch active playlist group
- **Feedbacks** — jingle playing (green), jingle selected (blue), paused (amber), connected
- **Variables** — per-jingle playing state, transport state, active playlist
- **Presets** — automatically generated from the jingles configured in the app:
  - `Transport (GO/PAUSE/RESET/STOP)` — 4-button transport bar
  - `Jingles 1-8`, `Jingles 9-16`, … — one button per jingle with playing/selected feedback

## Install

1. Download `smart-jingle-<version>.tgz` from the Smart Jingle GitHub release.
2. In Companion: **Settings → Modules → Import module** (tar.gz file).
3. Add a new connection, choose **Smart Jingle**, set the IP of the computer running
   Smart Jingle (default port `4405`).

## Connection

| Field | Default | Description |
| ----- | ------- | ----------- |
| Host  | 127.0.0.1 | IP of the Smart Jingle machine |
| Port  | 4405 | Remote API port (see Smart Jingle → Settings) |

## Copyright

All rights Reserved - Smartchoice@2026 - Copyright @ developed by Nelson Teixeira
