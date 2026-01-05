import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TubePlayer } from '../../src/TubePlayer';
import { Innertube } from 'youtubei.js/web';

// Mock dependencies
vi.mock('shaka-player/dist/shaka-player.ui', () => {
  return {
    default: {
      polyfill: { installAll: vi.fn() },
      Player: class {
        static isBrowserSupported = vi.fn().mockReturnValue(true);
        constructor() {}
        configure() {}
        attach() { return Promise.resolve(); }
        destroy() {}
        unload() { return Promise.resolve(); }
        load() { return Promise.resolve(); }
      },
      ui: {
        Overlay: class {
          constructor() {}
          configure() {}
          destroy() {}
        }
      }
    },
  };
});

const mockGetVideos = vi.fn();
const mockGetContinuation = vi.fn();
const mockLoadVideo = vi.fn();

vi.mock('youtubei.js/web', () => {
  return {
    Innertube: {
      create: vi.fn()
    },
    UniversalCache: class {},
    Platform: { shim: {} },
    Utils: {
      generateRandomString: () => 'random',
      timeToSeconds: (str: string) => {
        if (str === '1:00') return 60;
        return 0;
      }
    },
    Constants: { CLIENT_NAME_IDS: { WEB: 1 } },
    YT: {
      VideoInfo: class {
        basic_info = { is_live: false };
        playability_status = { status: 'OK' };
        streaming_data = { dash_manifest_url: 'http://dash' };
        toDash() { return Promise.resolve(''); }
      }
    },
    Mixins: { Feed: class {} }
  };
});

vi.mock('../../src/BotguardService', () => {
  return {
    botguardService: {
      init: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      mintColdStartToken: vi.fn(),
      isInitialized: vi.fn().mockReturnValue(true)
    }
  };
});

// Helper to create mock video objects
const createMockVideo = (id: string, title: string, duration?: any) => ({
  video_id: id,
  title: { toString: () => title },
  duration
});

const createMockGridVideo = (id: string, title: string, durationText: string) => ({
  video_id: id,
  title: { toString: () => title },
  duration: { text: { toString: () => durationText } }
});

