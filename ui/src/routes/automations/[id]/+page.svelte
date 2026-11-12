<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Icon from '#lib/Icon.svelte';
  import AutomationEditor from '#lib/AutomationEditor.svelte';
  import AutomationFlow from '#lib/AutomationFlow.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import '#lib/automation.css';
  import clayIcon from '../../../assets/automation-clay.svg';
  import AutomationBadge from '#lib/AutomationBadge.svelte';
  import AutomationPagination from '#lib/AutomationPagination.svelte';
  import { automationDraft, automationTime, automationSchedule, automationNextRun, automationDuration, automationTriggerState, pageItems } from '#lib/automations.ts';
  import { t } from '#lib/i18n.svelte.ts';
  import { errorMessage } from '#lib/toast.svelte.ts';

  const runLabels = $derived({ queued: t('automation.run.queued'), running: t('automation.run.running'), paused: t('automation.run.paused'), cancelled: t('automation.run.cancelled'), failed: t('automation.run.failed'), completed: t('automation.run.completed') });
  import type { Automation, AutomationDraft, AutomationRun } from '#lib/types.ts';
  const id = $derived(page.params.id ?? '');
  const base = $derived('/api/automations/' + encodeURIComponent(id));
  let automation = $state<Automation | null>(null);
  let runs = $state<AutomationRun[]>([]);
  let loading = $state(true);
  let error = $state('');
  let actionError = $state('');
  let busy = $state(false);
  let editing = $state(false);
  let confirmingDelete = $state(false);
  let desktop = $state(false);
  let tab = $state<'summary' | 'history'>('summary');
  let historyStatus = $state('all');
  let currentPage = $state(1);
  const history = $derived(pageItems([...runs].sort((a, b) => b.startedAt - a.startedAt).filter(r => historyStatus === 'all' || r.status === historyStatus), currentPage));
  const latest = $derived([...runs].sort((a, b) => b.startedAt - a.startedAt)[0]);
  const trigger = $derived(automationTriggerState(automation));
  const tabIndexes = $derived.by(() => {
    if (tab === 'summary') return { summary: 0, history: -1 };
    return { summary: -1, history: 0 };
  });
  function tabKeys(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') tab = 'summary';
    else if (event.key === 'End') tab = 'history';
    else if (tab === 'summary') tab = 'history';
    else tab = 'summary';
    document.getElementById('tab-' + tab)?.focus();
  }
  const canEdit = $derived(companion.isAdmin && desktop);
  const running = $derived(runs.some((run) => run.status === 'running'));

  function triggerText(value: { label: string; description: string }) {
    if (value.label === 'Manual only') return { label: t('automation.trigger.manual'), description: t('automation.trigger.manual.description') };
    if (value.label === 'Schedule paused') return { label: t('automation.trigger.paused'), description: t('automation.trigger.paused.description') };
    return { label: t('automation.trigger.active'), description: t('automation.trigger.active.description') };
  }

  function scheduleText(value: Automation): string {
    const raw = automationSchedule(value.schedule, value.timezone);
    const timezone = value.timezone ?? 'UTC';
    if (raw === 'On demand') return t('automation.schedule.ondemand');
    if (raw.startsWith('Custom schedule')) return t('automation.schedule.custom', { timezone });
    if (raw.startsWith('Every 30 minutes')) return t('automation.schedule.every30', { timezone });
    if (raw.startsWith('Every hour')) return t('automation.schedule.everyhour', { timezone });
    const match = raw.match(/^(Weekdays at |Every day at )(.+)$/);
    if (match) {
      const [times, zone] = match[2].split(' ');
      return t(raw.startsWith('Weekdays') ? 'automation.schedule.weekdays' : 'automation.schedule.daily', { times: times ?? '', timezone: zone ?? timezone });
    }
    return raw;
  }

  function nextRunText(value: string): string {
    if (value === 'Manual only') return t('automation.trigger.manual');
    if (value === 'Scheduling disabled') return t('automation.next.disabled');
    if (value === 'No upcoming occurrence') return t('automation.next.none');
    return value;
  }

  function timeText(value: number | null): string {
    const raw = automationTime(value);
    return raw === 'In progress' ? t('automation.time.live') : raw;
  }

  function durationText(start: number, end: number | null): string {
    const raw = automationDuration(start, end);
    return raw === 'In progress' ? t('automation.time.live') : raw;
  }
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
    const media = window.matchMedia('(min-width: 901px)');
    const update = () => { desktop = media.matches; };
    update(); media.addEventListener('change', update);
    return () => { mounted = false; media.removeEventListener('change', update); };
  });
  $effect(() => {
    if (!mounted) return;
    const url = base;
    let alive = true;
    const refresh = async (initial = false) => {
      if (initial) { loading = true; automation = null; runs = []; error = ''; }
      try {
        const [definition, history] = await Promise.all([companion.request<Automation>(url), companion.request<{ runs: AutomationRun[] }>(url + '/runs')]);
        if (!alive) return;
        automation = definition; runs = history.runs; error = '';
      } catch (cause) { if (alive) error = errorMessage(cause); }
      finally { if (alive) loading = false; }
    };
    void refresh(true);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  });
  async function refresh() {
    const history = await companion.request<{ runs: AutomationRun[] }>(base + '/runs');
    runs = history.runs;
  }
  async function toggleEditor() {
    tab = 'summary'; editing = !editing;
    if (editing) {
      await tick();
      const form = document.getElementById('automation-editor');
      let behavior: ScrollBehavior = 'smooth';
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'instant';
      form?.scrollIntoView({ behavior, block: 'start' });
      form?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    }
  }
  async function save(draft: AutomationDraft) {
    busy = true;
    try {
      automation = await companion.request<Automation>(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      editing = false;
    } finally { busy = false; }
  }
  async function act(action: 'start' | 'stop' | 'toggle' | 'delete') {
    busy = true; actionError = '';
    try {
      if (action === 'delete') { await companion.request(base, { method: 'DELETE' }); await goto('/automations'); }
      else if (action === 'toggle' && automation) await save({ ...automationDraft(automation), enabled: !automation.enabled });
      else { await companion.request(base + '/' + action, { method: 'POST' }); await refresh(); }
    } catch (cause) { actionError = errorMessage(cause); }
    finally { busy = false; }
  }
</script>
<svelte:head><title>{automation?.name ?? t('automation.fallback.title')} · Gentle Companion</title></svelte:head>
<div class="page automation-workspace automation-detail">
  <a class="automation-back btn btn-ghost" href="/automations"><Icon name="back" size={16} />{t('automations.viewall')}</a>
  {#if loading}
    <div class="panel state" role="status">{t('automation.loading')}</div>
  {:else if !automation}
    <div class="panel state" role="alert">{error || t('automation.notfound')}</div>
  {:else}
    <header class="automation-hero detail-header">
      <div class="hero-copy">
        <img class="clay-icon" src={clayIcon} alt="" width="74" height="74" />
        <div>
          <h1>{automation.name}</h1>
          <div class="detail-status-line"><span>{triggerText(trigger).label}</span>{#if running}<AutomationBadge status="running" />{/if}</div>
        </div>
      </div>
      <div class="detail-run-control">
        {#if running}
          <button class="btn" disabled={busy} onclick={() => act('stop')}><Icon name="stop" />{t('automation.run.stop')}</button>
          <p>{t('automation.run.stop.note')}</p>
        {:else}
          <button class="btn btn-primary" disabled={busy} onclick={() => act('start')}><Icon name="send" />{#if busy}{t('automation.run.start.busy')}{:else}{t('automation.run.start')}{/if}</button>
          <p>{t('automation.run.start.note')}</p>
        {/if}
      </div>
    </header>
    {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
    {#if error}<p class="error" role="alert">{t('automation.live.refresh', { error })}</p>{/if}
    <div class="tab-bar" role="tablist" aria-label={t('automation.tabs.aria')}>
      <button id="tab-summary" role="tab" aria-selected={tab === 'summary'} aria-controls="panel-summary" tabindex={tabIndexes.summary} onclick={() => tab = 'summary'} onkeydown={tabKeys}><Icon name="plan" size={16} />{t('automation.tab.overview')}</button>
      <button id="tab-history" role="tab" aria-selected={tab === 'history'} aria-controls="panel-history" tabindex={tabIndexes.history} onclick={() => tab = 'history'} onkeydown={tabKeys}><Icon name="activity" size={16} />{t('automation.tab.history')} · {runs.length}</button>
    </div>
    {#if tab === 'summary'}
      <div id="panel-summary" role="tabpanel" aria-labelledby="tab-summary" tabindex="0" class="detail-overview">
        <div class="detail-status-grid">
          <section class="bento-card detail-trigger" class:primary={false} aria-labelledby="trigger-title">
            <div class="detail-section-head"><h2 id="trigger-title">{triggerText(trigger).label}</h2><Icon name="refresh" size={20} /></div>
            <p class="automation-note">{triggerText(trigger).description}</p>
            {#if automation.schedule}
              <p class="detail-schedule" class:primary={false}>{scheduleText(automation)}</p>
              <dl class="info-pairs"><div class="primary"><dt>{t('automation.trigger.next')}</dt><dd>{nextRunText(automationNextRun(automation))}</dd></div><div><dt>{t('automation.trigger.timezone')}</dt><dd>{automation.timezone ?? 'UTC'}</dd></div><div class="detail-wide"><dt>{t('automation.trigger.cron')}</dt><dd><code>{automation.schedule}</code></dd></div></dl>
              {#if canEdit}<button class="btn detail-schedule-toggle" aria-pressed={automation.enabled} disabled={busy} onclick={() => act('toggle')}><Icon name="refresh" size={15} />{#if automation.enabled}{t('automation.schedule.toggle.pause')}{:else}{t('automation.schedule.toggle.resume')}{/if}</button>{/if}
            {/if}
          </section>
          <section class="bento-card detail-latest" aria-labelledby="latest-title">
            <div class="detail-section-head"><h2 id="latest-title">{t('automation.latest')}</h2>{#if latest}<AutomationBadge status={latest.status} />{/if}</div>
            {#if latest}
              <dl class="info-pairs"><div><dt>{t('automation.rundetail.started')}</dt><dd class="primary">{timeText(latest.startedAt)}</dd></div><div><dt>{t('automation.rundetail.duration')}</dt><dd class="primary">{durationText(latest.startedAt, latest.finishedAt)}</dd></div></dl>
              <a class="btn detail-result-link" href={'/automations/' + encodeURIComponent(id) + '/runs/' + encodeURIComponent(latest.id)}>{#if latest.status === 'running'}{t('automation.latest.view.live')}{:else}{t('automation.latest.view.details')}{/if}<Icon name="chevron" size={16} /></a>
            {:else}
              <p class="detail-empty-title">{t('automation.latest.empty.title')}</p>
              <p class="automation-note">{t('automation.latest.empty.body')}</p>
            {/if}
          </section>
        </div>
        <section class="bento-card detail-execution" aria-labelledby="execution-title">
          <h2 id="execution-title">{t('automation.execution.title')}</h2>
          <p class="automation-note">{t('automation.execution.note')}</p>
          <AutomationFlow {automation} />
          <div class="detail-execution-notes">
            <div><h3>{t('automation.execution.retries')}</h3><p>{#if automation.maxRetries}{t('automation.execution.retries.text', { maxRetries: automation.maxRetries, interval: automation.retryIntervalSeconds ?? 10 })}[:else]{t('automation.execution.retries.none')}{/if}</p></div>
            <div><h3>{t('automation.execution.finalizers')}</h3><p>{t('automation.execution.finalizers.text')}</p></div>
          </div>
          <p class="detail-host-note"><Icon name="alert" size={16} /><span>{t('automation.execution.host')}</span></p>
        </section>
        <section class="bento-card detail-definition" aria-labelledby="definition-title">
          <div class="detail-definition-head"><div><h2 id="definition-title">{t('automation.definition.title')}</h2><p class="automation-note">{t('automation.definition.updated', { time: timeText(automation.updatedAt) })}</p></div>
            {#if canEdit}<div class="automation-actions"><button class="btn" aria-expanded={editing} disabled={busy} aria-controls="automation-editor" onclick={toggleEditor}><Icon name="file" size={15} />{#if editing}{t('automation.definition.close')}{:else}{t('automation.definition.edit')}{/if}</button><button class="btn btn-danger" disabled={busy || running} onclick={() => confirmingDelete = true}><Icon name="trash" size={15} />{t('automation.definition.delete')}</button></div>{/if}
          </div>
          {#if !canEdit}<p class="automation-note detail-access-note">{#if companion.isAdmin}{t('automation.definition.access.admin')}{:else}{t('automation.definition.access.device')}{/if}</p>{/if}
          {#if confirmingDelete && canEdit}<section class="detail-delete-confirm" aria-label={t('automation.delete.confirm')}><p>{t('automation.delete.confirm')}</p><div class="actions"><button class="btn btn-danger" disabled={busy || running} onclick={() => act('delete')}>{t('automation.definition.delete')}</button><button class="btn" disabled={busy} onclick={() => confirmingDelete = false}>{t('automation.delete.cancel')}</button></div></section>{/if}
          {#if editing && canEdit}<div id="automation-editor" class="detail-editor"><AutomationEditor {automation} {busy} onsave={save} oncancel={() => editing = false} /></div>{/if}
          <details class="script-view"><summary>{t('automation.json.summary')}</summary><pre>{JSON.stringify(automationDraft(automation), null, 2)}</pre></details>
        </section>
      </div>
    {:else}
      <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" tabindex="0" class="bento-card collection">
        <div class="collection-toolbar"><div><h2>{t('automation.history.title')}</h2><p class="subtle">{t('automation.history.note', { limit: automation.historyLimit ?? 30 })}</p></div><label class="filter-field">{t('automation.history.filter')}<select bind:value={historyStatus} onchange={() => currentPage = 1}><option value="all">{t('automation.history.filter.all')}</option>{#each Object.entries(runLabels) as [value, label]}<option {value}>{label}</option>{/each}</select></label></div>
        <div class="collection-scroll" role="region" aria-label={t('automation.history.scroll.aria')}>
          {#if !history.total}
            <div class="automation-empty"><Icon name="activity" size={28} />{#if runs.length}<h2>{t('automation.history.empty.matching.title')}</h2><p>{t('automation.history.empty.matching.body')}</p>{:else}<h2>{t('automation.latest.empty.title')}</h2><p>{t('automation.history.empty.none.body')}</p>{/if}</div>
          {:else}
            <div class="routine-table clay"><table aria-label={t('automation.history.title')}><thead><tr><th scope="col">{t('automation.history.table.started')}</th><th scope="col">{t('automation.history.table.duration')}</th><th scope="col">{t('automation.history.table.status')}</th><th scope="col"><span class="sr-only">{t('automation.history.table.open')}</span></th></tr></thead><tbody>{#each history.items as run (run.id)}<tr><td class="title-cell"><a class="row-link" href={'/automations/' + encodeURIComponent(id) + '/runs/' + encodeURIComponent(run.id)} class:primary={false}>{timeText(run.startedAt)}</a></td><td data-label={t('automation.history.table.duration')}>{durationText(run.startedAt, run.finishedAt)}</td><td class="status-cell"><AutomationBadge status={run.status} /></td><td class="arrow-cell" aria-hidden="true"><span class="row-arrow"><Icon name="chevron" size={16} /></span></td></tr>{/each}</tbody></table></div>
          {/if}
        </div>
        <AutomationPagination page={history.page} pages={history.pages} total={history.total} onchange={value => currentPage = value} />
      </div>
    {/if}
  {/if}
</div>
<style>
  .state { padding: 32px; text-align: center; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
</style>
