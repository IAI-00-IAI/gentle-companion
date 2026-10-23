import type { TempFile } from './types.ts';
import { previewLink, type PreviewTarget } from './artifact-preview.ts';

type PreviewLinksOptions = {
  sessionId?: string;
  files?: TempFile[];
  loadFiles?: () => Promise<TempFile[]>;
  onpreview: (target: PreviewTarget) => void;
  onerror: (message: string) => void;
};

/** Local paths are identifiers for already-shared uploads, never filesystem requests. */
export function sharedFileTarget(href: string, sessionId: string, files: TempFile[], origin: string): PreviewTarget | undefined {
  const exactPaths = files.filter(file => file.path === href);
  if (exactPaths.length === 1) return { kind: 'file', sessionId, file: exactPaths[0] };
  if (exactPaths.length > 1) return;
  let path = href;
  let url: URL;
  try {
    url = new URL(href, origin);
    if (url.username || url.password) return;
    if (url.protocol === 'file:') {
      if (url.hostname && url.hostname !== 'localhost') return;
      path = decodeURIComponent(url.pathname);
    } else if (url.origin === origin) {
      const endpoint = '/api/sessions/' + encodeURIComponent(sessionId) + '/files/';
      const match = files.find(file => url.pathname === endpoint + encodeURIComponent(file.id));
      if (match) return { kind: 'file', sessionId, file: match };
      path = decodeURIComponent(url.pathname);
    } else {
      return;
    }
  } catch {
    return;
  }
  const matches = files.filter(file => file.path === path || file.name === href);
  if (matches.length === 1) return { kind: 'file', sessionId, file: matches[0] };
}

/** Delegate clicks so newly streamed Markdown gets the same preview policy. */
export function previewLinks(node: HTMLElement, initial: PreviewLinksOptions) {
  let options = initial;
  let request = 0;
  let disposed = false;
  function hardenLinks() {
    for (const link of node.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (link.getAttribute('href')?.startsWith('#')) continue;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
    }
  }
  function click(event: MouseEvent) {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!link || !node.contains(link)) return;
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const selected = options;
    const current = ++request;
    void resolve();
    async function resolve() {
      let target: PreviewTarget | undefined;
      if (selected.sessionId) target = sharedFileTarget(href, selected.sessionId, selected.files ?? [], location.origin);
      if (!target) {
        const url = previewLink(href, location.origin);
        if (url) target = { kind: 'link', url };
      }
      // Direct session navigation can finish before its upload registry arrives.
      // Refresh only that registry, never the destination supplied by the agent.
      if (!target && selected.sessionId && selected.loadFiles) {
        try {
          const files = await selected.loadFiles();
          target = sharedFileTarget(href, selected.sessionId, files, location.origin);
        } catch (cause) {
          let message = 'Could not check this session’s shared files. Reconnect and try the link again.';
          if (cause instanceof Error) message += ' ' + cause.message;
          if (isCurrent()) selected.onerror(message);
          return;
        }
      }
      if (!isCurrent()) return;
      if (target) selected.onpreview(target);
      else selected.onerror('Preview requires a public HTTPS link or a file already shared with this session. Host-local apps and unshared file paths are not opened.');
    }
    function isCurrent() {
      return !disposed && current === request && options.sessionId === selected.sessionId;
    }
  }
  hardenLinks();
  const observer = new MutationObserver(hardenLinks);
  observer.observe(node, { childList: true, subtree: true });
  node.addEventListener('click', click);
  return {
    update(next: PreviewLinksOptions) {
      if (next.sessionId !== options.sessionId) request++;
      options = next;
      hardenLinks();
    },
    destroy() { disposed = true; observer.disconnect(); node.removeEventListener('click', click); }
  };
}
