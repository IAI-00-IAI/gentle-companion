<script lang="ts">
  import Icon from './Icon.svelte';
  import { companion } from './companion.svelte.ts';
  import { errorMessage } from './toast.svelte.ts';
  import { blocksEmbedding, filePreviewKind, htmlSnapshot, imagePreviewMime, MAX_PREVIEW_BYTES, previewLink, type FilePreviewKind, type PreviewTarget } from './artifact-preview.ts';

  let { target, onclose }: { target: PreviewTarget; onclose: () => void } = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let loading = $state(false);
  let loadError = $state('');
  let downloadBusy = $state(false);
  let fileKind = $state<FilePreviewKind | undefined>();
  let content = $state('');
  let imageUrl = $state('');
  let websiteRequested = $state(false);
  let fullscreen = $state(false);
  let closing = false;
  let disposed = false;
  const safeUrl = $derived.by(() => {
    if (target.kind !== 'link') return undefined;
    if (typeof location === 'undefined') return undefined;
    return previewLink(target.url, location.origin);
  });
  const embeddingBlocked = $derived(safeUrl ? blocksEmbedding(safeUrl) : false);
  const title = $derived.by(() => {
    if (target.kind === 'file') return target.file.name;
    if (safeUrl) return new URL(safeUrl).hostname;
    return 'Website preview unavailable';
  });

  const showFullscreenToggle = $derived((target.kind === 'link' && websiteRequested) || fileKind === 'html' || fileKind === 'image');

  $effect(() => {
    if (!dialog) return;
    const element = dialog;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      disposed = true;
      closing = true;
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  });

  $effect(() => {
    const selected = target;
    const controller = new AbortController();
    let objectUrl = '';
    loading = false;
    downloadBusy = false;
    loadError = '';
    content = '';
    imageUrl = '';
    fileKind = undefined;
    websiteRequested = false;
    if (selected.kind === 'file') {
      const selectedFile = selected.file;
      const sessionId = selected.sessionId;
      const kind = filePreviewKind(selectedFile);
      fileKind = kind;
      if (kind) {
        loading = true;
        void load();
      }
      async function load() {
        try {
          const path = '/api/sessions/' + encodeURIComponent(sessionId) + '/files/' + encodeURIComponent(selectedFile.id);
          const blob = await companion.request<Blob>(path, { signal: controller.signal }, 60_000, 'blob');
          if (controller.signal.aborted) return;
          if (blob.size > MAX_PREVIEW_BYTES) throw new Error('This file exceeds the 2 MiB preview limit. Download the original instead.');
          if (kind === 'image') {
            const image = new Blob([blob], { type: imagePreviewMime(selectedFile) });
            objectUrl = URL.createObjectURL(image);
            imageUrl = objectUrl;
          } else {
            const text = await blob.text();
            if (controller.signal.aborted) return;
            if (kind === 'html') content = htmlSnapshot(text);
            else content = text;
          }
        } catch (cause) {
          if (!controller.signal.aborted) loadError = errorMessage(cause);
        } finally {
          if (!controller.signal.aborted) loading = false;
        }
      }
    }
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });

  function close() {
    if (closing) return;
    closing = true;
    dialog?.close();
    onclose();
  }

  async function download() {
    if (target.kind !== 'file') return;
    const selected = target;
    downloadBusy = true;
    try {
      await companion.downloadFile(selected.sessionId, selected.file);
    } catch (cause) {
      if (!disposed && target === selected) loadError = errorMessage(cause);
    } finally {
      if (!disposed && target === selected) downloadBusy = false;
    }
  }
</script>

