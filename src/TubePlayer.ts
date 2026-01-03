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

  if (env.n) {
    properties.push(`n: exportedVars.nFunction(${JSON.stringify(String(env.n))})`);
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(String(env.sig))})`);
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

  async initialize() {
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        const fetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
          if (retryCount > 0) {
            let url: URL;
            if (typeof input === 'string') {
              url = new URL(input);
            } else if (input instanceof Request) {
              url = new URL(input.url);
            } else {
              url = input;
            }

            if (url.toString().includes('player') || url.toString().includes('base.js')) {
              url.searchParams.set('t', String(Date.now()));
              const response = await fetchFunction(url.toString(), init);

              // Workaround for truncated player script from proxy
              const text = await response.text();
              const TRUNCATED_SUFFIX = 'hm=function(S,W,m){m=m===void 0?0';
              if (text.trim().endsWith(TRUNCATED_SUFFIX)) {
                // Remove the truncated line and close the IIFE
                const patchedText = text.substring(0, text.lastIndexOf(TRUNCATED_SUFFIX)) + '})();';
                return new Response(patchedText, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers
                });
              }

              return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
            }
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
      const videoInfo = new YTUtils.VideoInfo([ playerResponse ], this.innertube.actions, cpn);

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

        const parsedInfo = new YTUtils.VideoInfo([ reloadedInfo ], this.innertube!.actions, cpn);
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
