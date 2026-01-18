# Steam Sales Analyzer

A magical desktop application for Steam game developers to analyze their sales data with beautiful visualizations.

## Features

- **Interactive Dashboard**: Revenue tracking, product comparisons, and geographic insights
- **Real-time Data**: Connect to Steam's Financial API to fetch your latest sales data
- **Beautiful Charts**: Line charts, bar charts, and doughnut charts powered by Chart.js
- **Data Table**: Sortable and filterable table view of all sales records
- **Dual-Mode Architecture**: Fast browser development with Vite HMR, production Electron builds
- **Local Storage**: All data stored locally for privacy and offline access
- **Fun Theme**: Purple gradients, rainbow accents, and unicorn animations!

## Prerequisites

- Node.js 18+ 
- A Steam Partner account with Financial API access
- A Financial Web API Key from the [Steam Partner Portal](https://partner.steamgames.com/)

## Getting Started

### Installation

```bash
# Install dependencies
npm install

# Start development server (browser-only, fast HMR)
npm run dev
```

Open http://localhost:5173 in your browser.

### Development Commands

```bash
# Browser development (fast, recommended)
npm run dev

# Electron development (optional, slower)
npm run dev:electron

# Check for package updates
npm run update-check

# Type checking
npm run check
```

### Production Build

```bash
# Build web version
npm run build

# Build Electron app for distribution
npm run build:electron
```

## Architecture

This app uses a dual-mode architecture for optimal development experience:

### Development Mode (Browser)
- Pure Vite + Svelte running in the browser
- Vite's proxy handles CORS for Steam API calls
- IndexedDB stores sales data locally
- localStorage stores API key and settings
- Full hot module replacement for instant updates

### Production Mode (Electron)
- Bundled as a native desktop app
- Main process handles Steam API calls directly
- SQLite database for persistent storage
- Electron's safeStorage for encrypted API key

### Service Abstraction

The `$lib/services` module provides a unified interface that automatically selects the correct implementation:

```typescript
import { services } from '$lib/services';

// Works in both browser and Electron!
const apiKey = await services.getApiKey();
const data = await services.fetchSalesData({ apiKey });
```

## Steam API Integration

This app uses the [IPartnerFinancialsService](https://partner.steamgames.com/doc/webapi/IPartnerFinancialsService) API:

1. **GetChangedDatesForPartner**: Fetches dates with new/updated data using a highwatermark for efficient incremental syncs
2. **GetDetailedSales**: Retrieves detailed sales records for each date

### Getting Your API Key

1. Log in to your [Steamworks Partner account](https://partner.steamgames.com/)
2. Navigate to Users & Permissions
3. Create or join a Financial API Group
4. Generate a Web API key for the group

## Project Structure

```
steam-sales-analyzer/
├── electron/                 # Electron main process
│   ├── main.ts              # App entry point
│   ├── preload.ts           # Context bridge
│   └── services/            # SQLite, secure storage, API
├── src/
│   ├── App.svelte           # Root component
│   ├── lib/
│   │   ├── components/      # Svelte components
│   │   ├── services/        # API abstraction layer
│   │   ├── stores/          # Svelte stores
│   │   └── db/              # IndexedDB (Dexie)
│   └── app.css              # Tailwind + custom theme
├── public/                   # Static assets
├── vite.config.ts           # Vite config with proxy
└── electron.vite.config.ts  # Electron build config
```

## Tech Stack

- **Frontend**: Svelte 5, TypeScript
- **Styling**: Tailwind CSS 4
- **Charts**: Chart.js + svelte-chartjs
- **Build**: Vite 7
- **Desktop**: Electron 34
- **Database**: 
  - Browser: IndexedDB via Dexie
  - Electron: SQLite via sql.js (WebAssembly, no native builds)

## License

MIT
