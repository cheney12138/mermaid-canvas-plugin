# Mermaid Canvas

An Obsidian plugin that turns every `mermaid` code block into an interactive canvas — zoom, pan, fullscreen, copy, delete, and a built-in split editor. No more squinting at cramped diagrams.

## Features

- **Adaptive canvas** — SVG renders at natural size, fills available width, no hardcoded constraints
- **Smooth zoom & pan** — scroll wheel (or pinch) to zoom toward cursor, drag to pan, stepless and precise
- **Control bar** — hover to reveal Zoom In / Zoom Out / Fullscreen / Fit to Canvas / Copy / Delete
- **Fullscreen mode** — expand any diagram to fill the viewport, Esc to exit
- **Fit to canvas** — one click to auto-scale the diagram to fit the available space
- **Copy code** — copy the raw mermaid source (without ` ```mermaid` fences) to clipboard
- **Delete block** — remove the entire code block with one click
- **Inline editor** — type `/mermaid` to insert a code block and open a split-view editor (code left, preview right)
- **Edit interception** — click Obsidian's native edit button on any mermaid block to open the split editor, pre-loaded with the correct code
- **Error resilience** — invalid or empty blocks are gracefully skipped; no spammy error messages

## Usage

| Action | How |
|--------|-----|
| Insert + edit | `/mermaid` slash command in the editor |
| Edit existing | Click the ✏️ edit button on any rendered mermaid block |
| Zoom | `Ctrl/Cmd` + scroll wheel (or two-finger pinch on trackpad) |
| Pan | Click and drag the diagram |
| Fullscreen | Hover → click Maximize button, Esc to exit |
| Copy code | Hover → click Copy button |
| Delete block | Hover → click Trash button |

## Installation

### Manual

1. Download the latest `main.js`, `styles.css`, and `manifest.json` from [Releases](https://github.com/cheney12138/mermaid-canvas-plugin/releases)
2. Copy them into `your-vault/.obsidian/plugins/mermaid-canvas/`
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

### From Source

```bash
git clone https://github.com/cheney12138/mermaid-canvas-plugin.git
cd mermaid-canvas-plugin
npm install
npm run build
# Then copy main.js, styles.css, manifest.json to your vault's plugins folder
```

## Settings

- **Zoom sensitivity** (1–10) — how fast the scroll wheel zooms
- **Default split view** — open the code editor alongside the preview by default
- **Mermaid theme** — default, forest, dark, neutral, or base

## License

MIT
