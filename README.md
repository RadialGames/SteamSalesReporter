# Steam Sales Analyzer

Interactive Steam sales data analyzer with real-time charts and analysis.

## Architecture

```
steamsales/
├── packages/
│   └── frontend/          # Svelte + Vite frontend
├── src-tauri/             # Tauri Rust backend
└── package.json           # npm workspaces root
```

The application is built with **Tauri**, which provides:
- Native system access to download and execute the CLI tool
- Direct file system access to the database
- Cross-platform desktop application (Windows, macOS, Linux)
- No separate backend server required

The app automatically downloads, installs, and manages the [steam-financial-cli](https://github.com/RadialGames/steam-financial-cli) tool, which fetches and stores Steam sales data in a SQLite database. The frontend loads this database and queries it directly in the browser using sql.js (SQLite compiled to WebAssembly).

## Prerequisites

- Node.js 20+
- Rust (for building Tauri) - Install from [rustup.rs](https://rustup.rs/)
- System dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.0-dev`, `build-essential`, `curl`, `wget`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
  - **Windows**: Microsoft Visual Studio C++ Build Tools

**Note**: The CLI tool is automatically downloaded and installed by the application. You don't need to install it manually.

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Development

Run the Tauri development server:

```bash
npm run dev
```

This will:
- Start the Vite dev server for the frontend
- Build and run the Tauri application
- Open the desktop window automatically

### 3. Set Up Your API Key

1. When the app opens, click "Setup" in the header
2. The setup wizard will:
   - Automatically download the CLI tool for your platform
   - Prompt you to enter your Steam Financial API key (from the [Steamworks Partner portal](https://partner.steamgames.com//pub/groups/))
   - Initialize the CLI tool with your API key
   - Fetch your sales data automatically
   - Load the database into the application

### 4. Explore Your Data

Once setup is complete, you can:
- View dashboard statistics
- Explore charts and visualizations
- Filter data by date, app, country, etc.
- Refresh data by clicking "Refresh Data" in the header

## Building for Production

### Build the Application

```bash
npm run tauri:build
```

This will create platform-specific installers in `src-tauri/target/release/bundle/`:
- **Windows**: `.msi` installer
- **macOS**: `.dmg` and `.app`
- **Linux**: `.deb`, `.AppImage`, and `.rpm`

### Development Commands

```bash
# Run Tauri dev mode
npm run dev

# Run web-only dev mode (for testing frontend without Tauri)
npm run dev:web

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Debugging (DevTools)

In **debug builds** (e.g. `npm run dev`), the web inspector opens automatically when the app starts.

You can also open it manually:
- **macOS**: `Cmd + Option + I`
- **Windows / Linux**: `Ctrl + Shift + I`
- **Right-click** in the window and choose **Inspect Element**

## How It Works

1. **Tauri Backend (Rust)**: Provides native system access to:
   - Download the CLI tool binary for your platform
   - Execute CLI commands (`init`, `fetch`)
   - Access the database file from the file system

2. **Automatic CLI Management**: The Rust backend automatically downloads the appropriate CLI tool binary for your platform (Linux, macOS, or Windows) from GitHub releases.

3. **API Key Configuration**: Your Steam Financial API key is stored securely by the CLI tool in its configuration.

4. **Data Fetching**: The Tauri backend executes the CLI tool's `fetch` command to download your sales data from the Steam Partner API.

5. **Database Storage**: The CLI tool stores data in a SQLite database file located at `~/.steamsales/steam-financial.db`.

6. **Frontend**: The web application (Svelte) loads the SQLite database file into the browser using sql.js and queries it directly. All data processing happens client-side.

7. **Updates**: Click "Refresh Data" in the header to fetch the latest data from Steam.

## Tech Stack

### Frontend
- Svelte 5
- Vite
- TailwindCSS 4
- Chart.js
- sql.js (SQLite in the browser)

### Backend (Tauri)
- Rust
- Tauri 2.0
- Native system integration

## File Locations

- **CLI Binary**: `~/.steamsales/cli/steam-financial` (or `.exe` on Windows)
- **Database File**: `~/.steamsales/steam-financial.db`

## Troubleshooting

### Rust Not Installed

Install Rust from [rustup.rs](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### System Dependencies Missing

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

**Windows:**
Install [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### CLI Tool Not Downloading

- Check your internet connection
- Ensure you have write permissions to `~/.steamsales/`
- Check the console for error messages

### Database Not Loading

- Check that the database file exists at `~/.steamsales/steam-financial.db`
- Try clicking "Refresh Data" to fetch data again
- Check the console for errors

### API Key Issues

- Verify your API key is correct
- Ensure you have access to the Steam Financial API in the Steamworks Partner portal
- Try re-initializing via the Setup wizard

## Notes

- The database file is loaded into browser memory, so very large databases may impact performance
- The CLI tool handles API key management - your key is stored securely by the CLI tool
- Data is fetched on-demand when you click "Refresh Data"
- The setup wizard guides you through the entire setup process automatically
- This is a desktop application - it runs natively on your system, not in a browser