<dialog class="artifact-preview" class:fullscreen bind:this={dialog} aria-labelledby="artifact-preview-title" aria-describedby="artifact-preview-description" onclose={close} oncancel={(event) => { event.preventDefault(); if (fullscreen) fullscreen = false; else close(); }} onclick={(event) => { if (event.target === dialog) close(); }}>
  <header class="preview-header">
    <div class="preview-heading">
      <span class="eyebrow">Preview</span>
      <h2 id="artifact-preview-title">{title}</h2>
      <p id="artifact-preview-description" class="preview-description">
        {#if target.kind === 'file'}Session-shared file · read-only preview
        {:else}External website · isolated from Pi Companion{/if}
      </p>
    </div>
    <div class="preview-actions">
      {#if showFullscreenToggle}
        <button type="button" class="btn btn-ghost btn-icon" aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} aria-pressed={fullscreen} onclick={() => fullscreen = !fullscreen}><Icon name={fullscreen ? 'minimize' : 'maximize'} /></button>
      {/if}
      <button type="button" class="btn btn-ghost btn-icon" aria-label="Close preview" onclick={close}><Icon name="close" /></button>
    </div>
  </header>
  <div class="preview-body">
    {#if target.kind === 'link'}
      {#if safeUrl}
        <div class="website-controls">
          <code class="preview-address">{safeUrl}</code>
          <p class="preview-note">Your browser contacts this website directly. The site may receive your IP address and existing cookies. Companion does not open or control the host browser.</p>
          {#if embeddingBlocked}
            <p class="preview-note">This site does not allow itself to be shown inside another page, so a preview would stay blank. Open it in your browser instead.</p>
            <a class="btn btn-primary" href={safeUrl} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><Icon name="link" size={16} />Open in browser</a>
          {:else}
            {#if !websiteRequested}<button type="button" class="btn btn-primary" onclick={() => websiteRequested = true}><Icon name="link" size={16} />Load website preview</button>{/if}
            <p class="preview-note">Some sites block embedding or require features this sandbox disables. A blank or incomplete frame does not mean the site is unavailable.</p>
            <a class="btn" href={safeUrl} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open in new tab<Icon name="chevron" size={16} /></a>
          {/if}
        </div>
        {#if websiteRequested}
          <iframe class="preview-frame" title={'Website preview: ' + title} src={safeUrl} sandbox="allow-scripts" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'"></iframe>
        {/if}
      {:else}
        <div class="preview-message"><Icon name="ban" size={28} /><h3>This link cannot be previewed</h3><p>Only HTTPS links with non-local domain names are supported. Local addresses, IP literals, credentials, and Companion’s own origin are excluded.</p></div>
      {/if}
    {:else if loading}
      <div class="preview-message" role="status"><Icon name="file" size={28} /><p>Loading shared file…</p></div>
    {:else if loadError}
      <div class="preview-message" role="alert"><Icon name="alert" size={28} /><h3>Preview unavailable</h3><p>{loadError}</p></div>
    {:else if fileKind === 'html'}
      <p class="preview-note snapshot-note">Static HTML snapshot. Scripts, links, forms, and network requests are disabled. External assets are not loaded.</p>
      <iframe class="preview-frame" title={'Static HTML preview: ' + title} srcdoc={content} sandbox="" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'"></iframe>
    {:else if fileKind === 'image'}
      <div class="preview-image"><img src={imageUrl} alt={'Preview of ' + title} onerror={() => loadError = 'The file could not be decoded as a supported image. Download the original instead.'} /></div>
    {:else if fileKind === 'text'}
      <pre class="preview-text">{content}</pre>
    {:else}
      <div class="preview-message"><Icon name="file" size={28} /><h3>Download to view this file</h3><p>In-app previews support standalone HTML, plain-text formats, and raster images up to 2 MiB. PDFs and other binary files remain downloads.</p></div>
    {/if}
  </div>
  <footer class="preview-footer">
    {#if target.kind === 'file'}<button type="button" class="btn" disabled={downloadBusy} onclick={download}><Icon name="download" size={16} />{#if downloadBusy}Downloading…{:else}Download original{/if}</button>{/if}
    <button type="button" class="btn btn-primary" onclick={close}>Close preview</button>
  </footer>
</dialog>

<style>
  .artifact-preview { width: min(1120px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); margin: auto; padding: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-bento); color: var(--text); background: var(--surface); box-shadow: var(--shadow); overflow: hidden; }
  .artifact-preview[open] { display: flex; flex-direction: column; }
  .artifact-preview::backdrop { background: var(--overlay); }
  .preview-header, .preview-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; flex: none; }
  .preview-header { border-bottom: 1px solid var(--border); }
  .preview-heading { min-width: 0; display: grid; gap: 4px; }
  .preview-heading h2 { margin: 0; font-size: 1.15rem; line-height: 1.35; overflow-wrap: anywhere; }
  .preview-description, .preview-note { margin: 0; color: var(--text-2); font-size: .84rem; line-height: 1.6; }
  .preview-body { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .website-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 20px 24px; }
  .website-controls .preview-note, .preview-address { flex-basis: 100%; }
  .preview-address { display: block; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-sunken); overflow-wrap: anywhere; font-size: .8rem; user-select: text; }
  .preview-frame { display: block; width: 100%; min-height: min(62dvh, 680px); border: 0; border-top: 1px solid var(--border); background: white; }
  .snapshot-note { padding: 14px 24px; }
  .preview-message { display: grid; justify-items: center; gap: 12px; padding: 44px 24px; text-align: center; }
  .preview-message :global(.icon) { color: var(--accent-text); }
  .preview-message h3, .preview-message p { margin: 0; }
  .preview-message p { max-width: 62ch; color: var(--text-2); overflow-wrap: anywhere; }
  .preview-image { display: grid; place-items: center; min-height: 160px; padding: 20px; background: var(--bg-sunken); }
  .preview-image img { display: block; max-width: 100%; max-height: 65dvh; object-fit: contain; }
  .preview-text { margin: 0; padding: 24px; color: var(--text); background: var(--code-bg); font: .84rem/1.65 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
  .preview-footer { justify-content: flex-end; flex-wrap: wrap; border-top: 1px solid var(--border); background: var(--surface-2); }
  .artifact-preview .btn { min-width: 44px; min-height: 44px; }
  .preview-header .btn { flex: none; }
  .preview-actions { display: flex; align-items: center; gap: 4px; flex: none; }
  .artifact-preview.fullscreen { width: 100vw; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
  .artifact-preview.fullscreen .preview-body { flex: 1; display: flex; flex-direction: column; overflow: auto; }
  .artifact-preview.fullscreen .preview-frame { flex: 1; min-height: 60dvh; }
  @media (max-width: 600px) {
    .artifact-preview { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border-radius: var(--radius-lg); }
    .preview-header, .preview-footer, .website-controls { padding: 16px; gap: 12px; }
    .preview-footer { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
    .snapshot-note { padding: 12px 16px; }
    .preview-heading h2 { font-size: 1rem; }
    .preview-text { padding: 16px; }
    .preview-footer .btn { flex: 1; }
  }
</style>
