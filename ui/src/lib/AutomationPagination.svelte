<script lang="ts">
  import Icon from './Icon.svelte';
  import { t } from './i18n.svelte.ts';
  let { page, pages, total, onchange }: { page: number; pages: number; total: number; onchange: (page: number) => void } = $props();
</script>
<nav class="automation-pagination" aria-label={t('automation.pagination.aria')}>
  <span class="subtle">{t('automation.pagination.summary', { total, page, pages, unit: total === 1 ? t('automation.pagination.item.one') : t('automation.pagination.item.many') })}</span>
  <div><button class="btn btn-sm" aria-label={t('automation.pagination.previous.aria')} disabled={page <= 1} onclick={() => onchange(page - 1)}><Icon name="back" size={16} />{t('automation.pagination.previous')}</button><button class="btn btn-sm" aria-label={t('automation.pagination.next.aria')} disabled={page >= pages} onclick={() => onchange(page + 1)}>{t('automation.pagination.next')}<Icon name="chevron" size={16} /></button></div>
</nav>
<style>
  nav { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-top: 16px; border-top: 1px solid var(--border); font-size: .76rem; } nav > div { display: flex; gap: 8px; } .btn { min-height: 44px; }
</style>
