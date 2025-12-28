import shaka from 'shaka-player/dist/shaka-player.ui.js';
import type { Types } from 'youtubei.js/web';
import { Constants, Innertube, Platform, UniversalCache, Utils, YT } from 'youtubei.js/web';
import { SabrStreamingAdapter } from 'googlevideo/sabr-streaming-adapter';
import { buildSabrFormat } from 'googlevideo/utils';
import { ShakaPlayerAdapter } from './ShakaPlayerAdapter.js';
import { botguardService } from './BotguardService.js';
import 'shaka-player/dist/controls.css';

// Shim for youtubei.js
Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  return new Function(code)();
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
       throw new Error('Shaka Player is not supported on this browser.');
    }

    this.player = new shaka.Player();
    this.ui = new shaka.ui.Overlay(this.player, this.container, this.videoElement);
  }

  async initialize() {
    this.innertube = await Innertube.create({
      cache: new UniversalCache(true),
      fetch: this.fetchFunction.bind(this) // Use our custom fetch wrapper
    });

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

  private async fetchFunction(input: string | Request | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const requestInit = { ...init, headers };

    if (url.pathname.includes('v1/player')) {
      url.searchParams.set('$fields', 'playerConfig,storyboards,captions,playabilityStatus,streamingData,responseContext.mainAppWebResponseContext.datasyncId,videoDetails.isLive,videoDetails.isLiveContent,videoDetails.title,videoDetails.author,videoDetails.thumbnail');
    }

    // Direct fetch since user handles proxy externally
    return fetch(url, requestInit);
  }

  async loadVideo(videoId: string) {
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
      const videoInfo = new YT.VideoInfo([ playerResponse ], this.innertube.actions, cpn);

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

        const parsedInfo = new YT.VideoInfo([ reloadedInfo ], this.innertube!.actions, cpn);
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
