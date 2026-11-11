<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import '#lib/automation.css';
  import clayIcon from '../../assets/automation-clay.svg';
  import Icon from '#lib/Icon.svelte';
  import AutomationEditor from '#lib/AutomationEditor.svelte';
  import AutomationTable from '#lib/AutomationTable.svelte';
  import PullToRefresh from '#lib/PullToRefresh.svelte';
  import AutomationPagination from '#lib/AutomationPagination.svelte';
  import { pageItems } from '#lib/automations.ts';
  import { t } from '#lib/i18n.svelte.ts';
  import { companion } from '#lib/companion.svelte.ts';
  import { errorMessage } from '#lib/toast.svelte.ts';
  import type { Automation, AutomationDraft } from '#lib/types.ts';

  let automations = $state<Automation[]>([]);
  let loading = $state(true);
  let error = $state('');
  let creating = $state(false);
  let saving = $state(false);
  let desktop = $state(false);
  let query = $state('');
  let status = $state('all');
  let currentPage = $state(1);
  const canEdit = $derived(companion.isAdmin && desktop);
  const filtered = $derived(automations.filter(a => a.name.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || a.enabled === (status === 'enabled'))));
  const pagination = $derived(pageItems(filtered, currentPage));
  onMount(() => {
    const media = window.matchMedia('(min-width: 901px)');
    const update = () => { desktop = media.matches; };
    update(); media.addEventListener('change', update);
    void load().catch(() => {});
    return () => media.removeEventListener('change', update);
  });
  async function load() {
    loading = true; error = '';
    try { automations = (await companion.request<{ automations: Automation[] }>('/api/automations')).automations.sort((a, b) => b.updatedAt - a.updatedAt); }
    catch (cause) { error = errorMessage(cause); throw cause; }
    finally { loading = false; }
  }
  async function create(draft: AutomationDraft) {
    saving = true;
    try {
      const result = await companion.request<Automation>('/api/automations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
      await goto('/automations/' + encodeURIComponent(result.id));
    } finally { saving = false; }
  }
</script>
<svelte:head><title>{t('automations.page.title')} · Gentle Companion</title></svelte:head>
<div class="page automation-workspace">
  <PullToRefresh onrefresh={load} />
  <header class="automation-hero"><div class="hero-copy"><img class="clay-icon" src={clayIcon} alt="" /><div><span class="eyebrow">{t('automations.eyebrow')}</span><h1>{t('automations.page.title')}</h1><p class="subtle">{t('automations.subtitle')}</p></div></div>{#if canEdit}<button class="btn btn-primary" aria-expanded={creating} onclick={() => creating = !creating}><Icon name="plus" />{creating ? t('automations.close') : t('automations.create')}</button>{/if}</header>
  {#if creating && canEdit}<AutomationEditor busy={saving} onsave={create} oncancel={() => creating = false} />{/if}
  {#if error}<div class="bento-card automation-empty" role="alert"><Icon name="alert" /><p>{error}</p><button class="btn" onclick={() => void load().catch(() => {})}>{t('automations.tryagain')}</button></div>
  {:else if loading}<div class="bento-card automation-empty" role="status">{t('automations.loading')}</div>
  {:else}
    <section class="bento-card collection" aria-label={t('automations.list.aria')}>
      <div class="collection-toolbar"><div><h2>{t('automations.list')}</h2><p class="subtle">{t('automations.list.body')}</p></div><div class="filters"><label class="filter-field">{t('automations.search.label')}<input class="search-input" type="search" placeholder={t('automations.search.placeholder')} bind:value={query} oninput={() => currentPage = 1} /></label><div class="filter-field"><span id="automation-status-label">{t('automations.status.label')}</span><div class="segmented" role="group" aria-labelledby="automation-status-label">{#each [{ value: 'all', label: t('automations.filter.all') }, { value: 'enabled', label: t('automations.filter.enabled') }, { value: 'disabled', label: t('automations.filter.disabled') }] as option}<button aria-pressed={status === option.value} onclick={() => { status = option.value; currentPage = 1; }}>{option.label}</button>{/each}</div></div><button class="btn btn-icon" aria-label={t('automations.refresh.aria')} onclick={() => void load().catch(() => {})}><Icon name="refresh" /></button></div></div>
      <div class="collection-scroll" class:primary={false} role="region" aria-label={t('automations.scroll.aria')} >
        {#if !filtered.length}<div class="automation-empty"><Icon name={automations.length ? 'search' : 'sparkle'} size={30} /><h2>{automations.length ? t('automations.empty.matching.title') : t('automations.empty.none.title')}</h2><p>{automations.length ? t('automations.empty.matching.body') : t('automations.empty.none.body')}</p>{#if automations.length}<button class="btn" onclick={() => { query = ''; status = 'all'; currentPage = 1; }}>{t('automations.clear')}</button>{/if}</div>
        {:else}<AutomationTable automations={pagination.items} />{/if}
      </div>
      <AutomationPagination page={pagination.page} pages={pagination.pages} total={pagination.total} onchange={value => currentPage = value} />
    </section>
  {/if}
  <p class="automation-note">{t('automations.note')} {#if !canEdit}{t('automations.note.edit')}{/if}</p>
</div>
