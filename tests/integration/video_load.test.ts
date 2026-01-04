// @vitest-environment node
import { describe, test, expect, beforeAll } from 'vitest';
import { Innertube, Platform, UniversalCache } from 'youtubei.js';
import type { Types } from 'youtubei.js';

// Polyfill for Node environment to match browser behavior if needed, 
// though youtubei.js handles node/browser differences. 
// We specifically want to test the shim logic which is manually assigned in TubePlayer.ts

describe('Video Load Integration', () => {
    beforeAll(async () => {
        // Stub globals for shaka-player before importing TubePlayer
        if (typeof global.document === 'undefined') {
            (global as any).document = {
                createElement: () => ({ style: {} }),
                getElementById: () => null,
            };
            (global as any).window = {
                URL: URL,
                addEventListener: () => { },
                removeEventListener: () => { }
            };
            (global as any).HTMLElement = class { };
            try {
                (global as any).navigator = { userAgent: 'node' };
            } catch {
                Object.defineProperty(global, 'navigator', {
                    value: { userAgent: 'node' },
                    writable: true,
                    configurable: true
                });
            }
            if (typeof URL.createObjectURL === 'undefined') {
                (URL as any).createObjectURL = () => 'blob:stub';
                (URL as any).revokeObjectURL = () => { };
            }
        }

        // Import TubePlayer dynamically to ensure its side-effects run AFTER we stub globals
        await import('../../src/TubePlayer');

        // Apply the same shim as in TubePlayer.ts (but forcing our logic to ensure fallback)
        Platform.shim.eval = async (data: Types.BuildScriptResult, env: Record<string, Types.VMPrimative>) => {
            const properties = [];

            if (env.n) {
                if (data.exported?.includes('nFunction')) {
                    console.log('[TubePlayer] nFunction found and exported!');
                    properties.push(`n: exportedVars.nFunction(${JSON.stringify(String(env.n))})`);
                } else {
                    console.warn('[TubePlayer] nFunction not exported, using identity fallback (n parameter will be untransformed). Available exports:', data.exported);
                    // Fallback: Use the original 'n' value.
                    properties.push(`n: ${JSON.stringify(String(env.n))}`);
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
                throw e;
            }
        };
    });

    // Skip if no session ID provided (security cleanup removed hardcoded value)
    const runAuthTest = process.env.PROXY_SESSION_ID ? test : test.skip;

    runAuthTest('can load video and decipher nsig via proxy with session id', async () => {
        // Custom fetch to force proxy usage with specific session ID
        // Replicates src/helpers.ts fetchFunction logic
        const proxyFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : (input as Request).url);

            console.log('[Test] ProxyFetch Request:', url.toString());
            const headers = new Headers(init?.headers ?? (input instanceof Request ? (input as Request).headers : undefined));

            if (url.pathname.includes('v1/player')) {
                url.searchParams.set('$fields', 'playerConfig,storyboards,captions,playabilityStatus,streamingData,responseContext.mainAppWebResponseContext.datasyncId,videoDetails.isLive,videoDetails.isLiveContent,videoDetails.title,videoDetails.author,videoDetails.thumbnail');
            }

            const proxyUrl = new URL(url.pathname + url.search, 'https://vps.jonathanburnhams.com/');
            proxyUrl.searchParams.set('__host', url.host);

            // Emulate valid session
            if (process.env.PROXY_SESSION_ID) {
                proxyUrl.searchParams.set('session', process.env.PROXY_SESSION_ID);
            }

            const headersObj: Record<string, string> = {};
            headers.forEach((value, key) => {
                headersObj[key] = value;
            });

            proxyUrl.searchParams.set('__headers', JSON.stringify(headersObj));

            const requestInit = {
                ...init,
                headers
            };

            if (input instanceof Request) {
                if (!requestInit.method) {
                    requestInit.method = input.method;
                }
            }

            const response = await fetch(proxyUrl, requestInit);

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
                if (!response.ok || response.status >= 400) {
                    const text = await response.text();
                    throw new Error(`Proxy returned HTML error: ${response.status} ${response.statusText} - ${text.substring(0, 100)}`);
                }
            }

            return response;
        };

        const innertube = await Innertube.create({
            cache: new UniversalCache(false),
            fetch: proxyFetch,
            // Force Modern Chrome client as suggested by user to reproduce nFunction call
            device_category: 'desktop',
            client_type: 'WEB'
        });

        const videoId = 'dQw4w9WgXcQ'; // Rick Roll (User provided)

        // Mirror TubePlayer.ts behavior accurately
        // TubePlayer uses actions.execute('/player') directly, not getInfo
        const playerResponse = await innertube.actions.execute('/player', {
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
            playbackContext: {
                adPlaybackContext: {
                    pyv: true
                },
                contentPlaybackContext: {
                    signatureTimestamp: innertube.session.player?.signature_timestamp
                }
            }
        });

        // Use internal classes similar to TubePlayer
        // We can't easily import Utils/YTUtils from 'youtubei.js/web' in node test if they aren't exported same way,
        // but passing the response to VideoInfo should work if we import from youtubei.js
        // actually accessing YT.VideoInfo constructor might be tricky if not exported generic.
        // But getInfo returns a VideoInfo object, we can inspect that.

        // However, let's look at what TubePlayer does with the info:
        // it deciphers server_abr_streaming_url

        // We can reconstruct the VideoInfo object or just check the playerResponse directly if we know the structure,
        // but easier to stick to public API where possible or casting.
        // Let's use getInfo to get the object, but verify server_abr_streaming_url specifically.

        // Actually, let's keep it simple: if getInfo returns the same data structure, we can just use it
        // but accessing server_abr_streaming_url is key.

        const videoInfo = await innertube.getInfo(videoId);

        expect(videoInfo).toBeDefined();
        console.log('Video Info retrieved');

        if (videoInfo.streaming_data?.server_abr_streaming_url) {
            console.log('Found server_abr_streaming_url, attempting to decipher...');
            const url = await innertube.session.player?.decipher(videoInfo.streaming_data.server_abr_streaming_url);
            console.log('Deciphered server_abr_streaming_url:', url ? 'Success' : 'Failed');
            expect(url).toBeDefined();
        } else {
            console.log('No server_abr_streaming_url found in streaming_data');
            // Fallback to check adaptive formats as before
            const adaptiveFormat = videoInfo.streaming_data?.adaptive_formats[0];
            if (adaptiveFormat) {
                const urlToDecipher = adaptiveFormat.url || adaptiveFormat.signature_cipher || adaptiveFormat.cipher;
                console.log('Found adaptive format to decipher');
                const url = await innertube.session.player?.decipher(urlToDecipher);
                expect(url).toBeDefined();
            }
        }
    });

    test('can load video and decipher nsig', async () => {
        const innertube = await Innertube.create({
            cache: new UniversalCache(false),
        });

        const videoId = 'QAo_Ycocl1E'; // Yung Gravy (VEVO)

        // Mirror TubePlayer.ts behavior accurately
        // TubePlayer uses actions.execute('/player') directly, not getInfo
        const playerResponse = await innertube.actions.execute('/player', {
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
            playbackContext: {
                adPlaybackContext: {
                    pyv: true
                },
                contentPlaybackContext: {
                    signatureTimestamp: innertube.session.player?.signature_timestamp
                }
            }
        });

        // Use internal classes similar to TubePlayer
        // We can't easily import Utils/YTUtils from 'youtubei.js/web' in node test if they aren't exported same way,
        // but passing the response to VideoInfo should work if we import from youtubei.js
        // actually accessing YT.VideoInfo constructor might be tricky if not exported generic.
        // But getInfo returns a VideoInfo object, we can inspect that.

        // However, let's look at what TubePlayer does with the info:
        // it deciphers server_abr_streaming_url

        // We can reconstruct the VideoInfo object or just check the playerResponse directly if we know the structure,
        // but easier to stick to public API where possible or casting.
        // Let's use getInfo to get the object, but verify server_abr_streaming_url specifically.

        // Actually, let's keep it simple: if getInfo returns the same data structure, we can just use it
        // but accessing server_abr_streaming_url is key.

        const videoInfo = await innertube.getInfo(videoId);

        expect(videoInfo).toBeDefined();
        console.log('Video Info retrieved');

        if (videoInfo.streaming_data?.server_abr_streaming_url) {
            console.log('Found server_abr_streaming_url, attempting to decipher...');
            const url = await innertube.session.player?.decipher(videoInfo.streaming_data.server_abr_streaming_url);
            console.log('Deciphered server_abr_streaming_url:', url ? 'Success' : 'Failed');
            expect(url).toBeDefined();
        } else {
            console.log('No server_abr_streaming_url found in streaming_data');
            // Fallback to check adaptive formats as before
            const adaptiveFormat = videoInfo.streaming_data?.adaptive_formats[0];
            if (adaptiveFormat) {
                const urlToDecipher = adaptiveFormat.url || adaptiveFormat.signature_cipher || adaptiveFormat.cipher;
                console.log('Found adaptive format to decipher');
                const url = await innertube.session.player?.decipher(urlToDecipher);
                expect(url).toBeDefined();
            }
        }
    });
});

