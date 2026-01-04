import shaka from 'shaka-player/dist/shaka-player.ui';
import type { Types, YT } from 'youtubei.js/web';
import { Constants, Innertube, Platform, UniversalCache, Utils, YT as YTUtils } from 'youtubei.js/web';
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
      console.warn('[TubePlayer] nFunction not exported, skipping n transformation. Available exports:', data.exported);
      // We must throw here to trigger the retry logic in initialize(), which adds a cache-busting timestamp.
      // Otherwise we get a broken player that fails later at deciphering.
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

  async initialize(options?: { useProxy?: boolean }) {
    let retryCount = 0;
    const maxRetries = 3;
    const useProxy = options?.useProxy ?? true;

    while (retryCount < maxRetries) {
      try {
        const fetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
          // Even on first try, we might want to catch player/base.js and timestamp it?
          // The current structure only enters this block if retryCount > 0.
          // Let's refactor to check URL regardless of retryCount for player scripts.

          let urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
          if (urlStr.includes('player') || urlStr.includes('base.js')) {
            const urlObj = new URL(urlStr);
            // Always add timestamp to prevent caching old/bad player scripts
            urlObj.searchParams.set('t', String(Date.now()));

            // If we are skipping proxy, we still want to apply the timestamp, 
            // but we use native fetch (or default behavior) instead of fetchFunction
            if (!useProxy) return fetch(urlObj.toString(), init);
            return fetchFunction(urlObj.toString(), init);
          }

          if (!useProxy) {
            return fetch(input, init);
          }
          return fetchFunction(input, init);
        };

        this.innertube = await Innertube.create({
          cache: new UniversalCache(retryCount === 0),
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
      console.error('[TubePlayer]', 'Error:', e);
      throw e;
    }
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
