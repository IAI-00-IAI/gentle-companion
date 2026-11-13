<script lang="ts">
  import Icon from '#lib/Icon.svelte';
  import { t , langStore} from '#lib/i18n.svelte.ts';;
  import { companion } from '#lib/companion.svelte.ts';
  import { errorMessage } from '#lib/toast.svelte.ts';
  import { toasts } from '#lib/toast.svelte.ts';
  import type { SettingsResponse } from './types.ts';

  let { open = $bindable(false) }: { open?: boolean } = $props();
  let dialog = $state<HTMLDialogElement | null>(null);
  let about = $state<SettingsResponse['about'] | null>(null);
  let loading = $state(false);
  let loadError = $state('');

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  $effect(() => {
    if (!open || !companion.isAdmin) return;
    loading = true;
    loadError = '';
    void companion.getSettings()
      .then((settings) => (about = settings.about))
      .catch((error) => (loadError = errorMessage(error)))
      .finally(() => (loading = false));
  });

  async function copyValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toasts.show(t('about.copytoast', { label }), 'success');
    } catch {
      toasts.show(t('about.copyfail'), 'error');
    }
  }

  function close() {
    open = false;
  }
$effect(() => { $langStore; });
</script>

<dialog class="sheet about-sheet" bind:this={dialog} aria-labelledby="about-title" onclose={() => (open = false)} oncancel={(event) => { event.preventDefault(); close(); }} onclick={(event) => { if (event.target === dialog) close(); }}>
  <div class="sheet-grip" aria-hidden="true"></div>
  <header class="sheet-head">
    <div class="head-copy">
      <span class="eyebrow">Gentle Companion</span>
      <h2 id="about-title">{t('about.title')}</h2>
    </div>
    <button class="btn btn-ghost btn-icon" aria-label={t('about.close.aria')} onclick={close}><Icon name="close" /></button>
  </header>
  <div class="sheet-body scroll">
    <div class="status-row">
      <span class="dot {companion.connection}" aria-hidden="true"></span>
      <strong>{({ connecting: t('about.connection.connecting'), online: t('about.connection.online'), offline: t('about.connection.offline'), disconnected: t('about.connection.disconnected'), revoked: t('about.connection.revoked') })[companion.connection]}</strong>
      <span class="badge">{companion.version ? `v${companion.version}` : t('about.version.unavailable')}</span>
    </div>
    {#if companion.connectionError}
      <p class="error" role="alert">{companion.connectionError}</p>
      <button class="btn btn-sm" disabled={companion.connection === 'connecting'} onclick={() => companion.reconnect()}>{t('about.retry')}</button>
    {/if}
    {#if companion.isAdmin}
      {#if loading}<p class="muted">{t('about.loading')}</p>
      {:else if loadError}<p class="error" role="alert">{t('about.loaderror', { error: loadError })}</p>
      {:else if about}
        <dl class="details">
          {#each [
            { label: t('about.adminurl'), value: about.adminUrl },
            { label: t('about.deviceurl'), value: about.deviceUrl },
            { label: t('about.datadir'), value: about.dataDir },
            { label: t('about.tempdir'), value: about.tempDir }
          ] as item (item.label)}
            <div class="detail">
              <dt>{item.label}</dt>
              <dd><code>{item.value}</code><button class="btn btn-ghost btn-sm" aria-label={t('about.copy.aria', { label: item.label })} onclick={() => copyValue(item.value, item.label)}><Icon name="copy" />{t('about.copy')}</button></dd>
            </div>
          {/each}
        </dl>
      {/if}
    {/if}
  </div>
  <footer class="sheet-foot"><button class="btn btn-primary" onclick={close}>{t('about.done')}</button></footer>
</dialog>

<style>
  .about-sheet { padding: 0; }
  .head-copy { display: grid; gap: 4px; flex: 1; min-width: 0; }
  .status-row { display: flex; align-items: center; gap: 10px; padding: 14px; border-radius: var(--radius); background: var(--bg-sunken); }
  .status-row .badge { margin-left: auto; }
  .details { display: grid; gap: 10px; margin: 18px 0 0; }
  .detail { display: grid; gap: 5px; }
  dt { color: var(--text-2); font-size: 0.82rem; font-weight: 650; }
  dd { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin: 0; }
  dd code { overflow-wrap: anywhere; color: var(--text); }
  dd button { flex: none; }
  .error { color: var(--danger); }
</style>
