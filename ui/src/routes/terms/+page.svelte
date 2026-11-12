<script lang="ts">
$langStore;
  import { t , langStore} from '#lib/i18n.svelte.ts';;
</script>

<svelte:head><title>{t('terms.title')}</title></svelte:head>

<div class="page info-page">
  <header class="page-head">
    <div>
      <span class="eyebrow">{t('terms.eyebrow')}</span>
      <h1>{t('terms.title')}</h1>
      <p>{t('terms.effective')}</p>
    </div>
  </header>

  <section class="bento" aria-label="Terms of use">
    <article class="tile">
      <h2>{t('terms.license.title')}</h2>
      <p>
        {t('terms.license.body')}
        <a href="https://github.com/IAI-00-IAI/gentle-companion" rel="noreferrer">github.com/IAI-00-IAI/gentle-companion</a>.
      </p>
    </article>
    <article class="tile">
      <h2>{t('terms.asis.title')}</h2>
      <p>{t('terms.asis.body')}</p>
    </article>
    <article class="tile">
      <h2>{t('terms.responsibility.title')}</h2>
      <p>{t('terms.responsibility.body')}</p>
    </article>
  </section>
</div>

<style>
  .bento { grid-template-columns: minmax(0, 1fr); }
  .tile { display: grid; align-content: start; gap: 12px; }
</style>
