# Migration Notes

## Architecture Changes

The application has been re-architected from a browser-only SQLite setup to a client-server architecture:

- **Backend**: Node.js + Fastify + PostgreSQL (via Drizzle ORM)
- **Frontend**: Svelte + Vite (API client instead of local database)

## Completed

1. Removed Tauri and all native app capabilities
2. Created npm workspaces monorepo structure (`packages/frontend`, `packages/backend`)
3. Set up PostgreSQL via Docker
4. Created Drizzle schema with normalized tables
5. Implemented Fastify REST API with all endpoints
6. Created Steam API client for backend
7. Implemented sync service with task queue
8. Created frontend API client (`src/lib/api/client.ts`)
9. Created new API-based stores (`src/lib/stores/api-stores.ts`)
10. Removed old SQLite code (`src/lib/db/`)

## Remaining Work

The following components still import from deleted modules and need to be updated to use the new API stores:

### High Priority (Core functionality)
- `App.svelte` - Main app initialization and sync
- `Dashboard.svelte` - Dashboard view
- `StatsCards.svelte` - Stats display
- `FilterBar.svelte` - Filter controls

### Medium Priority (Charts)
- `RevenueChart.svelte` - Revenue chart
- `CountryChart.svelte` - Country chart
- `ChartsView.svelte` - Charts container

### Lower Priority (Tables and comparisons)
- `SalesTable.svelte` - Sales data table
- `LaunchComparison.svelte` - Launch comparison
- `SkuComparison.svelte` - SKU comparison
- `PackageMetrics.svelte` - Package metrics
- `ProductLaunchTable.svelte` - Product launches
- `DatabaseStats.svelte` - Database stats (may be removed)
- `RawDataMetrics.svelte` - Raw data metrics

### To Update Each Component

1. Replace `$lib/db/*` imports with `$lib/api/client` or `$lib/stores/api-stores`
2. Use the new store methods (e.g., `statsStore.load()`, `dailySummariesStore.load()`)
3. Update reactive statements to use the new stores
4. Remove any SQLite-specific logic

### Example Migration

Before:
```typescript
import { getDisplayCache } from '$lib/db/display-cache';

let stats = await getDisplayCache('dashboard_stats');
```

After:
```typescript
import { statsStore } from '$lib/stores/api-stores';

await statsStore.load(filters);
// Use $statsStore for reactive data
```

## Running the App

1. Install dependencies: `npm install`
2. Start dev servers: `npm run dev`

The `npm run dev` command automatically:
- Starts PostgreSQL via Docker Compose
- Pushes the database schema
- Starts both backend and frontend

The frontend will connect to the backend at http://localhost:3000.
