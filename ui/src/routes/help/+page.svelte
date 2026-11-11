<script lang="ts">
  import Icon from '#lib/Icon.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import { toasts } from '#lib/toast.svelte.ts';
  import { t } from '#lib/i18n.svelte.ts';

  const installCommand = 'gentle-shell install git:github.com/IAI-00-IAI/gentle-companion';

  const steps = $derived(
    companion.remote && !companion.isAdmin
      ? [
          { title: t('help.remote.title1'), body: t('help.remote.body1') },
          { title: t('help.remote.title2'), body: t('help.remote.body2') },
          { title: t('help.remote.title3'), body: t('help.remote.body3') }
        ]
      : [
          { title: t('help.local.title1'), body: t('help.local.body1') },
          { title: t('help.local.title2'), body: t('help.local.body2') },
          { title: t('help.local.title3'), body: t('help.local.body3') },
          { title: t('help.local.title4'), body: t('help.local.body4'), link: '/devices' },
          { title: t('help.local.title5'), body: t('help.local.body5') }
        ]
  );

  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(installCommand);
      toasts.show(t('help.toast.copy'), 'success');
    } catch {
      toasts.show(t('help.toast.fail'), 'error');
    }
  }
</script>

<svelte:head><title>{t('help.title')}</title></svelte:head>

