import type { TempFile } from './types.ts';
import { codeBridgeReference, linkBridgeReference, previewLink, type BridgeReference, type PreviewTarget } from './artifact-preview.ts';

const REFERENCE_ATTRIBUTE = 'data-bridge-ref';

function bridgeTarget(reference: BridgeReference | undefined, sessionId: string | undefined): PreviewTarget | undefined {
  if (!reference || !sessionId) return undefined;
  if (reference.kind === 'endpoint') return { kind: 'bridge-endpoint', sessionId, url: reference.url };
  return { kind: 'bridge-file', sessionId, reference: reference.reference };
}

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
    if (!options.sessionId) return;
    // Inline `code` that names a file or localhost server becomes an actionable reference.
    for (const code of node.querySelectorAll<HTMLElement>('code')) {
      if (code.closest('pre') || code.closest('a')) continue;
      if (!codeBridgeReference(code.textContent ?? '')) continue;
      code.setAttribute(REFERENCE_ATTRIBUTE, (code.textContent ?? '').trim());
      code.setAttribute('role', 'link');
      code.setAttribute('tabindex', '0');
      code.classList.add('bridge-ref');
    }
  }
  /** The reference a click or key press refers to: a link's href, or marked inline code. */
  function referenceAt(source: EventTarget | null): string | undefined {
    const element = source as Element | null;
    const link = element?.closest<HTMLAnchorElement>('a[href]');
    if (link && node.contains(link)) return link.getAttribute('href') ?? '';
    const code = element?.closest<HTMLElement>(`code[${REFERENCE_ATTRIBUTE}]`);
    if (code && node.contains(code)) return code.getAttribute(REFERENCE_ATTRIBUTE) ?? '';
    return undefined;
  }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const code = (event.target as Element | null)?.closest<HTMLElement>(`code[${REFERENCE_ATTRIBUTE}]`);
    if (!code || !node.contains(code)) return;
    event.preventDefault();
    open(code.getAttribute(REFERENCE_ATTRIBUTE) ?? '');
  }
  function click(event: MouseEvent) {
    const href = referenceAt(event.target);
    if (href === undefined || href.startsWith('#')) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open(href);
  }
  function open(href: string) {
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
      // A localhost server needs no upload registry: the daemon checks and the person confirms.
      if (!target) {
        const reference = linkBridgeReference(href);
        if (reference?.kind === 'endpoint') target = bridgeTarget(reference, selected.sessionId);
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
      // Not an upload: it may be a file on the computer running Pi, which the person confirms
      // and the daemon limits to the working directory and the shared temp folder.
      target ??= bridgeTarget(linkBridgeReference(href), selected.sessionId);
      if (!isCurrent()) return;
      if (target) selected.onpreview(target);
      else selected.onerror('Preview supports public HTTPS links, localhost servers and files the agent mentioned. This link is none of those.');
    }
    function isCurrent() {
      return !disposed && current === request && options.sessionId === selected.sessionId;
    }
  }
  hardenLinks();
  const observer = new MutationObserver(hardenLinks);
  observer.observe(node, { childList: true, subtree: true });
  node.addEventListener('click', click);
  node.addEventListener('keydown', keydown);
  return {
    update(next: PreviewLinksOptions) {
      if (next.sessionId !== options.sessionId) request++;
      options = next;
      hardenLinks();
    },
    destroy() { disposed = true; observer.disconnect(); node.removeEventListener('click', click); node.removeEventListener('keydown', keydown); }
  };
}
