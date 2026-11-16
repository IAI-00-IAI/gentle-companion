export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class WorkspaceConnectionError extends Error {}

export function unreachableMessage(online = typeof navigator === 'undefined' || navigator.onLine !== false) {
  return online
    ? 'Cannot reach your workspace. The tunnel may be closed, or the workspace or daemon may be unavailable.'
    : 'Your device is offline. Connect to the internet to reach your workspace.';
}

/**
 * Alternative transport for workspaceRequest: performs one request and resolves to a
 * Response. The tunnel mode (tailcat-transport.ts) injects one so requests ride the
 * tailcat tunnel; when omitted, workspaceRequest uses plain fetch exactly as before.
 * responseType is passed so a transport can refuse shapes it cannot carry (e.g. binary
 * downloads over the tunnel shim).
 */
export type RequestTransport = (path: string, init: RequestInit, responseType: 'json' | 'blob') => Promise<Response>;

/** Never expose a reverse proxy's HTML error page as an API error or JSON parse error. */
export async function workspaceRequest<T>(path: string, init: RequestInit = {}, timeoutMs?: number, responseType: 'json' | 'blob' = 'json', transport?: RequestTransport): Promise<T> {
  // Tunnel dials are slow (DERP relay handshake: 0.5-6s observed) and every tunnel
  // request pays one; the LAN default of 10s aborts them mid-flight (net::ERR_ABORTED)
  // and the UI drops to 'interrupted' despite a healthy WS. 30s still bounds a hung
  // stream while leaving room for two slow dials (retry + response).
  const timeout = timeoutMs ?? (transport ? 30_000 : 10_000);
  const deadline = AbortSignal.timeout(timeout);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  try {
    const response = transport
      ? await transport(path, { ...init, signal }, responseType)
      : await fetch(path, { ...init, signal, cache: 'no-store' });
    if ([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530].includes(response.status)) {
      throw new WorkspaceConnectionError(`Workspace unavailable (HTTP ${response.status}). The tunnel or its connection to your workspace may be down.`);
    }
    if (!response.ok) {
      const text = await response.text();
      const html = response.headers.get('content-type')?.includes('text/html') || /<!doctype|<html|<head/i.test(text);
      const message = html ? '' : text.replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new ApiError(response.status, message || `The workspace rejected this request (HTTP ${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    if (responseType === 'blob') {
      if (!/^attachment\b/i.test(response.headers.get('content-disposition') ?? '')) {
        throw new WorkspaceConnectionError('The workspace did not return a file download. Check the tunnel and retry.');
      }
      return await response.blob() as T;
    }
    if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
      throw new WorkspaceConnectionError('This address did not return a workspace response. Check that the tunnel is running and you opened the current Gentle Companion URL.');
    }
    try {
      return await response.json() as T;
    } catch (error) {
      if (signal.aborted) throw error;
      throw new WorkspaceConnectionError('The workspace returned an unreadable response. Check the tunnel and retry the connection.');
    }
  } catch (error) {
    // Caller cancellation is not a connection failure.
    if (init.signal?.aborted) throw error;
    if (error instanceof ApiError || error instanceof WorkspaceConnectionError) throw error;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new WorkspaceConnectionError(unreachableMessage(false));
    if (deadline.aborted) {
      throw new WorkspaceConnectionError('The workspace did not respond in time. Check your network and that the tunnel and Gentle Companion daemon are running.');
    }
    throw new WorkspaceConnectionError(unreachableMessage());
  }
}
