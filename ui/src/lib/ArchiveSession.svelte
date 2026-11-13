<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from './Icon.svelte';
  import { companion } from './companion.svelte.ts';
  import { sessionTitle } from './format.ts';
  import { t , langStore} from './i18n.svelte.ts';;
  import { errorMessage, toasts } from './toast.svelte.ts';
  import type { Session } from './types.ts';

  let { session, redirect = false, label = t('session.detail.archive.label') }: { session: Session; redirect?: boolean; label?: string } = $props();
  let busy = $state(false);

  async function archive() {
    if (busy || session.status !== 'stopped') return;
    if (!confirm(t('session.detail.archive.confirm', { name: sessionTitle(session) }))) return;
    busy = true;
    try {
      await companion.archiveSession(session.id);
      toasts.show(t('session.detail.archive.toast'), 'success');
      if (redirect) await goto('/sessions');
    } catch (error) {
      toasts.show(errorMessage(error), 'error');
      void companion.refreshSessions().catch(() => {});
    } finally {
      busy = false;
    }
  }
$effect(() => { $langStore; });
</script>

<button
  class="archive btn btn-ghost btn-sm"
  disabled={busy || session.status !== 'stopped'}
  title={session.status === 'stopped' ? t('session.detail.archive.title.disabled') : t('session.detail.archive.title.working')}
  aria-label={label + ': ' + sessionTitle(session)}
  onclick={archive}><Icon name="archive" size={16} />{busy ? t('session.detail.archive.busy') : label}</button>

<style>
  .archive { min-height: 44px; justify-content: flex-start; }
  .archive:not(:disabled) { color: var(--danger); }
</style>
