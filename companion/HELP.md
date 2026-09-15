# SMART-JINGLE - by Nelson Teixeira

Control **Smart Jingle** (QCart jingle player) from Bitfocus Companion.

## Connection settings

| Field | Default   | Description |
| ----- | --------- | ----------- |
| Host  | 127.0.0.1 | IP of the machine running Smart Jingle |
| Port  | 4405      | Smart Jingle remote API port |
| PIN   | *(empty)* | Remote PIN configured in Smart Jingle → Settings |

## Presets

Presets are generated automatically from the jingles configured in the app:

- **Transport** — GO / PAUSE / RESET / STOP ALL
- **Jingles** — one preset button per jingle (colour from the app, green while playing, blue when selected)

## Actions

- **Play Jingle** — launch a jingle cart by its Jingle ID
- **Stop Jingle** — stop a running cart
- **Transport** — GO / PAUSE / RESET / STOP ALL
- **Select Playlist** — switch active playlist group

## Feedbacks

- Jingle is playing (green)
- Jingle is selected (blue)
- Transport is paused (amber)
- Connected to Smart Jingle

## Variables

- `$(smart-jingle:j_<id>)` — per-jingle playing state
- `$(smart-jingle:paused)` — transport state
- `$(smart-jingle:playing_count)` — number of jingles playing
- `$(smart-jingle:selected)` — selected jingle name
- `$(smart-jingle:playlist)` — active playlist name

---

All rights Reserved - Smartchoice@2026 - Copyright @ developed by Nelson Teixeira
