<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '#lib/Icon.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import '#lib/automation.css';
  import clayIcon from '../../../../../assets/automation-clay.svg';
  import AutomationBadge from '#lib/AutomationBadge.svelte';
  import AutomationDate from '#lib/AutomationDate.svelte';
  import AutomationResult from '#lib/AutomationResult.svelte';
  import { automationTime, automationDuration } from '#lib/automations.ts';
  import { t } from '#lib/i18n.svelte.ts';
  import { errorMessage } from '#lib/toast.svelte.ts';
  import type { AutomationRun } from '#lib/types.ts';
  const id = $derived(page.params.id ?? '');
  const runId = $derived(page.params.runId ?? '');

  function timeText(value: number | null): string {
    const raw = automationTime(value);
    return raw === 'In progress' ? t('automation.time.live') : raw;
  }

  function durationText(start: number, end: number | null): string {
    const raw = automationDuration(start, end);
    return raw === 'In progress' ? t('automation.time.live') : raw;
  }
  let run = $state<AutomationRun | null>(null);
  let error = $state('');
  let mounted = $state(false);
  onMount(() => { mounted = true; return () => { mounted = false; }; });
  $effect(() => {
    if (!mounted) return;
    const url = '/api/automations/' + encodeURIComponent(id) + '/runs/' + encodeURIComponent(runId);
    let alive = true;
    run = null; error = '';
    const refresh = async () => {
      try { const result = await companion.request<AutomationRun>(url); if (alive) { run = result; error = ''; } }
      catch (cause) { if (alive) error = errorMessage(cause); }
    };
    void refresh();
    const timer = setInterval(() => { if (run?.status === 'running' && document.visibilityState === 'visible') void refresh(); }, 3000);
    return () => { alive = false; clearInterval(timer); };
  });
</script>
<svelte:head><title>{t('automation.rundetail.title')} · Gentle Companion</title></svelte:head>
<div class="page automation-workspace">
  <a class="automation-back btn btn-ghost" href={'/automations/' + encodeURIComponent(id)}><Icon name="back" size={16} />{t('automation.rundetail.back')}</a>
  <header class="automation-hero"><div class="hero-copy"><img class="clay-icon" src={clayIcon} alt="" /><div><span class="eyebrow">{t('automation.rundetail.eyebrow')}</span><h1>{t('automation.rundetail.title.page')}</h1><p class="subtle">{t('automation.rundetail.subtitle')}</p></div></div>{#if run}<AutomationBadge status={run.status} />{/if}</header>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if run}
    <section class="bento-card"><div class="run-metadata"><AutomationDate value={run.startedAt} /><dl class="info-pairs"><div><dt><Icon name="calendar" size={13} /> {t('automation.rundetail.started')}</dt><dd class="primary">{timeText(run.startedAt)}</dd></div><div><dt><Icon name="check" size={13} /> {t('automation.rundetail.finished')}</dt><dd class="primary">{timeText(run.finishedAt)}</dd></div><div><dt><Icon name="clock" size={13} /> {t('automation.rundetail.duration')}</dt><dd class="primary">{durationText(run.startedAt, run.finishedAt)}</dd></div></dl></div>{#if run.sessionId}<a class="btn" style="margin-top: 18px" href={'/sessions/' + encodeURIComponent(run.sessionId)}><Icon name="sessions" />{t('automation.rundetail.viewsession')}</a>{/if}</section>
    <div class="bento-card"><AutomationResult text={run.result} running={run.status === 'running'} /></div>
  {:else if !error}<div class="panel state" role="status">{t('automation.rundetail.loading')}</div>{/if}
</div>
<style>
  .run-metadata { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; } .run-metadata dl { flex: 1; margin: 0; grid-template-columns: repeat(3, minmax(0, 1fr)); } .state { padding: 32px; text-align: center; } @media(max-width: 550px) { .run-metadata { gap: 16px; } .run-metadata dl { grid-template-columns: 1fr; gap: 12px; } }
</style>
