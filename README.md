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

- Node.js 18+ 
- A Steam Partner account with Financial API access
- A Financial Web API Key from the [Steam Partner Portal](https://partner.steamgames.com/)

## Getting Started

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

# Check for package updates
npm run update-check

# Type checking
npm run check

# Production build
npm run build
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
├── src/
│   ├── App.svelte           # Root component
│   ├── lib/
│   │   ├── components/      # Svelte components
│   │   ├── services/        # API abstraction layer
│   │   ├── stores/          # Svelte stores
│   │   └── db/              # IndexedDB (Dexie)
│   └── app.css              # Tailwind + custom theme
├── public/                   # Static assets
└── vite.config.ts           # Vite config with proxy
```

## Tech Stack

- **Frontend**: Svelte 5, TypeScript
- **Styling**: Tailwind CSS 4
- **Charts**: Chart.js
- **Build**: Vite 7
- **Database**: IndexedDB via Dexie

## License

MIT
