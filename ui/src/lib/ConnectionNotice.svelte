<script lang="ts">
  import Icon from './Icon.svelte';
  import { companion } from './companion.svelte.ts';
  import { t , langStore} from './i18n.svelte.ts';;
  import { diagDump } from './diagnostics.ts';
  let diagCopied = $state(false);
  // Collapsed by default during transient retries: the notice is a thin strip
  // (title + retry state) that expands on tap. It never blocks the page: the
  // user reported the full notice covering a working client on the phone.
  let collapsed = $state(true);
  let wasConnected = false;
  let diagText = $state('');
  $effect(() => { $langStore; });
  // Auto-collapse again once the connection recovers.
  $effect(() => {
    const online = companion.connection === 'online';
    if (online && !wasConnected) collapsed = true;
    wasConnected = online;
  });
  async function copyDiagnostics() {
    const dump = diagDump();
    try {
      await navigator.clipboard.writeText(dump);
      diagCopied = true; setTimeout(() => { diagCopied = false; }, 2000);
      return;
    } catch {
      // Clipboard API needs a secure context; on a LAN HTTP origin, show the
      // dump in a selectable area instead so the user can still hand-copy it.
      diagText = dump; diagCopied = false;
    }
  }
$effect(() => { $langStore; });
</script>

{#if companion.connectionError}
  <section class="connection-notice" class:collapsed role="alert" aria-label={t('shell.connection.error.aria')}>
    <button class="notice-head" type="button" onclick={() => (collapsed = !collapsed)} aria-expanded={!collapsed}>
      <Icon name="unplug" size={18} />
      <strong>{companion.bootError ? t('shell.connection.error.title') : t('shell.connection.error.interrupted')}</strong>
      <span class="chev">{collapsed ? '▸' : '▾'}</span>
    </button>
    {#if !collapsed}
      <div class="copy">
        {#if companion.certificateUntrusted}
          <!-- A rejected certificate and an unreachable host look identical to fetch, so
               this states the likelihood and offers the fix, instead of claiming certainty. -->
          <p class="certificate-hint">{t('shell.connection.certificate.hint')}</p>
          {#if companion.certificateUrl}
            <a class="btn btn-sm btn-primary" href={companion.certificateUrl}>{t('shell.connection.certificate.download')}</a>
          {/if}
          <details>
            <summary>{t('shell.connection.certificate.how')}</summary>
            <ol>
              <li>{t('shell.connection.certificate.step.download')}</li>
              <li>{t('shell.connection.certificate.step.install')}</li>
              <li>{t('shell.connection.certificate.step.reload')}</li>
            </ol>
            <p class="muted">{t('shell.connection.certificate.firefox')}</p>
          </details>
        {/if}
        <p>{companion.connectionError}</p>
        {#if !companion.bootError}<p class="muted">{t('shell.connection.error.note')}</p>{/if}
        <details>
          <summary>{t('shell.connection.error.summary')}</summary>
          <ul>
            <li>{t('shell.connection.error.steps.check')}</li>
            <li>{t('shell.connection.error.steps.tunnel')}</li>
            <li>{t('shell.connection.error.steps.companion')}</li>
            <li>{t('shell.connection.error.steps.url')}</li>
          </ul>
          <p>{t('shell.connection.error.paired')}</p>
        </details>
        <button class="btn btn-sm" disabled={companion.connection === 'connecting'} onclick={() => companion.reconnect()}>
          {companion.connection === 'connecting' ? t('shell.connection.error.retrying') : t('shell.connection.error.retry')}
        </button>
        <button class="btn btn-sm btn-ghost" onclick={copyDiagnostics}>{diagCopied ? t('shell.connection.error.diag.copied') : t('shell.connection.error.diag')}</button>
        {#if diagText}
          <textarea class="diag-dump" readonly rows={8} onclick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}>{diagText}</textarea>
          <p class="muted">{t('shell.connection.error.diag.manual')}</p>
        {/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .connection-notice { flex: none; display: flex; flex-direction: column; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--accent-soft); }
  .notice-head { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 0; background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; min-height: 44px; }
  .notice-head :global(svg) { flex: none; color: var(--accent-text); }
  .notice-head strong { flex: 1; font-size: 0.85rem; }
  .chev { flex: none; opacity: 0.7; }
  .connection-notice:not(.collapsed) { padding-bottom: 12px; }
  .copy { min-width: 0; font-size: 0.85rem; }
  .copy p { margin: 0 0 3px; overflow-wrap: anywhere; }
  .muted { margin-top: 4px; font-size: 0.8rem; }
  .copy button { min-height: 44px; margin-right: 8px; margin-top: 6px; }
  details { margin-top: 6px; }
  summary { cursor: pointer; width: fit-content; min-height: 32px; padding: 5px 0; font-weight: 600; }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin-bottom: 4px; }
  @media (max-width: 420px) { .connection-notice { padding: 0 10px; } .connection-notice:not(.collapsed) { padding-bottom: 10px; } }
</style>
