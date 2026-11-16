/** One live socket, bounded retries, and liveness checks (including silent network loss). */
export type Connection = 'connecting' | 'online' | 'offline' | 'disconnected' | 'revoked';

export interface LiveSocketMessage {
  /** String for text frames; binary frames stay bytes (companion only sends/receives text). */
  data: string | Uint8Array;
}

/**
 * Minimal socket surface LiveConnection uses. Satisfied by the browser WebSocket
 * (local/remote modes) and by the tunnel mode's DeferredTunnelSocket, which is
 * created synchronously while its tunnel dial resolves in the background. The
 * handler types use the browser event shapes; LiveConnection only reads
 * `event.data` and `event.code`, and the tunnel socket's wrapper satisfies them.
 */
export interface LiveSocket {
  readyState: number;
  send(data: string): void;
  close(): unknown;
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onclose: ((event: CloseEvent) => unknown) | null;
}

export class LiveConnection {
  private socket: LiveSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private retryMs = 1000;
  private paused = false;
  private running = false;

  private readonly hooks: {
    enabled: () => boolean;
    create: () => LiveSocket;
    state: (state: Connection) => void;
    online: () => void;
    message: (data: string) => void;
    lost: () => void;
    revoked: () => void;
  };

  constructor(hooks: {
    enabled: () => boolean;
    create: () => LiveSocket;
    state: (state: Connection) => void;
    online: () => void;
    message: (data: string) => void;
    lost: () => void;
    revoked: () => void;
  }) {
    this.hooks = hooks;
  }

  start() {
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    this.clearTimers();
    this.retire();
  }

  /** Only an explicit user retry may undo a deliberate disconnect. */
  reconnect() {
    this.paused = false;
    this.retryMs = 1000;
    this.running = true;
    this.replace();
  }

  /** A phone waking up may have an OPEN socket whose underlying network is gone. */
  resume() {
    if (!this.running || this.paused || !this.hooks.enabled()) return;
    this.retryMs = 1000;
    this.replace();
  }

  revoke() {
    this.paused = true;
    this.clearTimers();
    this.retire();
    this.hooks.state('revoked');
  }

  send(text: string) {
    if (this.socket?.readyState !== 1) return false;
    try {
      this.socket.send(text);
      return true;
    } catch {
      this.fail(this.socket);
      return false;
    }
  }

  private clearTimers() {
    clearTimeout(this.retry);
    clearTimeout(this.watchdog);
  }

  private retire() {
    const socket = this.socket;
    this.socket = null; // Late open/message/close callbacks cannot mutate a new connection.
    socket?.close();
  }

  private replace() {
    this.clearTimers();
    this.retire();
    this.connect();
  }

  private connect() {
    if (!this.running || this.paused || !this.hooks.enabled() || this.socket) return;
    clearTimeout(this.retry);
    this.hooks.state('connecting');
    let socket: LiveSocket;
    try {
      socket = this.hooks.create();
    } catch {
      this.hooks.state('offline');
      this.schedule();
      return;
    }
    this.socket = socket;
    this.arm(socket, 15_000); // A handshake must not stay CONNECTING forever.
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.retryMs = 1000;
      this.hooks.state('online');
      this.arm(socket, 45_000);
      this.hooks.online();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.arm(socket, 45_000);
      this.hooks.message(String(event.data));
    };
    socket.onerror = () => this.fail(socket);
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      clearTimeout(this.watchdog);
      this.socket = null;
      if (event.code === 4003) {
        this.revoke();
        this.hooks.revoked();
      } else if (event.code === 4001) {
        this.paused = true;
        this.clearTimers();
        this.hooks.state('disconnected');
      } else {
        this.hooks.state('offline');
        this.hooks.lost();
        this.schedule();
      }
    };
  }

  private arm(socket: LiveSocket, delay: number) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail(socket), delay);
  }

  private fail(socket: LiveSocket) {
    if (this.socket !== socket) return;
    clearTimeout(this.watchdog);
    this.retire();
    this.hooks.state('offline');
    this.hooks.lost();
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.retry);
    if (!this.running || this.paused || !this.hooks.enabled()) return;
    this.retry = setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 15_000);
  }
}
