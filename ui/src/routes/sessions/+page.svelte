<script lang="ts">
$langStore;
  import Icon from '#lib/Icon.svelte';
  import SessionCard from '#lib/SessionCard.svelte';
  import PageHero from '#lib/PageHero.svelte';
  import PullToRefresh from '#lib/PullToRefresh.svelte';
  import clayIcon from '../../assets/clay/chat-bubble.webp';
  import { companion } from '#lib/companion.svelte.ts';
  import { prettyPath, sessionTitle } from '#lib/format.ts';
  import { t , langStore} from '#lib/i18n.svelte.ts';;
  import type { SessionStatus } from '#lib/types.ts';

  type Filter = 'all' | SessionStatus;
  let filter = $state<Filter>('all');
  let query = $state('');

  const counts = $derived({
    all: companion.sessions.length,
    active: companion.sessions.filter((s) => s.status === 'active').length,
    idle: companion.sessions.filter((s) => s.status === 'idle').length,
    stopped: companion.sessions.filter((s) => s.status === 'stopped').length
  });

  const filters = $derived([
    { value: 'all' as Filter, label: t('sessions.filter.all') },
    { value: 'active' as Filter, label: t('sessions.filter.working') },
    { value: 'idle' as Filter, label: t('sessions.filter.waiting') },
    { value: 'stopped' as Filter, label: t('sessions.filter.ended') }
  ]);

  const shown = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return companion.sessions.filter((session) => {
      if (filter !== 'all' && session.status !== filter) return false;
      if (!needle) return true;
      return [sessionTitle(session), session.shortTitle, prettyPath(session.cwd), session.mainModel ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  });
</script>

<svelte:head><title>{t('sessions.title')} · Gentle Companion</title></svelte:head>

<div class="page automation-workspace">
  <PullToRefresh onrefresh={() => companion.refresh()} />
  <PageHero icon={clayIcon} eyebrow={t('sessions.eyebrow')} title={t('sessions.title')} subtitle={t('sessions.subtitle')} />

  <div class="toolbar clay">
    <label class="search">
      <span class="field-label">{t('sessions.search.label')}</span>
      <span class="search-field"><Icon name="search" size={16} /><input class="input" type="search" placeholder={t('sessions.search.placeholder')} bind:value={query} autocomplete="off" /></span>
    </label>
    <div class="filter-field">
      <span class="field-label" id="session-status-label">{t('sessions.status.label')}</span>
      <div class="segmented scroll-x" role="group" aria-labelledby="session-status-label">
        {#each filters as option (option.value)}
          <button aria-pressed={filter === option.value} onclick={() => (filter = option.value)}>
            {option.label}<span class="badge count quiet">{counts[option.value]}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  {#if companion.sessions.length}<p class="list-summary" role="status">{t('sessions.showing', { count: shown.length, total: companion.sessions.length, unit: companion.sessions.length === 1 ? t('sessions.plural.one') : t('sessions.plural.many') })}</p>{/if}

  {#if shown.length}
    <ul class="session-list" aria-label={t('sessions.title')}>
      {#each shown as session (session.id)}<li><SessionCard {session} /></li>{/each}
    </ul>
  {:else if companion.sessions.length}
    <div class="card empty">
      <span class="empty-icon"><Icon name="search" /></span>
      <h2>{t('sessions.empty.matching.title')}</h2>
      <p>{t('sessions.empty.matching.body')}</p>
      <button class="btn btn-sm" onclick={() => ((query = ''), (filter = 'all'))}>{t('sessions.clear')}</button>
    </div>
  {:else}
    <div class="card empty">
      <span class="empty-icon"><Icon name="sessions" /></span>
      {#if companion.connection !== 'online'}
        <h2>{t('sessions.empty.waiting.title')}</h2>
        <p>{t('sessions.empty.waiting.body')}</p>
      {:else if companion.isAdmin}
        <h2>{t('sessions.empty.none.title')}</h2>
        <p>{t('sessions.empty.none.body')}</p>
      {:else}
        <h2>{t('sessions.empty.shared.title')}</h2>
        <p>{t('sessions.empty.shared.body')}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) auto; align-items: end; gap: 18px; padding: 18px; border-radius: 22px; box-shadow: var(--clay-raised); }
  .search, .filter-field { display: grid; gap: 8px; min-width: 0; }
  .field-label { color: var(--text-2); font-size: 0.76rem; font-weight: 650; }
  .search-field { display: block; position: relative; min-width: 0; color: var(--text-3); }
  .search-field :global(.icon) { position: absolute; left: 13px; top: 50%; translate: 0 -50%; pointer-events: none; }
  .search .input { width: 100%; min-height: 48px; padding-left: 38px; border-radius: 15px; box-shadow: var(--clay-pressed); }
  .segmented { max-width: 100%; min-width: 0; border-radius: 15px; padding: 4px; box-shadow: var(--clay-pressed); }
  .segmented button { min-height: 44px; padding: 9px 12px; border-radius: 12px; }
  .session-list { display: grid; gap: 16px; padding: 0; margin: 0; list-style: none; min-width: 0; }
  .session-list li { min-width: 0; }
  .list-summary { margin: -4px 4px -4px; color: var(--text-2); font-size: 0.8rem; }
  @media (max-width: 1100px) {
    .toolbar { grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 16px; }
    .segmented { width: 100%; }
    .segmented button { flex: 1 0 auto; }
  }
</style>
