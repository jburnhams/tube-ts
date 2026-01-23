import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotguardService } from '../../src/BotguardService';
import { fetchFunction } from '../../src/helpers';


// Mock dependencies
vi.mock('bgutils-js', () => ({
  BG: {
    Challenge: {
      parseChallengeData: vi.fn(() => ({
        interpreterJavascript: {
          privateDoNotAccessOrElseSafeScriptWrappedValue: 'console.log("mock script")'
        },
        interpreterHash: 'mock-hash',
        globalName: 'mockGlobal',
        program: 'mockProgram'
      })),
    },
    BotGuardClient: {
      create: vi.fn(() => Promise.resolve({
        snapshot: vi.fn(() => Promise.resolve('mock-snapshot')),
        shutdown: vi.fn()
      })),
    },
    WebPoMinter: {
      create: vi.fn(),
    },
    PoToken: {
      generateColdStartToken: vi.fn(),
    }
  },
  buildURL: vi.fn(() => 'https://mock-url'),
  GOOG_API_KEY: 'mock-key',
}));

vi.mock('../../src/helpers', () => ({
  fetchFunction: vi.fn(),
}));

describe('BotguardService', () => {
  let botguardService: BotguardService;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    botguardService = new BotguardService();

    // Mock global fetch
    fetchSpy = vi.fn().mockResolvedValue({
      json: async () => ({}),
    });

    vi.stubGlobal('fetch', fetchSpy);
    global.fetch = fetchSpy;
    if (typeof window !== 'undefined') {
      window.fetch = fetchSpy;
    }

    // Also mock fetchFunction return value since it's used later
    vi.mocked(fetchFunction).mockResolvedValue({
      json: async () => (['mock-token']),
    } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should attempt initialization', async () => {
    await botguardService.init();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('should stop attempting initialization after 2 attempts', async () => {
    // Fail first attempt
    fetchSpy.mockRejectedValueOnce(new Error('Fetch failed 1'));

    try {
      await botguardService.init();
    } catch (e) {
      // Expected failure
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Fail second attempt
    fetchSpy.mockRejectedValueOnce(new Error('Fetch failed 2'));
    try {
      await botguardService.init();
    } catch (e) {
      // Expected failure
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Third attempt should NOT call fetch
    const result = await botguardService.init();

    // Expect no new calls
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Result should be undefined (as we returned early)
    expect(result).toBeUndefined();
  });
});
