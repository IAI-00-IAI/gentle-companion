<script lang="ts">
$langStore;
  import { onMount, type Component } from 'svelte';
  import gentleLogo from '../assets/gentle-logo.png';
  import heroShell from '../assets/hero-shell.png';
  import heroChanges from '../assets/hero-changes.png';
  import bulbClay from '../assets/clay/bulb.webp';
  import chatBubbleClay from '../assets/clay/chat-bubble.webp';
  import computerClay from '../assets/clay/computer.webp';
  import Icon, { type IconName } from '#lib/Icon.svelte';
  import '#lib/automation.css';
  import automationArt from '../assets/automation-clay.svg';
  import AutomationTable from '#lib/AutomationTable.svelte';
  import PullToRefresh from '#lib/PullToRefresh.svelte';
  import { errorMessage } from '#lib/toast.svelte.ts';
  import type { Automation } from '#lib/types.ts';
  import SessionCard from '#lib/SessionCard.svelte';
  import SessionTable from '#lib/SessionTable.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import { t , langStore} from '#lib/i18n.svelte.ts';;

  // The dot field opens on the Gentle Companion mark, then cycles computer → phone → terminal.
  const art = [gentleLogo, heroShell, heroChanges];
  let visual = $state<HTMLDivElement | null>(null);
  let DotField = $state<Component<any> | null>(null);

  const live = $derived(companion.sessions.filter((session) => session.status !== 'stopped'));
  const needsAnswer = $derived(live.filter((session) => companion.pendingAsks(session.id) > 0));
  let runningFilter = $state<'all' | 'active' | 'idle'>('all');
  const liveNow = $derived(
    live.filter((session) => companion.pendingAsks(session.id) === 0 && (runningFilter === 'all' || session.status === runningFilter))
      .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
      .slice(0, 6)
  );
  const working = $derived(companion.sessions.filter((session) => session.status === 'active').length);
  const waiting = $derived(Object.values(companion.asks).reduce((n, list) => n + list.length, 0));
  const connected = $derived(companion.devices.filter((d) => d.connected).length);
  const totalSessions = $derived(companion.sessions.length);
  let automations = $state<Automation[]>([]);
  let automationError = $state('');
  let automationLoading = $state(true);
  let automationFilter = $state<'all' | 'enabled' | 'disabled'>('all');
  const recentAutomations = $derived(automations.filter(a => automationFilter === 'all' || a.enabled === (automationFilter === 'enabled'))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4));
  let overviewMounted = $state(false);
  onMount(() => { overviewMounted = true; return () => { overviewMounted = false; }; });
  $effect(() => {
    if (!overviewMounted || !companion.booted || !companion.paired) return;
    let alive = true;
    const refresh = async () => {
      try {
        const result = await companion.request<{ automations: Automation[] }>('/api/automations');
        if (alive) { automations = result.automations; automationError = ''; }
      } catch (cause) { if (alive) automationError = errorMessage(cause); }
      finally { if (alive) automationLoading = false; }
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000);
    return () => { alive = false; clearInterval(timer); };
  });

  async function refreshOverview() {
    await Promise.all([companion.refresh(), (async () => {
      try { automations = (await companion.request<{ automations: Automation[] }>('/api/automations')).automations; automationError = ''; }
      catch (cause) { automationError = errorMessage(cause); throw cause; }
    })()]);
  }

  type Stat = { label: string; value: number | string; hint: string; icon: IconName; href: string };
  const stats = $derived<Stat[]>([
    { label: t('stat.running.label'), value: live.length, hint: working ? t('stat.running.hint.busy', { count: working }) : t('stat.running.hint.quiet'), icon: 'sessions', href: '/sessions' },
    { label: t('stat.waiting.label'), value: waiting, hint: waiting ? t('stat.waiting.hint.busy') : t('stat.waiting.hint.idle'), icon: 'question', href: '/sessions' },
    ...(companion.isAdmin
      ? [
          { label: t('stat.devices.label'), value: companion.devices.length, hint: connected ? t('stat.devices.hint.online', { count: connected }) : companion.devices.length ? t('stat.devices.hint.none') : t('stat.devices.hint.no'), icon: 'devices' as IconName, href: '/devices' },
          { label: t('stat.phone.label'), value: companion.sessions.filter((s) => s.remoteEnabled && s.status !== 'stopped').length, hint: t('stat.phone.hint'), icon: 'link' as IconName, href: '/sessions' }
        ]
      : [])
  ]);



  onMount(() => {
    // The canvas is decorative: load it after first paint and when the browser is idle.
    const load = () => void import('#lib/DotField.svelte').then((module) => (DotField = module.default));
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(load, { timeout: 800 });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  });
</script>

