import { describe, it, expect, vi } from 'vitest';
import { TubePlayer } from '../../src/TubePlayer';

// Mock dependencies
vi.mock('shaka-player/dist/shaka-player.ui', () => {
  return {
    default: {
      polyfill: {
        installAll: vi.fn(),
      },
      Player: class {
        static isBrowserSupported = vi.fn().mockReturnValue(true);
        constructor() {}
        configure() {}
        attach() { return Promise.resolve(); }
        destroy() {}
        unload() { return Promise.resolve(); }
        getVariantTracks() { return []; }
        getNetworkingEngine() {
            return {
                registerRequestFilter: vi.fn(),
                unregisterRequestFilter: vi.fn(),
                registerResponseFilter: vi.fn(),
                unregisterResponseFilter: vi.fn()
            };
        }
      },
      ui: {
        Overlay: class {
          constructor() {}
          configure() {}
          destroy() {}
        }
      },
      net: {
        NetworkingEngine: {
            registerScheme: vi.fn(),
            unregisterScheme: vi.fn(),
            PluginPriority: { PREFERRED: 1 },
            RequestType: { SEGMENT: 1 }
        },
        HttpFetchPlugin: {
            isSupported: vi.fn().mockReturnValue(true)
        }
      },
      util: {
        Error: class {},
        AbortableOperation: class { constructor(p: any, c: any) { this.promise = p; this.abort = c; } },
        Timer: class { tickAfter() {} stop() {} }
      }
    },
  };
});

vi.mock('youtubei.js/web', () => {
  return {
    Innertube: {
      create: vi.fn().mockResolvedValue({
        session: {
            context: { client: { osName: 'Windows', osVersion: '10', clientName: 'WEB', clientVersion: '2.0' } }
        },
        actions: { execute: vi.fn() }
      })
    },
    UniversalCache: class {},
    Platform: { shim: {} },
    Utils: { generateRandomString: () => 'random' },
    Constants: { CLIENT_NAME_IDS: { WEB: 1 } },
    YT: { VideoInfo: class { basic_info = { is_live: false } } }
  };
});

vi.mock('../../src/BotguardService', () => {
  return {
    botguardService: {
      init: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    }
  };
});

describe('TubePlayer', () => {
  it('should instantiate correctly', () => {
    document.body.innerHTML = '<div id="player"></div>';
    const player = new TubePlayer('player');
    expect(player).toBeTruthy();
  });

  it('should initialize', async () => {
    document.body.innerHTML = '<div id="player"></div>';
    const player = new TubePlayer('player');
    await player.initialize();
    expect(player).toBeTruthy();
  });
});