<div class="page info-page">
  <header class="page-head">
    <div>
      <span class="eyebrow">{t('help.eyebrow')}</span>
      <h1>{t('help.title')}</h1>
      <p>{t('help.intro')}</p>
    </div>
  </header>

  <section class="tile stepper" aria-label="Setup guide">
    <ol>
      {#each steps as step, index (step.title)}
        <li>
          <span class="step-number" aria-hidden="true">{index + 1}</span>
          <div class="step-content">
            <h2>{step.title}</h2>
            <p>{step.body}</p>
            {#if step.title === t('help.local.title1')}
              <div class="install-command">
                <code>{installCommand}</code>
                <button class="btn btn-ghost" onclick={copyInstall}><Icon name="copy" />{t('help.btn.copy')}</button>
              </div>
            {/if}
            {#if 'link' in step && step.link}
              <a class="btn btn-ghost step-link" href={step.link}><Icon name="devices" />{t('help.btn.devices')}</a>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <section class="bento" aria-label="Help topics">
    <article class="tile">
      <span class="topic-icon"><Icon name="tool" /></span>
      <h2>{t('help.cmds.title')}</h2>
      <p class="muted">{t('help.cmds.intro')}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>{t('help.cmds.th1')}</th><th>{t('help.cmds.th2')}</th></tr></thead>
          <tbody>
            <tr><th><code>/companion</code></th><td>{t('help.cmds.c1.desc')}</td></tr>
            <tr><th><code>/remote-control</code></th><td>{t('help.cmds.c2.desc')}</td></tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="tile">
      <span class="topic-icon"><Icon name="bell" /></span>
      <h2>{t('help.notify.title')}</h2>
      <p>{t('help.notify.p1')}</p>
      <p>{t('help.notify.p2')}</p>
      <dl>
        <dt>{t('help.notify.di1')}</dt><dd>{t('help.notify.dd1')}</dd>
        <dt>{t('help.notify.di2')}</dt><dd>{t('help.notify.dd2')}</dd>
      </dl>
    </article>

    <article class="tile">
      <span class="topic-icon"><Icon name="chat" /></span>
      <h2>{t('help.ask.title')}</h2>
      <p>{t('help.ask.p1')}</p>
      <p class="muted">{t('help.ask.note')}</p>
    </article>

    <article class="tile">
      <span class="topic-icon"><Icon name="devices" /></span>
      <h2>{t('help.phone.title')}</h2>
      <p>{t('help.phone.p1')}</p>
      <p>
        {t('help.phone.p2')}
      </p>
      <p class="muted">{t('help.phone.note')}</p>
    </article>

    <article class="tile">
      <span class="topic-icon"><Icon name="download" /></span>
      <h2>{t('help.home.title')}</h2>
      <p>{t('help.home.p1')}</p>
      <dl>
        <dt>{t('help.home.di1')}</dt><dd>{t('help.home.dd1')}</dd>
        <dt>{t('help.home.di2')}</dt><dd>{t('help.home.dd2')}</dd>
        <dt>{t('help.home.di3')}</dt><dd>{t('help.home.dd3')}</dd>
      </dl>
      <p class="muted">{t('help.home.note')}</p>
    </article>

    <article class="tile">
      <span class="topic-icon"><Icon name="alert" /></span>
      <h2>{t('help.trouble.title')}</h2>
      <dl>
        <dt>{t('help.trouble.di1')}</dt><dd>{t('help.trouble.dd1')}</dd>
        <dt>{t('help.trouble.di2')}</dt><dd>{t('help.trouble.dd2')}</dd>
        <dt>{t('help.trouble.di3')}</dt><dd>{t('help.trouble.dd3')}</dd>
        <dt>{t('help.trouble.di4')}</dt><dd>{t('help.trouble.dd4')}</dd>
        <dt>{t('help.trouble.di5')}</dt><dd>{t('help.trouble.dd5')}</dd>
        <dt>{t('help.trouble.di6')}</dt><dd>{t('help.trouble.dd6')}</dd>
        <dt>{t('help.trouble.di7')}</dt><dd>{t('help.trouble.dd7')}</dd>
      </dl>
    </article>

    <article class="tile">
      <span class="topic-icon"><Icon name="help" /></span>
      <h2>{t('help.qa.title')}</h2>
      <dl>
        <dt>{t('help.qa.di1')}</dt><dd>{t('help.qa.dd1')}</dd>
        <dt>{t('help.qa.di2')}</dt><dd>{t('help.qa.dd2')}</dd>
        <dt>{t('help.qa.di3')}</dt><dd>{t('help.qa.dd3')}</dd>
        <dt>{t('help.qa.di4')}</dt><dd>{t('help.qa.dd4')}</dd>
      </dl>
    </article>
  </section>

  <footer class="help-footer" aria-label="Legal links">
    <a href="/privacy">{t('help.footer.privacy')}</a><span aria-hidden="true">·</span><a href="/terms">{t('help.footer.terms')}</a>
  </footer>
</div>

<style>
  .bento { grid-template-columns: minmax(0, 1fr); }
  .tile { display: grid; align-content: start; gap: 12px; }
  .topic-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; background: var(--accent-soft); color: var(--accent-text); }
  .stepper { padding: 22px; }
  .stepper ol { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
  .stepper li { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 14px; padding-bottom: 24px; }
  .stepper li:last-child { padding-bottom: 0; }
  .stepper li:not(:last-child)::after { content: ''; position: absolute; left: 16px; top: 34px; bottom: 0; width: 2px; background: var(--border); }
  .step-number { z-index: 1; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-text); font: 700 0.85rem/1 var(--mono); }
  .step-content { display: grid; align-content: start; gap: 8px; min-width: 0; padding-top: 4px; }
  .step-content h2 { font-size: 1.05rem; }
  .step-content p, dl { color: var(--text-2); }
  .install-command { display: flex; align-items: center; justify-content: space-between; gap: 8px; max-width: 620px; min-width: 0; padding: 4px 4px 4px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-sunken); }
  .install-command code { overflow-wrap: anywhere; font-size: 0.82rem; }
  .install-command button, .step-link { flex: none; }
  dl { margin: 0; display: grid; gap: 8px; }
  dt { color: var(--text); font-weight: 650; }
  dd { margin: -6px 0 8px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th, td { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 650; }
  .help-footer { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px; padding: 12px; color: var(--text-3); }
  .help-footer a { color: inherit; }
  @media (max-width: 520px) { .stepper { padding: 16px; } .stepper li { gap: 10px; } }
</style>