<svelte:head><title>Overview · Gentle Companion</title></svelte:head>

<div class="page">
  <PullToRefresh onrefresh={refreshOverview} />
  <section class="hero card">
    {#if DotField}
      <DotField
        images={art}
        anchor={visual}
        className="hero-field"
        label={t('hero.field.label')} />
    {/if}
    <div class="hero-copy">
      <span class="eyebrow">{companion.isAdmin ? t('hero.eyebrow.admin') : t('hero.eyebrow.linked')}</span>
      <h1>{t('hero.title')}<br /><span class="accent">{t('hero.accent')}</span></h1>
      <p>{t('hero.body')}</p>
      <div class="cta">
        <a class="btn btn-primary" href="/sessions"><Icon name="sessions" />{t('hero.cta.sessions')}</a>
        <a class="btn" href="/help"><Icon name="help" />{t('hero.cta.help')}</a>
        {#if companion.isAdmin}
          <a class="btn" href="/devices"><Icon name="devices" />{t('hero.cta.devices')}</a>
        {/if}
      </div>
      <ol class="journey" aria-label={t('hero.journey.label')}>
        <li>{t('hero.journey.1')}</li>
        <li>{t('hero.journey.2')}</li>
        <li>{t('hero.journey.3')}</li>
      </ol>

    </div>
    <div class="hero-visual" bind:this={visual} aria-hidden="true"></div>
  </section>

  <section class="stats" aria-label="At a glance">
    {#each stats as stat (stat.label)}
      <a class="stat tile" href={stat.href}>
        <span class="stat-icon"><Icon name={stat.icon} /></span>
        <span class="stat-label">{stat.label}</span>
        <span class="badge count">{stat.value}</span>
        <span class="subtle">{stat.hint}</span>
      </a>
    {/each}
  </section>
  <section class="guide-tile tile" aria-labelledby="guide-heading">
    <span class="guide-art"><img src={bulbClay} alt="" aria-hidden="true" /></span>
    <div class="guide-copy">
      <h2 id="guide-heading">{t('guide.title')}</h2>
      <p>{t('guide.body')}</p>
    </div>
    <a class="btn guide-action" href="/help">{t('guide.cta')}<Icon name="chevron" size={16} /></a>
  </section>


  {#if needsAnswer.length}
    <section class="recent" aria-labelledby="needs-answer-heading">
      <div class="section-head">
        <h2 id="needs-answer-heading"><img src={chatBubbleClay} alt="" aria-hidden="true" />{t('needs.title')}</h2>
      </div>
      <div class="session-grid">
        {#each needsAnswer as session (session.id)}<SessionCard {session} highlighted />{/each}
      </div>
    </section>
  {/if}

  <section class="recent home-panel" aria-labelledby="live-heading">
    <div class="panel-topline"><div class="section-head"><h2 id="live-heading"><img src={computerClay} alt="" aria-hidden="true" />{t('running.title')}</h2><p class="subtle">{t('running.sub')}</p></div>
      <a class="btn view-all" href="/sessions">{t('running.viewall')}<span class="badge count quiet">{totalSessions}</span><Icon name="chevron" size={16} /></a></div>
    <div class="panel-controls" role="group" aria-label={t('running.filter.label')}>
      {#each [{ value: 'all', label: t('running.filter.all') }, { value: 'active', label: t('running.filter.working') }, { value: 'idle', label: t('running.filter.idle') }] as option}
        <button class="btn" class:active={runningFilter === option.value} aria-pressed={runningFilter === option.value} onclick={() => runningFilter = option.value as typeof runningFilter}>{option.label}</button>
      {/each}
    </div>
    {#if live.length}
      {#if liveNow.length}
        <SessionTable sessions={liveNow} label={t('running.title')} />
      {:else}
        <p class="muted panel-empty">{runningFilter === 'all' ? t('running.empty.waiting') : t('running.empty.nomatch')}</p>
      {/if}
    {:else}
      <div class="tile empty">
        <span class="empty-icon"><img src={computerClay} alt="" aria-hidden="true" /></span>
        {#if companion.connection !== 'online'}
          <h2>{t('running.empty.unreachable.title')}</h2>
          <p>{t('running.empty.unreachable.body')}</p>
        {:else if companion.isAdmin}
          <h2>{t('running.empty.norunning.title')}</h2>
          <p>{t('running.empty.norunning.body')}</p>
        {:else}
          <h2>{t('running.empty.noshared.title')}</h2>
          <p>{t('running.empty.noshared.body')}</p>
        {/if}
        <a class="btn" href="/help"><Icon name="help" />{t('guide.cta')}</a>
      </div>
    {/if}
  </section>
  <section class="recent automation-workspace home-panel" aria-labelledby="home-automation-heading">
    <div class="panel-topline"><div class="section-head"><h2 id="home-automation-heading"><img src={automationArt} alt="" width="38" height="38" />{t('automations.title')}</h2><p class="subtle">{t('automations.sub')}</p></div>
      <a class="btn view-all" href="/automations">{t('automations.viewall')}<span class="badge count quiet">{automations.length}</span><Icon name="chevron" size={16} /></a></div>
    <div class="panel-controls" role="group" aria-label={t('automations.filter.label')}>
      {#each [{ value: 'all', label: t('automations.filter.all') }, { value: 'enabled', label: t('automations.filter.enabled') }, { value: 'disabled', label: t('automations.filter.disabled') }] as option}
        <button class="btn" class:active={automationFilter === option.value} aria-pressed={automationFilter === option.value} onclick={() => automationFilter = option.value as typeof automationFilter}>{option.label}</button>
      {/each}
    </div>
    {#if automationError}<div class="bento-card" role="alert">{t('automations.error', { error: automationError })}</div>
    {:else if automationLoading}<div class="bento-card" role="status">{t('automations.loading')}</div>
    {:else if !automations.length}<div class="bento-card automation-empty"><Icon name="lightning" size={28} /><h2>{t('automations.empty.title')}</h2><p>{t('automations.empty.body')}</p><a class="btn" href="/automations">{t('automations.cta')}<Icon name="chevron" size={16} /></a></div>
    {:else if !recentAutomations.length}<p class="muted panel-empty">{t('automations.empty.nomatch')}</p>
    {:else}<AutomationTable automations={recentAutomations} />{/if}
  </section>
</div>

<style>
  .hero {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    min-height: 400px;
    background:
      radial-gradient(circle at 78% 50%, var(--accent-soft), transparent 55%),
      var(--surface);
  }

  .hero :global(.hero-field) {
    --accent: var(--dot-color);
    z-index: 0;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 30%, #000 100%);
    mask-image: linear-gradient(90deg, transparent 0, #000 30%, #000 100%);
  }

  .hero-copy {
    position: relative;
    z-index: 1;
    display: grid;
    align-content: center;
    gap: 16px;
    padding: 40px;
  }

  .hero h1 {
    font-size: clamp(2rem, 3.6vw, 3rem);
    letter-spacing: -0.035em;
    line-height: 1.04;
  }

  .accent {
    color: var(--accent-text);
  }

  .hero p {
    color: var(--text-2);
    font-size: 1.02rem;
    max-width: 48ch;
  }

  .cta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 4px;
  }

  .journey {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    font: 600 0.72rem/1 var(--mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .journey li:not(:last-child)::after {
    content: '→';
    margin-left: 6px;
    color: var(--accent-text);
  }

  .hero-visual {
    position: relative;
    z-index: 1;
    min-height: 360px;
    margin: 20px 28px 20px 0;
    pointer-events: none;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  .stat {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'icon label' 'value value' 'hint hint';
    align-items: center;
    gap: 4px 10px;
    padding: 16px;
    text-decoration: none;
    transition: border-color 150ms var(--ease);
  }

  .stat:hover {
    border-color: var(--accent-line);
  }

  .stat-icon {
    grid-area: icon;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .stat-label {
    grid-area: label;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-2);
  }

  .stat .badge {
    grid-area: value;
    justify-self: start;
    margin-top: 8px;
  }

  .stat .subtle {
    grid-area: hint;
    font-size: 0.82rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
  }

  .session-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .home-panel { display: grid; gap: 14px; padding: 20px; border: 1px solid var(--border); border-radius: 24px; background: var(--clay-surface); box-shadow: var(--clay-raised); min-width: 0; }
  .panel-topline { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
  .panel-topline .section-head { display: grid; gap: 2px; margin: 0; }
  .panel-topline .section-head h2 { margin: 0; }
  .panel-topline .section-head p { font-size: .78rem; }
  .panel-controls { display: flex; gap: 6px; padding: 5px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); width: fit-content; max-width: 100%; }
  .panel-controls .btn { min-height: 38px; border-color: transparent; background: transparent; border-radius: 10px; padding-inline: 14px; font-size: .78rem; }
  .panel-controls .btn.active { background: var(--surface); border-color: var(--border); color: var(--accent-text); box-shadow: var(--clay-soft); font-weight: 700; }
  .panel-empty { border: 1px dashed var(--border-strong); border-radius: 16px; background: var(--surface); padding: 22px; font-size: .85rem; }
  .home-panel :global(.session-table), .home-panel :global(.routine-table) { background: var(--surface); }
  @media (max-width: 600px) { .home-panel { padding: 14px; border-radius: 20px; } .panel-topline { align-items: stretch; } .panel-topline .view-all { width: 100%; } .panel-controls { width: 100%; } .panel-controls .btn { flex: 1; padding-inline: 8px; } }


  .guide-tile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 18px;
    padding: 20px;
    border-radius: 22px;
    box-shadow: var(--clay-raised);
  }
  .guide-art { display: grid; place-items: center; width: 68px; height: 68px; border-radius: 20px; background: var(--accent-soft); box-shadow: var(--clay-pressed); }
  .guide-art img, .section-head h2 img, .empty .empty-icon img { filter: sepia(0.55) saturate(1.65) hue-rotate(350deg); }
  .guide-art img { width: 58px; height: 58px; object-fit: contain; }
  .guide-copy { display: grid; gap: 6px; min-width: 0; }
  .guide-copy h2 { font-size: 1.05rem; line-height: 1.35; }
  .guide-copy p { max-width: 54ch; margin: 0; color: var(--text-2); font-size: 0.9rem; line-height: 1.6; }
  .guide-action, .view-all { min-height: 44px; padding: 11px 16px; border-radius: 16px; background: var(--surface-2); box-shadow: var(--clay-soft); }
  .guide-action:hover, .view-all:hover { border-color: var(--accent-line); background: var(--surface-3); }
  .guide-action:active, .view-all:active { box-shadow: var(--clay-pressed); }
  .section-head h2 { display: flex; align-items: center; gap: 10px; }
  .section-head h2 img { width: 48px; height: 48px; object-fit: contain; flex: none; }
  .empty .empty-icon img { width: 64px; height: 64px; object-fit: contain; }
  .empty .btn { justify-self: start; }
  @media (max-width: 600px) {
    .guide-tile { grid-template-columns: auto minmax(0, 1fr); gap: 14px; padding: 16px; }
    .guide-art { width: 54px; height: 54px; border-radius: 16px; }
    .guide-art img { width: 46px; height: 46px; }
    .guide-action { grid-column: 1 / -1; width: 100%; justify-content: center; }
    .guide-copy p { font-size: 0.85rem; }
    .view-all { width: 100%; justify-content: center; }
    .section-head { gap: 10px; }
  }
  @media (max-width: 900px) {
    .hero {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: 240px auto;
      min-height: 0;
    }

    .hero :global(.hero-field) {
      -webkit-mask-image: linear-gradient(180deg, #000 0, #000 45%, transparent 75%);
      mask-image: linear-gradient(180deg, #000 0, #000 45%, transparent 75%);
    }

    .hero-visual {
      grid-row: 1;
      min-height: 0;
      margin: 16px 16px 0;
    }

    .hero-copy {
      grid-row: 2;
      padding: 8px 20px 24px;
      gap: 12px;
    }

  }

  @media (max-width: 520px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .stat {
      padding: 12px;
    }


    .cta .btn {
      flex: 1;
    }
  }
</style>
