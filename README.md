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
- Batch imports, render-queue management, multiple outputs, AME dispatch, and reusable render/output templates
- Media inventory, relinking, reloading, interpretation, file/sequence/placeholder/solid proxies, dependency traversal, and missing-media reports
- Dependency manifests plus explicitly confirmed consolidation, unused-footage removal, and project reduction
- Keyframe creation, editing, removal, interpolation, and easing controls
- Layer creation, parenting, duplication, ordering, and switch management
- Project import, organization, saving, render-queue operations, and PNG frame capture
- Text animators with character, word, and line range selectors
- Improved bridge response tracking and direct rendered-frame image returns
- Dockable, resizable ScriptUI bridge panel
- Dockable CEP/HTML multi-CLI chat panel for Codex, Claude Code, Antigravity CLI (AGY), Kimi CLI, Pi, and OpenCode, with per-provider sessions, chronologically segmented streamed conversations, timestamped expandable tool groups, account/setup controls, viewer/UI screenshots, Stop, and autonomous mode
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
Effects after installation, open **Window > mcp-bridge-auto.jsx**, then open
**Window > Extensions > After Effects MCP Chat**.

Choose a CLI from the selector in the panel. Codex, Antigravity CLI, and Kimi use
their official standalone Windows installers. Claude Code, Pi, and OpenCode use
their official npm packages when Node.js/npm is available; otherwise the panel
opens that provider's official installation instructions. Sign-in is launched
only when the user presses **Sign in**. Each provider keeps its own conversation
session.

Codex uses its native app-server integration. Claude Code, Antigravity CLI,
Kimi CLI, and OpenCode receive the bundled AfterEffectsMCP server through their
supported MCP configuration. Antigravity uses its native `.agents/mcp_config.json`
workspace configuration and `AGENTS.md` instructions. Pi does not provide native MCP support, so the installer
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

3. **Open the MCP Bridge Auto panel**
   - In After Effects, go to Window > mcp-bridge-auto.jsx
   - The panel will automatically check for commands every few seconds
   - Make sure the "Auto-run commands" checkbox is enabled

## 🚀 Usage Guide

Once you have the server running and the MCP Bridge panel open in After Effects, you can control After Effects through the MCP protocol. This allows AI assistants or custom applications to send commands to After Effects.

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
