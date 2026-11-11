<script lang="ts">
  import Icon from './Icon.svelte';
  import { companion } from './companion.svelte.ts';
  import { t } from './i18n.svelte.ts';
</script>

{#if companion.connectionError}
  <section class="connection-notice" role="alert" aria-label={t('shell.connection.error.aria')}>
    <Icon name="unplug" size={18} />
    <div class="copy">
      <strong>{companion.bootError ? t('shell.connection.error.title') : t('shell.connection.error.interrupted')}</strong>
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
    </div>
    <button class="btn btn-sm" disabled={companion.connection === 'connecting'} onclick={() => companion.reconnect()}>
      {companion.connection === 'connecting' ? t('shell.connection.error.retrying') : t('shell.connection.error.retry')}
    </button>
  </section>
{/if}

<style>
  .connection-notice { flex: none; display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--accent-soft); }
  .connection-notice > :global(svg) { flex: none; margin-top: 3px; color: var(--accent-text); }
  .copy { flex: 1; min-width: 0; font-size: 0.85rem; }
  strong { display: block; margin-bottom: 3px; }
  p { margin: 0; overflow-wrap: anywhere; }
  .muted { margin-top: 4px; font-size: 0.8rem; }
  button { flex: none; min-height: 44px; }
  details { margin-top: 6px; }
  summary { cursor: pointer; width: fit-content; min-height: 32px; padding: 5px 0; font-weight: 600; }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin-bottom: 4px; }
  @media (max-width: 420px) { .connection-notice { padding: 10px; gap: 8px; } }
</style>
