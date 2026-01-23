import shaka from 'shaka-player/dist/shaka-player.ui';

export function asMap<K, V>(object: Record<string, V>): Map<K, V> {
  const map = new Map<K, V>();
  for (const key of Object.keys(object)) {
    map.set(key as K, object[key]);
  }
  return map;
}

export function createRecoverableError(message: string, info?: Record<string, any>) {
  return new shaka.util.Error(
    shaka.util.Error.Severity.RECOVERABLE,
    shaka.util.Error.Category.NETWORK,
    shaka.util.Error.Code.HTTP_ERROR,
    message,
    { info }
  );
}

export function headersToGenericObject(headers: Headers): Record<string, string> {
  const headersObj: Record<string, string> = {};
  headers.forEach((value, key) => {
    // Since Edge incorrectly returns the header with a leading new line
    // character ('\n'), we trim the header here.
    headersObj[key.trim()] = value;
  });
  return headersObj;
}

export function makeResponse(
  headers: Record<string, string>,
  data: BufferSource,
  status: number,
  uri: string,
  responseURL: string,
  request: shaka.extern.Request,
  requestType: shaka.net.NetworkingEngine.RequestType
): shaka.extern.Response & { originalRequest: shaka.extern.Request } {
  if (status >= 200 && status <= 299 && status !== 202) {
    return {
      uri: responseURL || uri,
      originalUri: uri,
      data,
      status,
      headers,
      originalRequest: request,
      fromCache: !!headers['x-shaka-from-cache']
    };
  }

  let responseText: string | null = null;
  try {
    responseText = shaka.util.StringUtils.fromBytesAutoDetect(data);
  } catch { /* no-op */ }

  const severity = status === 401 || status === 403
    ? shaka.util.Error.Severity.CRITICAL
    : shaka.util.Error.Severity.RECOVERABLE;

  throw new shaka.util.Error(
    severity,
    shaka.util.Error.Category.NETWORK,
    shaka.util.Error.Code.BAD_HTTP_STATUS,
    uri,
    status,
    responseText,
    headers,
    requestType,
    responseURL || uri
  );
}

export function checkExtension(): boolean {
  return 'ytcBridge' in window && (window as any).ytcBridge.installed;
}

export function getInjectedProxyFunction() {
  return (window as any).proxyFetch;
}

