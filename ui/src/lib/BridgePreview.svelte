<script module lang="ts">
  import { companion } from './companion.svelte.ts';
  import { toasts } from './toast.svelte.ts';
  import { RevocationQueue } from './bridge-lease.ts';

  /** Shared by every preview, so a revoke that failed outlives the dialog that wanted it. */
  const revocations = new RevocationQueue((sessionId, path) => companion.bridgeRevoke(sessionId, path), {
    onUnconfirmed: () =>
      toasts.show('Could not confirm that the preview link was closed. Retrying; it also expires on its own within five minutes.', 'error', 8000)
  });
  if (typeof window !== 'undefined') window.addEventListener('online', () => void revocations.flush());
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import { errorMessage } from './toast.svelte.ts';
  import { BridgeLease, type BridgeLink } from './bridge-lease.ts';
  import type { BridgeTarget } from './artifact-preview.ts';
  import type { TempFile } from './types.ts';

  let { target, onfile, onclose }: { target: BridgeTarget; onfile: (file: TempFile) => void; onclose: () => void } = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let busy = $state(false);
  let error = $state('');
  let frame = $state<BridgeLink | undefined>();
  let closing = false;
  let disposed = false;
  /**
   * Keeps the daemon's short lease alive while this preview is open and revokes the link when it
   * ends, even if that happens before the link has arrived. A failed revoke is retried.
   */
  const lease = new BridgeLease({
    sessionId: () => (target.kind === 'bridge-endpoint' ? target.sessionId : ''),
    revocations,
    renew: (sessionId, path) => companion.bridgeRenew(sessionId, path),
    onLost: () => {
      if (disposed || closing) return;
      frame = undefined;
      error = 'This link ended, for example because Pi stopped or sharing was turned off. Open it again to continue.';
    }
  });

  const subject = $derived(target.kind === 'bridge-file' ? target.reference : target.url);
  const title = $derived.by(() => {
    if (target.kind === 'bridge-file') return target.reference.split(/[\\/]/).filter(Boolean).at(-1) ?? target.reference;
    return frame?.origin ?? target.url;
  });

  $effect(() => {
    if (!dialog) return;
    const element = dialog;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      disposed = true;
      closing = true;
      lease.end();
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  });

  function close() {
    if (closing) return;
    closing = true;
    lease.end();
    dialog?.close();
    onclose();
  }

  /** Both buttons fetch; download also saves the copy to this device. */
  async function fetchFile(download: boolean) {
    if (target.kind !== 'bridge-file' || busy) return;
    const { sessionId, reference } = target;
    busy = true;
    error = '';
    try {
      const file = await companion.bridgeFile(sessionId, reference);
      if (download) await companion.downloadFile(sessionId, file);
      if (!disposed) onfile(file);
    } catch (cause) {
      if (!disposed) error = errorMessage(cause);
    } finally {
      if (!disposed) busy = false;
    }
  }

  async function openEndpoint() {
    if (target.kind !== 'bridge-endpoint' || busy) return;
    busy = true;
    error = '';
    try {
      const link = await companion.bridgeEndpoint(target.sessionId, target.url);
      // Closed while the request was in flight: the lease revokes the new link instead of showing it.
      frame = lease.accept(link);
    } catch (cause) {
      if (!disposed) error = errorMessage(cause);
    } finally {
      if (!disposed) busy = false;
    }
  }
</script>

