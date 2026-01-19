import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Steam Sales Analyzer',
    executableName: 'steam-sales-analyzer',
    appBundleId: 'com.steamsales.analyzer',
    // Build for both Intel and Apple Silicon Macs
    arch: ['x64', 'arm64'] as any,
    // Ad-hoc code signing for local use (no Apple Developer account needed)
    osxSign: {
      identity: '-', // Ad-hoc signature
    },
    // Only include built files and package.json
    ignore: (file) => {
      if (!file) return false;
      // Always include these
      if (file === '/package.json') return false;
      if (file.startsWith('/dist-electron')) return false;
      if (file.startsWith('/dist')) return false;
      // Ignore everything else
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'SteamSalesAnalyzer',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      format: 'ULFO',
    }),
    new MakerDeb({
      options: {
        maintainer: 'Steam Sales Analyzer',
        homepage: 'https://github.com/steamsales/analyzer',
      },
    }),
  ],
};

export default config;
