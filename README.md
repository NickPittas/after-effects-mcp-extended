# 🎬 After Effects MCP Extended

This project is a fork of [Dakkshin/after-effects-mcp](https://github.com/Dakkshin/after-effects-mcp), focused on broader production control through a compact MCP surface.

Extended capabilities include:

- A unified `after-effects` tool for inspection, properties, keyframes, effects, masks, shape contents, text, layers, compositions, project media, rendering, and frame capture
- Recursive property-tree and keyframe inspection
- General effect lifecycle management
- Mask inspection, creation, editing, removal, and path animation
- Shape groups, primitives, paths, fills, strokes, and vector modifiers
- Point and box text with character, paragraph, range styling, and Source Text animation
- Track mattes, blending modes, precomposing, and explicit time-remap animation
- In-place single or atomic bulk layer-source replacement using existing Project-panel footage or compositions
- Batch imports, render-queue management, multiple outputs, AME dispatch, and reusable render/output templates
- Media inventory, relinking, reloading, interpretation, file/sequence/placeholder/solid proxies, dependency traversal, and missing-media reports
- Dependency manifests plus explicitly confirmed consolidation, unused-footage removal, and project reduction
- Keyframe creation, editing, removal, interpolation, and easing controls
- Layer creation, parenting, duplication, ordering, and switch management
- Project import, organization, saving, render-queue operations, and PNG frame capture
- Native text animator/selector lifecycle with character, word, and line ranges, wiggly and expression selectors, animated values, expressions, and native match-name access
- Improved bridge response tracking and direct rendered-frame image returns
- Dockable, resizable ScriptUI bridge panel
- Dockable CEP/HTML multi-CLI chat panel for Codex, Claude Code, Antigravity CLI (AGY), Kimi CLI, Pi, and OpenCode, with per-provider sessions, chronologically segmented streamed conversations, timestamped expandable tool groups, account/setup controls, viewer/UI screenshots, Stop, and autonomous mode
- Per-harness model selection, live model catalogs where supported, custom model IDs, and advertised reasoning controls
- Shared After Effects system instructions for every CLI harness, with the live operation matrix, parameter guidance, native-object rules, and verification behavior
- Standalone Windows MCP and chat executables; release users do not need Node.js or npm

![Node.js](https://img.shields.io/badge/node-%3E=14.x-brightgreen.svg)
![Build](https://img.shields.io/badge/build-passing-success)
![License](https://img.shields.io/github/license/Dakkshin/after-effects-mcp)
![Platform](https://img.shields.io/badge/platform-after%20effects-blue)

✨ A Model Context Protocol (MCP) server for Adobe After Effects that enables AI assistants and other applications to control After Effects through a standardized protocol.

<a href="https://glama.ai/mcp/servers/@Dakkshin/after-effects-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Dakkshin/after-effects-mcp/badge" alt="mcp-after-effects MCP server" />
</a>

## Table of Contents
- [Features](#features)
  - [Core Composition Features](#core-composition-features)
  - [Layer Management](#layer-management)
  - [Animation Capabilities](#animation-capabilities)
- [Setup Instructions](#setup-instructions)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Update MCP Config](#Update-MCP-Config)
  - [Running the Server](#running-the-server)
- [Usage Guide](#usage-guide)
  - [Creating Compositions](#creating-compositions)
  - [Working with Layers](#working-with-layers)
  - [Animation](#animation)
- [Available MCP Tools](#available-mcp-tools)
- [For Developers](#for-developers)
  - [Project Structure](#project-structure)
  - [Building the Project](#building-the-project)
  - [Contributing](#contributing)
- [License](#license)

## 📦 Features

### 🎥 Core Composition Features
- **Create compositions** with custom settings (size, frame rate, duration, background color)
- **List all compositions** in a project
- **Get project information** such as frame rate, dimensions, and duration

### 🧱 Layer Management
- **Create text layers** with customizable properties (font, size, color, position)
- **Create shape layers** (rectangle, ellipse, polygon, star) with colors and strokes
- **Create solid/adjustment layers** for backgrounds and effects
- **Create camera layers** with configurable zoom and position
- **Place existing footage or compositions** into a composition by project item index, ID, or name
- **Replace a layer source in place** from an existing Project-panel item while preserving the layer's effects, masks, transforms, timing, switches, and time-remap data
- **Create null objects** for animation control
- **Modify layer properties** like position, scale, rotation, opacity, timing
- **Toggle 2D/3D mode** for layers
- **Set blend modes** (normal, multiply, screen, etc.)
- **Track matte** support (alpha, luma, inverted)
- **Duplicate layers** with optional rename
- **Delete layers** from composition
- **Create/modify masks** with feather, expansion, and opacity

### 🌀 Animation Capabilities
- **Set keyframes** for layer properties (Position, Scale, Rotation, Opacity, etc.)
- **Apply expressions** to layer properties for dynamic animations
- **Batch set properties** across multiple layers at once

## ⚙️ Setup Instructions

### 🛠 Prerequisites

For a release install:

- Adobe After Effects (2022 or later)
- Windows PowerShell, included with Windows
- An account for at least one supported CLI: Codex, Claude Code, Antigravity CLI, Kimi CLI, Pi, or OpenCode

Node.js and npm are only required for developing or rebuilding the project.

### 📥 Installation

Release users download and double-click
`AfterEffectsMCP-Extended-Setup-<version>.exe`. The one-file Windows setup asks
for administrator permission once, detects installed After Effects versions,
and installs all three components:

- The standalone MCP server and multi-CLI integration
- The dockable **After Effects MCP Chat** CEP panel
- The `mcp-bridge-auto.jsx` command bridge for each detected AE installation

The setup also adds **After Effects MCP Extended** to Windows Installed Apps so
it can be removed normally. It does not require Node.js or npm. Restart After
Effects after installation and open **Window > Extensions > After Effects MCP Chat**.
This single panel has **Chat** and **Bridge** tabs. The integrated bridge runs in
both tabs; the Bridge tab contains auto-run, live status, and a timestamped command
log. It uses a bundled bridge core and does not require the separate ScriptUI
panel. Keep the combined panel open. The legacy **mcp-bridge-auto.jsx** panel is
optional; if it is already active, close it to use the integrated bridge controls.

Choose a CLI from the selector in the panel. Codex, Antigravity CLI, and Kimi use
their official standalone Windows installers. Claude Code, Pi, and OpenCode use
their official npm packages when Node.js/npm is available; otherwise the panel
opens that provider's official installation instructions. Sign-in is launched
only when the user presses **Sign in**. Each provider keeps its own conversation
session.

**Stop** cancels request preparation and the active harness turn. On Windows, generic harnesses are stopped by terminating the launcher and its complete child-process tree before reporting Stopped. Codex uses its native turn interrupt, with process-tree termination if interruption is not confirmed. Buffered output from cancelled runs is ignored. Pending AE bridge requests owned by this chat are cancelled; unrelated MCP clients are not affected. An AE script already executing cannot be forcibly interrupted safely, and completed edits are not undone.

**Clear** stops the active harness, clears visible messages/tool history, and resets saved harness session IDs (including the Codex thread). The next message starts a fresh conversation without resume/continue flags. Model choices and sign-in credentials are preserved, and historical CLI session files are not deleted.

Use the **Model** row below the CLI selector to choose a model. Each CLI remembers its own choice. The refresh button reloads the available catalog; **Custom model…** accepts an exact model ID or configured alias. Pi and OpenCode use `provider/model-id`. A reasoning selector appears only when the catalog advertises reasoning choices. Model changes apply to the next message and are disabled during a running turn. Returning an override to **CLI default** starts a fresh harness session so a resumed conversation cannot retain the previous override; the visible chat history remains available. Claude offers its stable CLI aliases and custom IDs because its CLI does not expose the same model-list command as the other harnesses.

Codex uses its native app-server integration. Claude Code, Antigravity CLI,
Kimi CLI, and OpenCode receive the bundled AfterEffectsMCP server through their
supported MCP configuration. Antigravity receives the server in its native global
and `.agents/mcp_config.json` workspace configurations, plus `AGENTS.md` instructions.
Pi does not provide native MCP support, so the installer
ships a small Pi extension that exposes the same unified After Effects command
through the existing local bridge. The companion supplies the same After Effects
operating instructions through MCP initialization and each CLI's supported
system-prompt or project-instruction mechanism. Prompt-contract version changes
start a fresh provider session so stale instructions are not resumed.

Developers can build and install from source:

```bash
git clone https://github.com/NickPittas/after-effects-mcp-extended.git
cd after-effects-mcp-extended
npm install
npm run build
npm run build:standalone
npm run install:standalone
```

For CEP-only development updates, use `npm run install:cep`.

To build the single-file Windows setup from source, run:

```bash
npm run build:installer
```

The installer and its SHA-256 checksum are written to `release/`.

`npm run build:standalone` creates:

- `dist/after-effects-mcp-extended.exe`
- `dist/after-effects-codex-chat.exe`

### 🔧 Update MCP Config

#### Option 1: Using .mcp.json (Recommended for Claude Code)
The repository includes a `.mcp.json` file for easy configuration. Copy or reference it in your MCP settings:

```json
{
  "mcpServers": {
    "AfterEffectsMCP": {
      "command": "node",
      "args": ["PATH/TO/after-effects-mcp/build/index.js"]
    }
  }
}
```

#### Option 2: Manual Configuration
Go to your client (e.g., Claude or Cursor) and update your config file:

```json
{
  "mcpServers": {
    "AfterEffectsMCP": {
      "command": "node",
      "args": ["C:\\Users\\Dakkshin\\after-effects-mcp\\build\\index.js"]
    }
  }
}
```

### ▶️ Running the Server

1. **Start the MCP server**
   ```bash
   npm start
   # or
   yarn start
   ```

2. **Open After Effects**

3. **Open the combined Chat and Bridge panel**
   - In After Effects, go to Window > Extensions > After Effects MCP Chat
   - The bridge runs automatically while either tab is selected
   - The Bridge tab provides an "Auto-run commands" checkbox and command log
   - Alternatively, the legacy Window > mcp-bridge-auto.jsx panel still works

## 🚀 Usage Guide

Once you have the server running and the combined CEP panel (or optional legacy bridge) open in After Effects, you can control After Effects through the MCP protocol. This allows AI assistants or custom applications to send commands to After Effects.

### Native text animators

Use the existing **after-effects** tool with `operation=text` and
`action=animator` or `action=selector`. No extra MCP tools are required, and the
same actions are exposed to Pi and every other chat harness.

For an existing text layer in a 25 fps composition, this single request reveals
characters over 25 frames without animating the layer's opacity:

```json
{
  "operation": "text",
  "action": "animator",
  "parameters": {
    "compName": "Text Demo",
    "layerIndex": 1,
    "animatorAction": "add",
    "animatorName": "Character Reveal",
    "properties": [{ "property": "opacity", "value": 0 }],
    "selectors": [{
      "type": "range",
      "settings": {
        "basedOn": "characters",
        "smoothness": 0,
        "start": { "keyframes": [{ "time": 0, "value": 0 }, { "time": 1, "value": 100 }] }
      }
    }]
  }
}
```

- `animatorAction` / `selectorAction`: `get`, `add`, `update`, `remove` (default `get`).
- Select existing groups by 1-based `animatorIndex` / `selectorIndex`, or unique names. Rename with `newName`.
- Animator `properties` accept friendly aliases for transforms, opacity, fill/stroke, tracking/line spacing, blur, and character values/offsets; `matchName` supports additional native properties. Updates can use `remove:true` to remove an animator property.
- `selectors` accept `range`, `wiggly`, and `expression`. Omitted selectors create a range selector; `selectors:[]` creates none.
- Selector `settings` accept friendly range controls, or an array of `{propertyPath, value, keyframes, expression}` specs for arbitrary native controls. Expression-selector `amount` accepts an expression spec.
- Values and selectors can carry keyframes, interpolation/ease options, expressions, or explicit `clearKeys:true`. Times are seconds; divide frames by the composition's frame rate.
- Get/create/update responses include property paths and keyframes. Use those paths with existing `property` / `keyframe` tools; re-inspect after structural edits because indices may change.

Native AE renderer and per-character 3D restrictions still apply. The bridge does
not silently switch layer/renderer modes or replace native text animation with
layer transforms. Failed creation removes only the newly created group;
updates are not transactional, so use AE Undo if an update fails partway through.

Naming an animator `Position` does not add its Position property. Supply an
explicit `properties` list, for example `[{"property":"position","value":[0,0,0]}]`.
AE can expose dormant animator properties through its scripting catalog before
they have been added. A catalog lookup, a default value, or a successful empty
animator creation is not proof that the property can be animated. The bridge
must activate requested properties with native `addProperty()` before writing.
Do not enable layer 3D or replace the text layer as a workaround for a failure.

The opt-in native check is `node scripts/test-live-text-animators.mjs --live`.
Run it after building, with bridge 1.10.12 loaded and the chat idle. It creates
and removes only a uniquely identified temporary composition, checks Position
keyframes/expressions and default-valued activation, and compares rendered
frames. It never saves or edits existing compositions; project undo history
and the dirty flag can still be affected by creating/removing the test fixture.

### 📘 Creating Compositions

You can create new compositions with custom settings:
- Name
- Width and height (in pixels)
- Frame rate
- Duration
- Background color

Example MCP tool usage (for developers):
```javascript
mcp_aftereffects_create_composition({
  name: "My Composition", 
  width: 1920, 
  height: 1080, 
  frameRate: 30,
  duration: 10
});
```

### ✍️ Working with Layers

You can create and modify different types of layers:

**Text layers:**
- Set text content, font, size, and color
- Position text anywhere in the composition
- Adjust timing and opacity

**Shape layers:**
- Create rectangles, ellipses, polygons, and stars
- Set fill and stroke colors
- Customize size and position

**Solid layers:**
- Create background colors
- Make adjustment layers for effects

### 🕹 Animation

You can animate layers with:

**Keyframes:**
- Set property values at specific times
- Create motion, scaling, rotation, and opacity changes
- Control the timing of animations

**Expressions:**
- Apply JavaScript expressions to properties
- Create dynamic, procedural animations
- Connect property values to each other

## 🛠 Available MCP Tools

| Command                     | Description                            |
|-----------------------------|----------------------------------------|
| `create-composition`        | Create a new composition               |
| `run-script`                | Run a JS script inside AE              |
| `get-results`               | Get script results                     |
| `get-help`                  | Help for available commands            |
| `setLayerKeyframe`          | Add keyframe to layer property         |
| `setLayerExpression`        | Add/remove expressions from properties|
| `setLayerProperties`        | Set layer properties (position, scale, rotation, opacity, blendMode, threeDLayer, trackMatteType, enabled, etc.) |
| `batchSetLayerProperties`  | Apply properties to multiple layers   |
| `getLayerInfo`              | Get layer info (position, 3D status)  |
| `createCamera`              | Create camera layer                   |
| `createNullObject`          | Create null object for animation      |
| `duplicateLayer`            | Duplicate a layer                     |
| `deleteLayer`               | Delete a layer                        |
| `setLayerMask`              | Create/modify layer masks             |

## 👨‍💻 For Developers

### 🧩 Project Structure

- `src/index.ts`: MCP server implementation
- `src/chat-host.ts`: multi-CLI AE Chat companion and Codex app-server client
- `src/cli-providers.ts`: provider detection, launch specifications, MCP configuration, and stream normalization
- `assets/pi-after-effects-extension.ts`: bundled direct After Effects bridge tool for Pi
- `src/scripts/mcp-bridge-auto.jsx`: Main After Effects panel script
- `install-bridge.js`: Script to install the panel in After Effects
- `install-standalone.ps1`: Node-free Windows release installer

### 📦 Building the Project

```bash
npm run build
npm run build:standalone
```

**Note:** This project uses esbuild for fast builds, replacing the previous TypeScript compiler approach that could run out of memory on larger codebases.

### 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Dakkshin/after-effects-mcp&type=date&legend=top-left)](https://www.star-history.com/#Dakkshin/after-effects-mcp&type=date&legend=top-left)

## License

This project is licensed under the MIT License - see the LICENSE file for details.
