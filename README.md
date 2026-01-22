# Steam Sales Analyzer

A magical desktop application for Steam game developers to analyze their sales data with beautiful visualizations.

## Features

- **Interactive Dashboard**: Revenue tracking, product comparisons, and geographic insights
- **Real-time Data**: Connect to Steam's Financial API to fetch your latest sales data
- **Beautiful Charts**: Line charts, bar charts, and doughnut charts powered by Chart.js
- **Data Table**: Sortable and filterable table view of all sales records
- **Local Storage**: All data stored locally for privacy and offline access
- **Fun Theme**: Purple gradients, rainbow accents, and unicorn animations!

## Prerequisites

- A Steam Partner account with Financial API access
- A Financial Web API Key from the [Steam Partner Portal](https://partner.steamgames.com/)

## Getting Started

### Setup

First, ensure you have npm installed. npm comes bundled with Node.js.

**Check if npm is installed:**
```bash
npm --version
```

**If npm is not installed:**

**Install Node.js (which includes npm) using one of these methods:**

**Using nvm (Node Version Manager) - Recommended:**
```bash
# Install nvm (macOS/Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Or using Homebrew (macOS)
brew install nvm

# Install Node.js LTS
nvm install --lts
nvm use --lts
```

**Using package managers:**
```bash
# macOS (Homebrew)
brew install node

# Linux (Ubuntu/Debian)
sudo apt update
sudo apt install nodejs npm

# Linux (Fedora/RHEL)
sudo dnf install nodejs npm

# Windows (using Chocolatey)
choco install nodejs
```

**Verify installation:**
```bash
node --version
npm --version
```

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

### Development Commands

```bash
# Development server (fast HMR)
npm run dev

# Type checking
npm run check

# Production build (web only)
npm run build
```

## Building for Production

This project supports two build modes:
1. **Web Build** - Static files for hosting in a browser
2. **Desktop Build** - Native desktop app using Tauri

### Web Build (All Platforms)

```bash
npm run build
```

Output files will be in the `dist/` directory. Serve with any static file server.

### Desktop Build with Tauri

The desktop app requires Tauri prerequisites to be installed first.

#### macOS Prerequisites

1. **Xcode Command Line Tools**:
   ```bash
   xcode-select --install
   ```

2. **Rust** (required for Tauri):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

3. **Verify installation**:
   ```bash
   rustc --version
   cargo --version
   ```

#### macOS Build

```bash
# Development mode with hot reload
npm run dev:tauri

# Production build
npm run build:tauri
```

The built app will be in `src-tauri/target/release/bundle/`:
- `.app` bundle: `src-tauri/target/release/bundle/macos/`
- `.dmg` installer: `src-tauri/target/release/bundle/dmg/`

**Note**: The unsigned app works fine for local use, but distributing to other users requires code signing with an Apple Developer account.

#### Windows Prerequisites

1. **Microsoft Visual Studio C++ Build Tools**:
   - Download from [Visual Studio Downloads](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Run the installer and select "Desktop development with C++"
   - Ensure "MSVC v143" and "Windows 10/11 SDK" are checked

2. **WebView2** (usually pre-installed on Windows 10/11):
   - If needed, download from [Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

3. **Rust**:
   - Download and run [rustup-init.exe](https://win.rustup.rs/)
   - Follow the on-screen instructions
   - Restart your terminal after installation

4. **Verify installation** (open a new terminal):
   ```powershell
   rustc --version
   cargo --version
   ```

#### Windows Build

```powershell
# Development mode with hot reload
npm run dev:tauri

# Production build
npm run build:tauri
```

The built app will be in `src-tauri\target\release\bundle\`:
- `.exe` installer: `src-tauri\target\release\bundle\nsis\`
- `.msi` installer: `src-tauri\target\release\bundle\msi\`

### Build Troubleshooting

**"cargo not found"**: Restart your terminal or run `source $HOME/.cargo/env` (macOS/Linux)

**Windows build fails with linker errors**: Ensure Visual Studio Build Tools are fully installed with the C++ workload

**macOS code signing**: For distribution, you'll need an Apple Developer account. For local testing, the unsigned app works fine.

## Debugging

For database debugging and troubleshooting, see [AI_DEBUG_GUIDE.md](./AI_DEBUG_GUIDE.md). This guide contains the database schema, useful queries, and CLI commands for inspecting the SQLite database.

## Known Issues & Notes

**Data Discrepancies**: Some data may be slightly lesser than what is reported on the Steam portal. The reason for this is unclear at this time. May be a glitch on Steam's end.

**API Key Scope**: API keys are valid for the entire org they are issued to, not to individual users. This means you cannot filter based on various access rights. This can be problematic for publishers trying to share data with clients. Please request this feature from Valve if you wish to see it.

## Tech Stack

- **Frontend**: Svelte 5, TypeScript
- **Styling**: Tailwind CSS 4
- **Charts**: Chart.js
- **Build**: Vite 7
- **Desktop**: Tauri 2
- **Database**: SQLite (via sqlocal WASM)

## License

MIT