// Proxied fetchFunction using https://vps.jonathanburnhams.com/
export async function fetchFunction(input: string | Request | URL, init?: RequestInit, explicitSessionId?: string, explicitCookie?: string, isRetry: boolean = false, explicitProxyUrl?: string): Promise<Response> {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

  if (url.pathname.includes('v1/player')) {
    url.searchParams.set('$fields', 'playerConfig,storyboards,captions,playabilityStatus,streamingData,responseContext.mainAppWebResponseContext.datasyncId,videoDetails.isLive,videoDetails.isLiveContent,videoDetails.title,videoDetails.author,videoDetails.thumbnail');
  }

  // Check for ytcBridge extension
  const proxyFetch = getInjectedProxyFunction();
  if (proxyFetch) {
    const requestInit = {
      ...init,
      headers
    };
    if (url.pathname.includes('initplayback')) {
      return fetch(url.toString(), requestInit);
    }
    return proxyFetch(url.toString(), requestInit);
  }

  // Allow skipping proxy via environment variable (useful for Node.js testing)
  // Check process.env in a safe way for browsers
  let skipProxy = false;
  try {
    if (typeof process !== 'undefined' && process.env && process.env.SKIP_PROXY === 'true') {
      skipProxy = true;
    }
  } catch (e) {
    // ignore
  }

  if (skipProxy) {
    const requestInit = {
      ...init,
      headers
    };
    if (input instanceof Request && !requestInit.method) {
      requestInit.method = input.method;
    }
    return fetch(url.toString(), requestInit);
  }

  const baseUrl = explicitProxyUrl || 'https://vps.jonathanburnhams.com/';
  const proxyUrl = new URL(url.pathname + url.search, baseUrl);

  // FIX: Force player scripts to target www.youtube.com
  // When running on GitHub Pages (e.g. /tube-ts/), relative paths like /s/player/... 
  // get resolved to https://jburnhams.github.io/tube-ts/s/player/...
  // We need to strip the local prefix and force the host to youtube.
  if (url.pathname.includes('/s/player/') || url.pathname.includes('/yts/jsbin/')) {
    proxyUrl.searchParams.set('__host', 'www.youtube.com');

    // Strip common deployment prefixes if present (simple heuristic: find where /s/player starts)
    // or just ensure the path on proxy starts with /s/player
    const scriptPathIndex = url.pathname.indexOf('/s/player/');
    if (scriptPathIndex > -1) {
      proxyUrl.pathname = url.pathname.substring(scriptPathIndex);
    } else {
      const jsbinIndex = url.pathname.indexOf('/yts/jsbin/');
      if (jsbinIndex > -1) {
        proxyUrl.pathname = url.pathname.substring(jsbinIndex);
      }
    }
  } else {
    proxyUrl.searchParams.set('__host', url.host);
  }

  try {
    // Prioritize explicit session ID, then environment variable, then localStorage
    let sessionId: string | null = explicitSessionId || null;
    if (!sessionId && typeof process !== 'undefined' && process.env && process.env.PROXY_SESSION_ID) {
      sessionId = process.env.PROXY_SESSION_ID;
    } else if (!sessionId && typeof window !== 'undefined' && window.localStorage) {
      sessionId = window.localStorage.getItem('tube-ts-session-id');
    }

    if (sessionId) {
      proxyUrl.searchParams.set('session', sessionId);
    }
  } catch {
    // Ignore errors when accessing localStorage (e.g. security restrictions)
  }

  const headersObj: Record<string, string> = {};
  headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  proxyUrl.searchParams.set('__headers', JSON.stringify(headersObj));

  if (explicitCookie) {
    headers.append('h-Cookie', explicitCookie);
  }

  const requestInit = {
    ...init,
    headers,
    credentials: 'include' as RequestCredentials
  };

  if (input instanceof Request) {
    if (!requestInit.method) {
      requestInit.method = input.method;
    }
  }

  if (proxyUrl.hostname === 'vps.jonathanburnhams.com' && isRetry) {
    try {
      const debugUrl = new URL(proxyUrl.toString());
      debugUrl.searchParams.set('debug', '1');

      const debugInit = { ...requestInit };
      // Avoid reusing ReadableStream bodies as they lock on access
      if (debugInit.body && (
        (typeof ReadableStream !== 'undefined' && debugInit.body instanceof ReadableStream) ||
        // Check for stream-like objects (e.g. in some polyfills or Node environments)
        (typeof debugInit.body === 'object' && 'getReader' in (debugInit.body as any))
      )) {
        console.warn('[DEBUG] Omitting body in debug request because it is a stream.');
        delete debugInit.body;
      }

      fetch(debugUrl, debugInit)
        .then(async (res) => {
          const text = await res.text();
          console.log(`[DEBUG] ${debugUrl}: ${res.status} ${res.statusText}`, text);
        })
        .catch((err) => {
          console.error(`[DEBUG] Request failed: ${debugUrl}`, err);
        });
    } catch (e) {
      console.error('[DEBUG] Error initiating debug request', e);
    }
  }

  const response = await fetch(proxyUrl, requestInit);

  const contentType = response.headers.get('content-type');
  // youtubei.js requests return JSON (application/json) or JS (text/javascript).
  // If we get HTML, it's almost certainly a proxy error page or captive portal, even if 200 OK.
  if (contentType && contentType.includes('text/html')) {
    const text = await response.text();
    throw new Error(`Proxy returned HTML (likely error page): ${response.status} ${response.statusText} - ${text.substring(0, 100)}`);
  }

  return response;
}
