import shaka from 'shaka-player/dist/shaka-player.ui';
import type { Types, YT } from 'youtubei.js/web';
import { Constants, Innertube, Platform, UniversalCache, Utils, YT as YTUtils, Mixins } from 'youtubei.js/web';
import type { VideoMetadata, ChannelMetadata } from './types/ChannelData.js';
import { SabrStreamingAdapter } from 'googlevideo/sabr-streaming-adapter';
import { buildSabrFormat } from 'googlevideo/utils';
import { ShakaPlayerAdapter } from './ShakaPlayerAdapter.js';
import { botguardService } from './BotguardService.js';
import { fetchFunction } from './helpers.js';
import 'shaka-player/dist/controls.css';

// Shim for youtubei.js
Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
  const properties = [];

  // Log code info for debugging
  if (data.output && data.output.length < 1000) {
    console.log('[TubePlayer] Short code received:', data.output);
  } else {
    console.log(`[TubePlayer] Code received, length: ${data.output?.length}`);
  }

  if (env.n) {
    if (data.exported?.includes('nFunction')) {
      properties.push(`n: exportedVars.nFunction(${JSON.stringify(String(env.n))})`);
    } else {
      console.warn('[TubePlayer] nFunction not exported. Available exports:', data.exported);
      throw new Error(`[TubePlayer] nFunction not exported. Available: ${data.exported?.join(', ')}`);
    }
  }

  if (env.sig) {
    if (data.exported?.includes('sigFunction')) {
      properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(String(env.sig))})`);
    } else {
      console.warn('[TubePlayer] sigFunction not exported, skipping sig transformation');
    }
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  try {
    return new Function(code)();
  } catch (e: any) {
    console.error('[TubePlayer] Shim evaluation failed:', e);
    // Log first few lines of code for debugging
    console.error('[TubePlayer] Code preview:', code.substring(0, 200));
    throw e;
  }
};

export class TubePlayer {
  private player: shaka.Player;
  private ui: shaka.ui.Overlay;
  private sabrAdapter?: SabrStreamingAdapter;
  private innertube?: Innertube;
  private playbackWebPoTokenContentBinding?: string;
  private playbackWebPoTokenCreationLock = false;
  private playbackWebPoToken?: string;
  private coldStartToken?: string;
  private container: HTMLElement;
  private videoElement: HTMLVideoElement;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container element with ID ${containerId} not found.`);
    this.container = container as HTMLElement;

    // Create video element
    this.videoElement = document.createElement('video');
    this.videoElement.style.width = '100%';
    this.videoElement.style.height = '100%';
    this.videoElement.controls = false; // We use Shaka UI
    this.container.appendChild(this.videoElement);

    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      console.warn('Shaka Player is not supported on this browser.');
    }

    this.player = new shaka.Player();
    this.ui = new shaka.ui.Overlay(this.player, this.container, this.videoElement);
  }

  // Store initialization options for retry logic
  private initOptions?: { useProxy?: boolean; cache?: boolean; apiKey?: string };
  private apiKey?: string;

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async initialize(options?: { useProxy?: boolean; cache?: boolean; apiKey?: string }) {
    this.initOptions = options;
    this.apiKey = options?.apiKey;
    let retryCount = 0;
    const maxRetries = 3;
    const useProxy = options?.useProxy ?? true;
    // Default to strict caching unless explicitly disabled seems safest,
    // but the original logic was `retryCount === 0` (so true on first attempt).
    // Let's explicitly support a `cache` override.
    const enableCache = options?.cache ?? true;

    while (retryCount < maxRetries) {
      try {
        const fetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
          // Even on first try, we might want to catch player/base.js and timestamp it?
          // The current structure only enters this block if retryCount > 0.
          // Let's refactor to check URL regardless of retryCount for player scripts.

          let urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
          const urlObj = new URL(urlStr);

          if (urlStr.includes('player') || urlStr.includes('base.js')) {
            // Always add timestamp to prevent caching old/bad player scripts
            urlObj.searchParams.set('t', String(Date.now()));
            // Log the player script URL to debug what we are actually fetching
            console.log('[TubePlayer] Fetching player script from:', urlObj.toString());

            // If input is a Request object, we might lose the method (e.g. POST) if we just pass the URL string.
            // The init object (if present) contains the body, but might rely on the Request object for the method.
            // If we convert Request -> URL string, we must ensure the method is preserved in init.
            let modifiedInit = init;
            if (input instanceof Request) {
              modifiedInit = {
                method: input.method,
                ...init
              };
            }

            // If we are skipping proxy, we still want to apply the timestamp, 
            // but we use native fetch (or default behavior) instead of fetchFunction
            if (!useProxy) return fetch(urlObj.toString(), modifiedInit);
            return fetchFunction(urlObj.toString(), modifiedInit);
          }

          if (!useProxy) {
            return fetch(input, init);
          }
          return fetchFunction(input, init);
        };

        this.innertube = await Innertube.create({
          // Create cache: persistent if enabled AND first try. 
          // If we are retrying internally here (retryCount > 0), we disable it.
          // If enableCache is passed as false (from loadVideo retry), we disable it.
          cache: new UniversalCache(enableCache && retryCount === 0),
          fetch: fetchWrapper
        });
        break;
      } catch (error: any) {
        console.error('Innertube init failed', error);
        retryCount++;
        if (retryCount >= maxRetries) throw error;
        console.log(`Retrying Innertube init (attempt ${retryCount + 1})...`);
      }
    }

    await botguardService.init();

    this.player.configure({
      abr: { enabled: true },
      streaming: {
        bufferingGoal: 120,
        rebufferingGoal: 2
      }
    });

    await this.player.attach(this.videoElement);

    this.ui.configure({
      addBigPlayButton: false,
      overflowMenuButtons: [
        'captions',
        'quality',
        'language',
        'chapter',
        'picture_in_picture',
        'playback_rate',
        'loop',
        'recenter_vr',
        'toggle_stereoscopic',
        'save_video_frame'
      ],
      customContextMenu: true
    });
  }

  async fetchChannelVideos(channelId: string, maxVideos: number = 100): Promise<ChannelMetadata> {
    if (this.apiKey) {
      return this.fetchChannelVideosViaApi(channelId, maxVideos);
    }

    if (!this.innertube) {
      throw new Error('TubePlayer not initialized. Call initialize() first.');
    }

    // Get the channel object
    const channel = await this.innertube.getChannel(channelId);
    // Get the videos tab (returns a Channel instance representing the feed)
    const videosTab = await channel.getVideos();

    // We start with a Channel (which is a Feed) and getContinuation returns ChannelListContinuation (which is also a Feed)
    let feed: Mixins.Feed | any = videosTab;
    const allVideos: VideoMetadata[] = [];

    // Helper to extract video info
    const extractVideos = (currentFeed: Mixins.Feed | any) => {
      // videos getter returns an ObservedArray of various video types
      if (!currentFeed.videos) return;

      for (const video of currentFeed.videos) {
        // We only care about objects that have a video ID
        // GridVideo, CompactVideo, Video have video_id
        // PlaylistVideo has id
        let id = '';
        let title = '';
        let duration = 0;

        if ('video_id' in video) {
          id = (video as any).video_id;
        } else if ('id' in video) {
          id = (video as any).id;
        }

        if ('title' in video) {
          const titleObj = (video as any).title;
          // title is usually a Text object which has toString()
          title = titleObj.toString ? titleObj.toString() : String(titleObj);
        }

        if ('duration' in video) {
          const dur = (video as any).duration;
          // CompactVideo/Video/PlaylistVideo have .seconds
          if (dur && typeof dur.seconds === 'number') {
            duration = dur.seconds;
          } else if (dur && dur.text) {
             // GridVideo might be Text object
             duration = Utils.timeToSeconds(dur.text.toString());
          } else if (dur && typeof dur === 'object' && dur.toString) {
             // Fallback for Text object
             duration = Utils.timeToSeconds(dur.toString());
          }
        }

        if (id) {
          allVideos.push({ id, title, duration });
        }

        if (maxVideos > 0 && allVideos.length >= maxVideos) {
          break;
        }
      }
    };

    extractVideos(feed);

    while (feed.has_continuation && (maxVideos === -1 || allVideos.length < maxVideos)) {
      feed = await feed.getContinuation();
      extractVideos(feed);
    }

    return {
      title: channel.metadata?.title,
      videos: allVideos
    };
  }

  async playRandomChannelVideo(channelId: string): Promise<{ videoInfo: YT.VideoInfo['basic_info'], channelMetadata: ChannelMetadata }> {
    const data = await this.fetchChannelVideos(channelId);
    if (data.videos.length === 0) {
      throw new Error('No videos found in this channel.');
    }

    const randomVideo = data.videos[Math.floor(Math.random() * data.videos.length)];
    const videoInfo = await this.loadVideo(randomVideo.id);

    return {
      videoInfo,
      channelMetadata: data
    };
  }

  async loadVideo(videoId: string): Promise<YT.VideoInfo['basic_info']> {
    if (!this.innertube) {
      throw new Error('TubePlayer not initialized. Call initialize() first.');
    }

    if (!videoId) {
      throw new Error('Please enter a video ID.');
    }

    this.playbackWebPoToken = undefined;
    this.playbackWebPoTokenContentBinding = videoId;

    try {
      // Unload previous video.
      await this.player.unload();

      if (this.sabrAdapter) {
        this.sabrAdapter.dispose();
      }

      // Now fetch video info from YouTube.
      const playerResponse = await this.innertube.actions.execute('/player', {
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: {
          adPlaybackContext: {
            pyv: true
          },
          contentPlaybackContext: {
            signatureTimestamp: this.innertube.session.player?.signature_timestamp
          }
        }
      });

      const cpn = Utils.generateRandomString(16);
      const videoInfo = new YTUtils.VideoInfo([playerResponse], this.innertube.actions, cpn);

      if (videoInfo.playability_status?.status !== 'OK') {
        throw new Error(`Cannot play video: ${videoInfo.playability_status?.reason}`);
      }

      const isLive = videoInfo.basic_info.is_live;
      const isPostLiveDVR = !!videoInfo.basic_info.is_post_live_dvr ||
        (videoInfo.basic_info.is_live_content && !!(videoInfo.streaming_data?.dash_manifest_url || videoInfo.streaming_data?.hls_manifest_url));

      // Initialize and attach SABR adapter.
      this.sabrAdapter = new SabrStreamingAdapter({
        playerAdapter: new ShakaPlayerAdapter(),
        clientInfo: {
          osName: this.innertube.session.context.client.osName,
          osVersion: this.innertube.session.context.client.osVersion,
          clientName: parseInt(Constants.CLIENT_NAME_IDS[this.innertube.session.context.client.clientName as keyof typeof Constants.CLIENT_NAME_IDS]),
          clientVersion: this.innertube.session.context.client.clientVersion
        }
      });

      this.sabrAdapter.onMintPoToken(async () => {
        if (!this.playbackWebPoToken) {
          if (isLive) {
            await this.mintContentWebPO();
          } else {
            this.mintContentWebPO().then();
          }
        }

        return this.playbackWebPoToken || this.coldStartToken || '';
      });

      this.sabrAdapter.onReloadPlayerResponse(async (reloadContext) => {
        const reloadedInfo = await this.innertube!.actions.execute('/player', {
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          playbackContext: {
            adPlaybackContext: {
              pyv: true
            },
            contentPlaybackContext: {
              signatureTimestamp: this.innertube!.session.player?.signature_timestamp
            },
            reloadPlaybackContext: reloadContext
          }
        });

        const parsedInfo = new YTUtils.VideoInfo([reloadedInfo], this.innertube!.actions, cpn);
        this.sabrAdapter!.setStreamingURL(await this.innertube!.session.player!.decipher(parsedInfo.streaming_data?.server_abr_streaming_url));
        this.sabrAdapter!.setUstreamerConfig(videoInfo.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config);
      });

      this.sabrAdapter.attach(this.player);

      if (videoInfo.streaming_data && !isPostLiveDVR && !isLive) {
        // This call triggers decipher, which triggers shim.eval.
        // If nFunction is missing, this will throw the "nFunction not exported" error.
        this.sabrAdapter.setStreamingURL(await this.innertube.session.player!.decipher(videoInfo.streaming_data?.server_abr_streaming_url));
        this.sabrAdapter.setUstreamerConfig(videoInfo.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config);
        this.sabrAdapter.setServerAbrFormats(videoInfo.streaming_data.adaptive_formats.map(buildSabrFormat));
      }

      let manifestUri: string | undefined;
      if (videoInfo.streaming_data) {
        if (isLive) {
          manifestUri = videoInfo.streaming_data.dash_manifest_url ? `${videoInfo.streaming_data.dash_manifest_url}/mpd_version/7` : videoInfo.streaming_data.hls_manifest_url;
        } else if (isPostLiveDVR) {
          manifestUri = videoInfo.streaming_data.hls_manifest_url || `${videoInfo.streaming_data.dash_manifest_url}/mpd_version/7`;
        } else {
          manifestUri = `data:application/dash+xml;base64,${btoa(await videoInfo.toDash({
            manifest_options: {
              is_sabr: true,
              captions_format: 'vtt',
              include_thumbnails: false
            }
          }))}`;
        }
      }

      if (!manifestUri)
        throw new Error('Could not find a valid manifest URI.');

      await this.player.load(manifestUri);

      return videoInfo.basic_info;

    } catch (e: any) {
      console.error('[TubePlayer]', 'Error loading video:', e);

      // Retry mechanism for stale/poisoned cache (e.g. bad player script causing signatureTimestamp: 0)
      if (!this.isRetrying && this.initOptions) {
        console.warn('[TubePlayer] Load failed. Retrying with cache disabled to fetch fresh player script...');
        this.isRetrying = true;
        try {
          // Re-initialize with cache disabled
          await this.initialize({ ...this.initOptions, cache: false });
          return this.loadVideo(videoId);
        } catch (retryError) {
          console.error('[TubePlayer] Retry failed:', retryError);
        } finally {
          this.isRetrying = false;
        }
      }

      throw e;
    }
  }

  // Track retry state to prevent infinite loops
  private isRetrying = false;

  private async fetchChannelVideosViaApi(channelId: string, maxVideos: number): Promise<ChannelMetadata> {
    // Fetch uploads playlist ID
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=${channelId}&key=${this.apiKey}`;
    const channelRes = await fetch(channelUrl);
    if (!channelRes.ok) throw new Error(`API Error: ${channelRes.status} ${channelRes.statusText}`);
    const channelData = await channelRes.json();

    if (!channelData.items || channelData.items.length === 0) {
      throw new Error('Channel not found');
    }

    const uploadsId = channelData.items[0].contentDetails.relatedPlaylists.uploads;
    const channelTitle = channelData.items[0].snippet.title;

    const allVideos: VideoMetadata[] = [];
    let nextPageToken = '';

    do {
      const limit = maxVideos > 0 ? Math.min(50, maxVideos - allVideos.length) : 50;
      const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=${limit}&key=${this.apiKey}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;

      const plRes = await fetch(plUrl);
      if (!plRes.ok) throw new Error(`API Error: ${plRes.status} ${plRes.statusText}`);
      const plData = await plRes.json();

      if (!plData.items) break;

      const videoIds = plData.items.map((item: any) => item.contentDetails.videoId);

      // Fetch durations
      if (videoIds.length > 0) {
        const vidUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(',')}&key=${this.apiKey}`;
        const vidRes = await fetch(vidUrl);
        const vidData = await vidRes.json();

        const durationMap = new Map<string, number>();
        if (vidData.items) {
          for (const item of vidData.items) {
            durationMap.set(item.id, this.parseIsoDuration(item.contentDetails.duration));
          }
        }

        for (const item of plData.items) {
          const id = item.contentDetails.videoId;
          allVideos.push({
            id: id,
            title: item.snippet.title,
            duration: durationMap.get(id) || 0
          });
        }
      }

      nextPageToken = plData.nextPageToken;

      if (maxVideos > 0 && allVideos.length >= maxVideos) break;
    } while (nextPageToken);

    return {
      title: channelTitle,
      videos: allVideos
    };
  }

  private parseIsoDuration(duration: string): number {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return 0;

    const hours = (parseInt(match[1]) || 0);
    const minutes = (parseInt(match[2]) || 0);
    const seconds = (parseInt(match[3]) || 0);

    return hours * 3600 + minutes * 60 + seconds;
  }

  private async mintContentWebPO() {
    if (!this.playbackWebPoTokenContentBinding || this.playbackWebPoTokenCreationLock) return;

    this.playbackWebPoTokenCreationLock = true;
    try {
      this.coldStartToken = botguardService.mintColdStartToken(this.playbackWebPoTokenContentBinding);

      if (!botguardService.isInitialized()) await botguardService.reinit();

      if (botguardService.integrityTokenBasedMinter) {
        this.playbackWebPoToken = await botguardService.integrityTokenBasedMinter.mintAsWebsafeString(decodeURIComponent(this.playbackWebPoTokenContentBinding));
      }
    } catch (err) {
      console.error('[TubePlayer]', 'Error minting WebPO token', err);
    } finally {
      this.playbackWebPoTokenCreationLock = false;
    }
  }

  destroy() {
    this.player.destroy();
    this.sabrAdapter?.dispose();
    botguardService.dispose();
    this.ui.destroy();
    this.videoElement.remove();
  }
}
