// Electron main process
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, getSalesFromDb, saveSalesData, getHighwatermark, setHighwatermark } from './services/database';
import { fetchSalesDataFromSteam } from './services/steam-api';
import { getApiKey, setApiKey } from './services/secure-storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#581c87' // purple-900
  });

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
function setupIpcHandlers() {
  ipcMain.handle('get-api-key', async () => {
    return getApiKey();
  });

  ipcMain.handle('set-api-key', async (_event, key: string) => {
    return setApiKey(key);
  });

  ipcMain.handle('fetch-sales-data', async (_event, params) => {
    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error('API key not configured');
    }
    return fetchSalesDataFromSteam({ ...params, apiKey });
  });

  ipcMain.handle('get-sales-from-db', async (_event, filters) => {
    return getSalesFromDb(filters);
  });

  ipcMain.handle('save-sales-data', async (_event, data) => {
    return saveSalesData(data);
  });

  ipcMain.handle('get-highwatermark', async () => {
    return getHighwatermark();
  });

  ipcMain.handle('set-highwatermark', async (_event, value: number) => {
    return setHighwatermark(value);
  });
}

app.whenReady().then(async () => {
  // Initialize database
  await initDatabase();
  
  // Setup IPC handlers
  setupIpcHandlers();
  
  // Create window
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Check if safeStorage is available
app.on('ready', () => {
  console.log('Safe storage available:', safeStorage.isEncryptionAvailable());
});