describe('Channel Fetching', () => {
  let player: TubePlayer;
  let mockInnertube: any;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="player"></div>';

    // Setup mock Innertube instance
    mockInnertube = {
      getChannel: vi.fn(),
      actions: { execute: vi.fn() },
      session: {
        player: { signature_timestamp: 12345 },
        context: { client: { osName: 'Test', osVersion: '1.0', clientName: 'WEB', clientVersion: '1.0' } }
      }
    };

    (Innertube.create as any).mockResolvedValue(mockInnertube);

    player = new TubePlayer('player');
    await player.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch channel videos correctly', async () => {
    const mockFeed = {
      videos: [
        createMockVideo('v1', 'Video 1', { seconds: 120 }),
        createMockVideo('v2', 'Video 2', { seconds: 180 })
      ],
      has_continuation: false
    };

    const mockChannel = {
      metadata: { title: 'Test Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    const result = await player.fetchChannelVideos('channel-id');

    expect(mockInnertube.getChannel).toHaveBeenCalledWith('channel-id');
    expect(mockChannel.getVideos).toHaveBeenCalled();
    expect(result.title).toBe('Test Channel');
    expect(result.videos).toHaveLength(2);
    expect(result.videos[0]).toEqual({ id: 'v1', title: 'Video 1', duration: 120 });
    expect(result.videos[1]).toEqual({ id: 'v2', title: 'Video 2', duration: 180 });
  });

  it('should handle pagination (continuations)', async () => {
    const mockFeed1 = {
      videos: [createMockVideo('v1', 'Video 1', { seconds: 60 })],
      has_continuation: true,
      getContinuation: vi.fn()
    };

    const mockFeed2 = {
      videos: [createMockVideo('v2', 'Video 2', { seconds: 120 })],
      has_continuation: false
    };

    mockFeed1.getContinuation.mockResolvedValue(mockFeed2);

    const mockChannel = {
      metadata: { title: 'Test Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed1)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    const result = await player.fetchChannelVideos('channel-id');

    expect(mockChannel.getVideos).toHaveBeenCalled();
    expect(mockFeed1.getContinuation).toHaveBeenCalled();
    expect(result.videos).toHaveLength(2);
    expect(result.videos[0].id).toBe('v1');
    expect(result.videos[1].id).toBe('v2');
  });

  it('should respect maxVideos limit', async () => {
    const mockFeed = {
      videos: [
        createMockVideo('v1', 'Video 1', { seconds: 60 }),
        createMockVideo('v2', 'Video 2', { seconds: 60 }),
        createMockVideo('v3', 'Video 3', { seconds: 60 })
      ],
      has_continuation: true, // Should not be called if limit reached
      getContinuation: vi.fn()
    };

    const mockChannel = {
      metadata: { title: 'Test Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    const result = await player.fetchChannelVideos('channel-id', 2);

    expect(mockChannel.getVideos).toHaveBeenCalled();
    expect(mockFeed.getContinuation).not.toHaveBeenCalled();
    expect(result.videos).toHaveLength(2);
    expect(result.videos[0].id).toBe('v1');
    expect(result.videos[1].id).toBe('v2');
  });

  it('should limit videos to 100 by default', async () => {
    const videos = Array.from({ length: 150 }, (_, i) => createMockVideo(`v${i}`, `Video ${i}`, { seconds: 60 }));

    // Simulate pagination
    const mockFeed1 = {
      videos: videos.slice(0, 50),
      has_continuation: true,
      getContinuation: vi.fn()
    };

    const mockFeed2 = {
      videos: videos.slice(50, 100),
      has_continuation: true,
      getContinuation: vi.fn()
    };

    const mockFeed3 = {
      videos: videos.slice(100, 150),
      has_continuation: false,
      getContinuation: vi.fn()
    };

    mockFeed1.getContinuation.mockResolvedValue(mockFeed2);
    mockFeed2.getContinuation.mockResolvedValue(mockFeed3);

    const mockChannel = {
      metadata: { title: 'Test Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed1)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    const result = await player.fetchChannelVideos('channel-id');

    expect(mockChannel.getVideos).toHaveBeenCalled();
    // It should fetch the second page (to get to 100) but not the third
    expect(mockFeed1.getContinuation).toHaveBeenCalled();
    // mockFeed1.getContinuation returns mockFeed2 (page 2).
    // After processing page 2, we have 100 videos.
    // The loop condition (allVideos.length < maxVideos) becomes 100 < 100 (False).
    // So we should NOT fetch the next continuation from mockFeed2.
    expect(mockFeed2.getContinuation).not.toHaveBeenCalled();
    expect(mockFeed3.getContinuation).not.toHaveBeenCalled();

    expect(result.videos).toHaveLength(100);
  });

  it('should handle GridVideo duration format', async () => {
    const mockFeed = {
      videos: [
        createMockGridVideo('v1', 'Grid Video', '1:00')
      ],
      has_continuation: false
    };

    const mockChannel = {
      metadata: { title: 'Test Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    const result = await player.fetchChannelVideos('channel-id');

    expect(result.videos[0]).toEqual({ id: 'v1', title: 'Grid Video', duration: 60 });
  });

  it('should skip videos without IDs', async () => {
    const mockFeed = {
      videos: [
        { title: { toString: () => 'No ID Video' } }, // Missing id
        createMockVideo('v1', 'Valid Video', { seconds: 60 })
      ],
      has_continuation: false
    };

    const mockChannel = {
      metadata: { title: 'Test Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    const result = await player.fetchChannelVideos('channel-id');

    expect(result.videos).toHaveLength(1);
    expect(result.videos[0].id).toBe('v1');
  });

  it('playRandomChannelVideo should fetch videos and load a random one', async () => {
    const mockFeed = {
      videos: [createMockVideo('v1', 'Video 1', { seconds: 60 })],
      has_continuation: false
    };

    const mockChannel = {
      metadata: { title: 'Test Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    // Spy on loadVideo
    const loadVideoSpy = vi.spyOn(player, 'loadVideo').mockResolvedValue({
      id: 'v1',
      title: 'Video 1'
    } as any);

    const result = await player.playRandomChannelVideo('channel-id');

    expect(mockInnertube.getChannel).toHaveBeenCalledWith('channel-id');
    expect(loadVideoSpy).toHaveBeenCalledWith('v1');
    expect(result.channelMetadata.videos).toHaveLength(1);
    expect(result.videoInfo.id).toBe('v1');
  });

  it('playRandomChannelVideo should throw error if no videos found', async () => {
    const mockFeed = {
      videos: [],
      has_continuation: false
    };

    const mockChannel = {
      metadata: { title: 'Empty Channel' },
      getVideos: vi.fn().mockResolvedValue(mockFeed)
    };

    mockInnertube.getChannel.mockResolvedValue(mockChannel);

    await expect(player.playRandomChannelVideo('channel-id'))
      .rejects.toThrow('No videos found in this channel.');
  });
});