<dialog class="bridge-preview" bind:this={dialog} aria-labelledby="bridge-preview-title" onclose={close} oncancel={(event) => { event.preventDefault(); close(); }} onclick={(event) => { if (event.target === dialog) close(); }}>
  <header class="bridge-header">
    <div class="bridge-heading">
      <span class="eyebrow">Companion bridge</span>
      <h2 id="bridge-preview-title">{title}</h2>
      <p class="bridge-description">
        {#if target.kind === 'bridge-file'}File on the computer running Pi{:else}Server on the computer running Pi{/if}
      </p>
    </div>
    <button type="button" class="btn btn-ghost btn-icon" aria-label="Close" onclick={close}><Icon name="close" /></button>
  </header>

  <div class="bridge-body">
    {#if frame}
      <p class="bridge-note">Relayed through Pi Companion from <code>{frame.origin}</code>. The page is sandboxed: no cookies, no access to Companion. Closing this window ends the link, including any new tab opened from it.</p>
      <iframe class="bridge-frame" title={'Local server: ' + frame.origin} src={frame.path} sandbox="allow-scripts allow-forms allow-modals" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'"></iframe>
    {:else}
      <div class="bridge-confirm">
        <Icon name={target.kind === 'bridge-file' ? 'file' : 'link'} size={28} />
        {#if target.kind === 'bridge-file'}
          <h3>Fetch this file from the computer running Pi?</h3>
          <code class="bridge-address">{subject}</code>
          <p>Companion copies it into this session’s shared files so you can preview or download it here. Only files the agent mentioned, inside the session’s working directory or this session’s Companion folders, can be fetched. Files that look like credentials are skipped, but names cannot catch every secret, so check the path first.</p>
        {:else}
          <h3>Open this local server through Companion?</h3>
          <code class="bridge-address">{subject}</code>
          <p>While it is open, Companion relays this device’s requests to that server on the computer running Pi. Only localhost servers the agent mentioned can be opened. Pages run sandboxed; cookies and WebSockets are not relayed. Closing this window ends the link.</p>
        {/if}
        {#if error}<p class="bridge-error" role="alert"><Icon name="alert" size={16} />{error}</p>{/if}
      </div>
    {/if}
  </div>

  <footer class="bridge-footer">
    {#if frame}
      <a class="btn" href={frame.path} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open in new tab<Icon name="chevron" size={16} /></a>
      <button type="button" class="btn btn-primary" onclick={close}>Close</button>
    {:else if target.kind === 'bridge-file'}
      <button type="button" class="btn" disabled={busy} onclick={close}>Cancel</button>
      <button type="button" class="btn" disabled={busy} onclick={() => fetchFile(true)}><Icon name="download" size={16} />Fetch and download</button>
      <button type="button" class="btn btn-primary" disabled={busy} onclick={() => fetchFile(false)}>{#if busy}Fetching…{:else}Fetch and preview{/if}</button>
    {:else}
      <button type="button" class="btn" disabled={busy} onclick={close}>Cancel</button>
      <button type="button" class="btn btn-primary" disabled={busy} onclick={openEndpoint}><Icon name="link" size={16} />{#if busy}Opening…{:else}Open server{/if}</button>
    {/if}
  </footer>
</dialog>

<style>
  .bridge-preview { width: min(1120px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); margin: auto; padding: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-bento); color: var(--text); background: var(--surface); box-shadow: var(--shadow); overflow: hidden; }
  .bridge-preview[open] { display: flex; flex-direction: column; }
  .bridge-preview::backdrop { background: var(--overlay); }
  .bridge-header, .bridge-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; flex: none; }
  .bridge-header { border-bottom: 1px solid var(--border); }
  .bridge-heading { min-width: 0; display: grid; gap: 4px; }
  .bridge-heading h2 { margin: 0; font-size: 1.15rem; line-height: 1.35; overflow-wrap: anywhere; }
  .bridge-description, .bridge-note { margin: 0; color: var(--text-2); font-size: .84rem; line-height: 1.6; }
  .bridge-body { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .bridge-note { padding: 14px 24px; }
  .bridge-frame { display: block; width: 100%; height: min(66dvh, 720px); border: 0; border-top: 1px solid var(--border); background: white; }
  .bridge-confirm { display: grid; justify-items: center; gap: 12px; padding: 36px 24px; text-align: center; }
  .bridge-confirm :global(.icon) { color: var(--accent-text); }
  .bridge-confirm h3, .bridge-confirm p { margin: 0; }
  .bridge-confirm p { max-width: 62ch; color: var(--text-2); overflow-wrap: anywhere; }
  .bridge-address { display: block; max-width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-sunken); overflow-wrap: anywhere; font-size: .8rem; user-select: text; }
  .bridge-error { display: flex; align-items: center; gap: 8px; color: var(--danger); }
  .bridge-footer { justify-content: flex-end; flex-wrap: wrap; border-top: 1px solid var(--border); background: var(--surface-2); }
  .bridge-preview .btn { min-width: 44px; min-height: 44px; }
  .bridge-header .btn { flex: none; }
  @media (max-width: 600px) {
    .bridge-preview { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border-radius: var(--radius-lg); }
    .bridge-header, .bridge-footer { padding: 16px; gap: 12px; }
    .bridge-footer { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
    .bridge-note { padding: 12px 16px; }
    .bridge-heading h2 { font-size: 1rem; }
    .bridge-footer .btn { flex: 1; }
  }
</style>
