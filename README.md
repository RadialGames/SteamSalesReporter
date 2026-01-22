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

# Production build
npm run build
```

## Tech Stack

- **Frontend**: Svelte 5, TypeScript
- **Styling**: Tailwind CSS 4
- **Charts**: Chart.js
- **Build**: Vite 7
- **Database**: IndexedDB via Dexie

## License

MIT
