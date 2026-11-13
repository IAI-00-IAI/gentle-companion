<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import type { AutomationRun } from './types.ts';
  import { t , langStore} from './i18n.svelte.ts';;
  let { status }: { status: AutomationRun['status'] | 'enabled' | 'disabled' | 'scheduled' | 'manual' } = $props();
  const labels = $derived({
    running: t('automation.run.running'),
    succeeded: t('automation.status.succeeded'),
    failed: t('automation.run.failed'),
    stopped: t('automation.status.stopped'),
    skipped: t('automation.status.skipped'),
    enabled: t('automation.status.enabled'),
    disabled: t('automation.status.disabled'),
    scheduled: t('automation.status.scheduled'),
    manual: t('automation.status.manual')
  });
  const icons: Record<string, IconName> = { succeeded: 'check', failed: 'alert', skipped: 'ban', stopped: 'stop', running: 'activity', enabled: 'check', disabled: 'ban', scheduled: 'refresh', manual: 'user' };
$effect(() => { $langStore; });
</script>
<span class="automation-badge" data-status={status}><Icon name={icons[status]} size={13} />{labels[status]}</span>
<style>
  .automation-badge { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 5px 10px; border: 1px solid var(--border-strong); border-radius: 999px; font-size: .72rem; font-weight: 650; color: var(--text-2); background: var(--surface-2); box-shadow: var(--clay-soft); }
  [data-status='enabled'], [data-status='succeeded'] { color: var(--ok); background: var(--ok-soft); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
  [data-status='running'], [data-status='scheduled'] { color: var(--accent-text); background: var(--accent-soft); border-color: var(--accent-line); }
  [data-status='failed'] { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
</style>
