<script lang="ts">
  import Icon from '#lib/Icon.svelte';
  import { t } from '#lib/i18n.svelte.ts';
</script>

<svelte:head><title>{t('privacy.title')}</title></svelte:head>

<div class="page info-page">
  <header class="page-head">
    <div>
      <span class="eyebrow">{t('privacy.eyebrow')}</span>
      <h1>{t('privacy.title')}</h1>
      <p>{t('privacy.intro')}</p>
    </div>
  </header>

  <section class="bento" aria-label="Privacy details">
    <article class="tile">
      <span class="topic-icon"><Icon name="home" /></span>
      <span class="badge ok">{t('privacy.local.badge')}</span>
      <h2>{t('privacy.local.title')}</h2>
      <p>{t('privacy.local.body')}</p>
    </article>
    <article class="tile">
      <span class="topic-icon"><Icon name="activity" /></span>
      <h2>{t('privacy.noanalytics.title')}</h2>
      <p>{t('privacy.noanalytics.body')}</p>
    </article>
    <article class="tile">
      <span class="topic-icon"><Icon name="devices" /></span>
      <h2>{t('privacy.network.title')}</h2>
      <p>{t('privacy.network.body')}</p>
    </article>
    <article class="tile">
      <span class="topic-icon"><Icon name="download" /></span>
      <h2>{t('privacy.download.title')}</h2>
      <p>{t('privacy.download.body')}</p>
    </article>
  </section>
</div>

<style>
  .bento { grid-template-columns: minmax(0, 1fr); }
  .tile { display: grid; align-content: start; justify-items: start; gap: 12px; }
  .topic-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; background: var(--accent-soft); color: var(--accent-text); }
</style>
