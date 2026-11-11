<script lang="ts">
  import { onMount } from 'svelte';
  import PageHero from '#lib/PageHero.svelte';
  import PullToRefresh from '#lib/PullToRefresh.svelte';
  import { devicePermissions } from '#lib/device-permissions.svelte.ts';
  import clayIcon from '../../assets/clay/bulb.webp';
  import Icon, { type IconName } from '#lib/Icon.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import DevicePermissions from '#lib/DevicePermissions.svelte';
  import { theme, type ThemePreference } from '#lib/theme.svelte.ts';
  import { getLang, setLang, LOCALES, localeName, t } from '#lib/i18n.svelte.ts';
  import { errorMessage, toasts } from '#lib/toast.svelte.ts';
  import type { Settings, SettingsResponse } from '#lib/types.ts';
  import { estimatedCost, providerSnapshots, reportedTime, snapshotStatus, usagePercent, weeklyConsumption } from '#lib/usage.ts';

  let tab = $state<'general' | 'usage'>('general');
  let usageNow = $state(Date.now());
  const weekly = $derived(weeklyConsumption(companion.sessions, companion.usageSnapshots, usageNow));
  const usage = $derived(providerSnapshots(companion.sessions, companion.usageSnapshots).map(snapshot => ({
    ...snapshot, ...weekly.get(snapshot.provider.toLowerCase())
  })));

  onMount(() => {
    const timer = setInterval(() => { usageNow = Date.now(); }, 60_000);
    return () => clearInterval(timer);
  });

  function tabKey(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    tab = event.key === 'Home' ? 'general' : event.key === 'End' ? 'usage' : tab === 'general' ? 'usage' : 'general';
    const button = event.currentTarget as HTMLButtonElement;
    button.parentElement?.querySelector<HTMLButtonElement>(`#settings-${tab}-tab`)?.focus();
  }

  let data = $state<SettingsResponse | null>(null);
  let draft = $state<Settings>({ publicUrl: '', pairingTtlMinutes: 5, maxUploadMb: 25, allowedUploadTypes: [] });
  /** Comma or newline separated MIME patterns, edited as text. */
  let typesText = $state('');
  let saving = $state(false);
  let error = $state('');
  let loadError = $state('');

  const parseTypes = (text: string) =>
    text
      .split(/[\s,]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const dirty = $derived(
    Boolean(data) &&
      (draft.publicUrl.trim() !== data!.settings.publicUrl ||
        Number(draft.pairingTtlMinutes) !== data!.settings.pairingTtlMinutes ||
        Number(draft.maxUploadMb) !== data!.settings.maxUploadMb ||
        parseTypes(typesText).join(',') !== (data!.settings.allowedUploadTypes ?? []).join(','))
  );

  const themes = $derived([
    { value: 'system' as ThemePreference, label: t('settings.theme.system.label'), hint: t('settings.theme.system.hint'), icon: 'monitor' as IconName },
    { value: 'light' as ThemePreference, label: t('settings.theme.light.label'), hint: t('settings.theme.light.hint'), icon: 'sun' as IconName },
    { value: 'dark' as ThemePreference, label: t('settings.theme.dark.label'), hint: t('settings.theme.dark.hint'), icon: 'moon' as IconName }
  ]);

  function apply(response: SettingsResponse) {
    const settings: Settings = {
      publicUrl: response.settings?.publicUrl ?? '',
      pairingTtlMinutes: Number(response.settings?.pairingTtlMinutes ?? 5),
      maxUploadMb: Number(response.settings?.maxUploadMb ?? 25),
      allowedUploadTypes: Array.isArray(response.settings?.allowedUploadTypes)
        ? response.settings.allowedUploadTypes
        : []
    };
    data = { ...response, settings };
    draft = { ...settings };
    typesText = settings.allowedUploadTypes.join(', ');
  }

  onMount(async () => {
    if (!companion.isAdmin) return;
    try {
      apply(await companion.getSettings());
    } catch (e) {
      loadError = errorMessage(e);
    }
  });

  async function refreshSettings() {
    await Promise.all([companion.refresh(), devicePermissions.refresh(), (async () => {
      if (!companion.isAdmin) return;
      const response = await companion.getSettings();
      if (dirty || saving) { toasts.show(t('settings.toast.refreshed'), 'info'); }
      else apply(response);
      loadError = '';
    })()]);
    usageNow = Date.now();
  }

  async function save() {
    error = '';
    saving = true;
    try {
      apply(
        await companion.saveSettings({
          publicUrl: draft.publicUrl.trim(),
          pairingTtlMinutes: Number(draft.pairingTtlMinutes),
          maxUploadMb: Number(draft.maxUploadMb),
          allowedUploadTypes: parseTypes(typesText)
        })
      );
      toasts.show(t('settings.toast.saved'), 'success');
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Settings · Gentle Companion</title></svelte:head>

<div class="page narrow automation-workspace">
  <PullToRefresh onrefresh={refreshSettings} />
  <PageHero icon={clayIcon} eyebrow={t('settings.hero.eyebrow')} title={t('settings.hero.title')} subtitle={t('settings.hero.subtitle')} />

  <div class="settings-tabs" role="tablist" aria-label={t('settings.tabs.label')}>
    <button id="settings-general-tab" type="button" role="tab" aria-selected={tab === 'general'} aria-controls="settings-general-panel" tabindex={tab === 'general' ? 0 : -1} onclick={() => { tab = 'general'; }} onkeydown={tabKey}>{t('settings.tab.general')}</button>
    <button id="settings-usage-tab" type="button" role="tab" aria-selected={tab === 'usage'} aria-controls="settings-usage-panel" tabindex={tab === 'usage' ? 0 : -1} onclick={() => { tab = 'usage'; }} onkeydown={tabKey}>{t('settings.tab.usage')}</button>
  </div>

  <div class="settings-panel stack" id="settings-general-panel" role="tabpanel" aria-labelledby="settings-general-tab" tabindex="0" hidden={tab !== 'general'}>
  <section class="card tile section" aria-labelledby="appearance">
    <div class="section-copy">
      <h2 id="appearance">{t('settings.appearance.title')}</h2>
      <p class="muted">{t('settings.appearance.hint')}</p>
    </div>
    <div class="themes" role="radiogroup" aria-labelledby="appearance">
      {#each themes as option (option.value)}
        <button class="theme-option" role="radio" aria-checked={theme.preference === option.value} onclick={() => theme.set(option.value)}>
          <span class="swatch {option.value}" aria-hidden="true"><Icon name={option.icon} /></span>
          <strong>{option.label}</strong>
          <span class="subtle">{option.hint}</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="card tile section" aria-labelledby="language">
    <div class="section-copy">
      <h2 id="language">{t('lang.label')}</h2>
    </div>
    <div class="lang" role="group" aria-label={t('lang.label')}>
      {#each LOCALES as locale}
        <button
          class="lang-btn"
          class:active={getLang() === locale}
          aria-pressed={getLang() === locale}
          onclick={() => setLang(locale)}
        >
          {localeName(locale)}
        </button>
      {/each}
    </div>
  </section>

  <section class="card tile section" aria-labelledby="device-permissions">
    <div class="section-copy">
      <h2 id="device-permissions">{t('settings.notifications.title')}</h2>
      <p class="muted">{t('settings.notifications.hint')}</p>
    </div>
    <DevicePermissions />
  </section>

  {#if !companion.isAdmin}
    <!-- Daemon settings live on the computer running Pi. -->
  {:else if loadError}
    <div class="card empty"><span class="empty-icon"><Icon name="alert" /></span><h2>{t('settings.loaderror.title')}</h2><p>{loadError}</p></div>
  {:else if data}
    <form class="stack" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <section class="card tile section" aria-labelledby="pairing">
        <div class="section-copy">
          <h2 id="pairing">{t('settings.pairing.title')}</h2>
          <p class="muted">{t('settings.pairing.hint')}</p>
        </div>
        <div class="fields">
          <div class="field">
            <label for="public-url">{t('settings.pairing.publicurl.label')}</label>
            <input id="public-url" class="input" type="url" inputmode="url" placeholder={t('settings.pairing.publicurl.placeholder')}
              bind:value={draft.publicUrl} disabled={data.effective.publicUrlFromEnv} autocomplete="off" spellcheck="false" />
            {#if data.effective.publicUrlFromEnv}
              <span class="hint">{t('settings.pairing.publicurl.hint.env', { env: 'PI_COMPANION_PUBLIC_URL', url: data.effective.publicUrl })}</span>
            {:else}
              <span class="hint">{t('settings.pairing.publicurl.hint.default', { url: data.about.deviceUrl })}</span>
            {/if}
          </div>
          <div class="field short">
            <label for="ttl">{t('settings.pairing.ttl.label')}</label>
            <div class="unit"><input id="ttl" class="input" type="number" min="1" max="60" inputmode="numeric" bind:value={draft.pairingTtlMinutes} required /><span>{t('settings.pairing.ttl.unit')}</span></div>
            <span class="hint">{t('settings.pairing.ttl.hint')}</span>
          </div>
        </div>
      </section>

      <section class="card tile section" aria-labelledby="files">
        <div class="section-copy">
          <h2 id="files">{t('settings.files.title')}</h2>
          <p class="muted">{t('settings.files.hint')}</p>
        </div>
        <div class="fields">
          <div class="field short">
            <label for="max-upload">{t('settings.files.max.label')}</label>
            <div class="unit"><input id="max-upload" class="input" type="number" min="1" max={data.limits.maxUploadMb} inputmode="numeric" bind:value={draft.maxUploadMb} required /><span>{t('settings.files.max.unit')}</span></div>
            <span class="hint">{t('settings.files.max.hint', { max: data.limits.maxUploadMb })}</span>
          </div>
          <div class="field">
            <label for="upload-types">{t('settings.files.types.label')}</label>
            <input id="upload-types" class="input" type="text" placeholder={t('settings.files.types.placeholder')} bind:value={typesText}
              autocomplete="off" spellcheck="false" aria-describedby="upload-types-hint" />
            <span class="hint" id="upload-types-hint">{t('settings.files.types.hint')}</span>
          </div>
        </div>
      </section>

      <!-- Appears only with unsaved edits (or a save error), docked at the bottom in thumb reach. -->
      {#if dirty || error}
        <div class="savebar" role="region" aria-label={t('settings.savebar.label')}>
          <div class="savebar-copy">
            {#if error}
              <span class="error" role="alert"><Icon name="alert" size={16} />{error}</span>
            {:else}
              <span class="chip on"><span class="dot idle" aria-hidden="true"></span><span>{t('settings.savebar.chip')}</span></span>
            {/if}
          </div>
          <div class="savebar-actions">
            <button type="button" class="btn" onclick={() => { error = ''; if (data) apply(data); }} disabled={saving}><Icon name="close" size={16} />{t('settings.savebar.discard')}</button>
            <button class="btn btn-primary" disabled={!dirty || saving}><Icon name="check" size={16} />{saving ? t('settings.savebar.saving') : t('settings.savebar.save')}</button>
          </div>
        </div>
      {/if}
    </form>
  {/if}
  </div>

  <div class="settings-panel" id="settings-usage-panel" role="tabpanel" aria-labelledby="settings-usage-tab" tabindex="0" hidden={tab !== 'usage'}>
    <section class="card tile usage-section" aria-labelledby="provider-usage-heading">
      <div class="section-copy">
        <h2 id="provider-usage-heading">{t('settings.usage.title')}</h2>
        <p class="muted">{t('settings.usage.hint1')}</p>
        <p class="subtle">{t('settings.usage.hint2')}</p>
        <p class="subtle">{t('settings.usage.hint3')}</p>
      </div>
      {#if companion.connection !== 'online'}
        <p class="usage-notice" role="status">{t('settings.usage.disconnected')}</p>
      {/if}
      {#if usage.length}
        <!-- The scroll region is focusable so keyboard users can scroll every table column. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="usage-scroll" role="region" aria-label="Provider usage table, scroll horizontally for all columns" tabindex="0">
          <table class="usage-table">
            <caption>{t('settings.usage.caption')}</caption>
            <thead><tr><th scope="col">{t('settings.usage.col.provider')}</th><th scope="col">{t('settings.usage.col.weekly')}</th><th scope="col">{t('settings.usage.col.fivehour')}</th><th scope="col">{t('settings.usage.col.tokens')}</th><th scope="col">{t('settings.usage.col.cost')}</th><th scope="col">{t('settings.usage.col.last')}</th></tr></thead>
            <tbody>
              {#each usage as snapshot (snapshot.provider.toLowerCase())}
                <tr>
                  <th scope="row"><strong>{snapshot.provider}</strong><span class="subtle">{snapshot.source || t('settings.usage.source.notreported')}</span></th>
                  <td><strong>{snapshot.weekly ? usagePercent(snapshot.weekly) : t('settings.usage.notreported')}</strong>{#if snapshot.weekly?.resetsAt}<span class="subtle">{t('settings.usage.resets', { time: reportedTime(snapshot.weekly.resetsAt) })}</span>{/if}</td>
                  <td><strong>{snapshot.fiveHour ? usagePercent(snapshot.fiveHour) : t('settings.usage.notreported')}</strong>{#if snapshot.fiveHour?.resetsAt}<span class="subtle">{t('settings.usage.resets', { time: reportedTime(snapshot.fiveHour.resetsAt) })}</span>{/if}</td>
                  <td>{snapshot.weeklyTokens === undefined ? '—' : snapshot.weeklyTokens.toLocaleString()}</td>
                  <td>{snapshot.weeklyCost === undefined ? '—' : estimatedCost({ amount: snapshot.weeklyCost })}</td>
                  <td>
                    {#if snapshot.weekly || snapshot.fiveHour}<span>{t('settings.usage.account', { status: snapshotStatus(snapshot, usageNow), time: reportedTime(snapshot.updatedAt) })}</span>{/if}
                    {#if snapshot.sessionUpdatedAt}<span>{t('settings.usage.session', { id: snapshot.sessionId?.slice(0, 8), status: snapshotStatus({ ...snapshot, updatedAt: snapshot.sessionUpdatedAt, ended: snapshot.sessionEnded ?? snapshot.ended }, usageNow), time: reportedTime(snapshot.sessionUpdatedAt) })}</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="usage-cards" aria-label="Provider usage">
          {#each usage as snapshot (snapshot.provider.toLowerCase())}
            <article class="usage-card">
              <div class="usage-card-head"><strong>{snapshot.provider}</strong><span class="subtle">{snapshot.source || t('settings.usage.source.notreported')}</span></div>
              <dl>
                <div><dt>{t('settings.usage.col.weekly')}</dt><dd>{snapshot.weekly ? usagePercent(snapshot.weekly) : t('settings.usage.notreported')}{#if snapshot.weekly?.resetsAt}<small>{t('settings.usage.resets', { time: reportedTime(snapshot.weekly.resetsAt) })}</small>{/if}</dd></div>
                <div><dt>{t('settings.usage.col.fivehour')}</dt><dd>{snapshot.fiveHour ? usagePercent(snapshot.fiveHour) : t('settings.usage.notreported')}{#if snapshot.fiveHour?.resetsAt}<small>{t('settings.usage.resets', { time: reportedTime(snapshot.fiveHour.resetsAt) })}</small>{/if}</dd></div>
                <div><dt>{t('settings.usage.col.tokens')}</dt><dd>{snapshot.weeklyTokens === undefined ? '—' : snapshot.weeklyTokens.toLocaleString()}</dd></div>
                <div><dt>{t('settings.usage.col.cost')}</dt><dd>{snapshot.weeklyCost === undefined ? '—' : estimatedCost({ amount: snapshot.weeklyCost })}</dd></div>
              </dl>
              <div class="usage-card-foot">
                {#if snapshot.weekly || snapshot.fiveHour}<div>{t('settings.usage.account', { status: snapshotStatus(snapshot, usageNow), time: reportedTime(snapshot.updatedAt) })}</div>{/if}
                {#if snapshot.sessionUpdatedAt}<div>{t('settings.usage.session', { id: snapshot.sessionId?.slice(0, 8), status: snapshotStatus({ ...snapshot, updatedAt: snapshot.sessionUpdatedAt, ended: snapshot.sessionEnded ?? snapshot.ended }, usageNow), time: reportedTime(snapshot.sessionUpdatedAt) })}</div>{/if}
              </div>
            </article>
          {/each}
        </div>
      {:else}
        <div class="usage-empty"><Icon name="activity" /><h3>{t('settings.usage.empty.title')}</h3><p class="muted">{t('settings.usage.empty.body')}</p></div>
      {/if}
    </section>
  </div>
</div>

<style>
  .narrow {
    width: min(920px, 100%);
  }

  .stack {
    display: grid;
    gap: 24px;
  }

  .settings-panel[hidden] { display: none; }
  .settings-tabs { display: flex; gap: 8px; padding: 6px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: var(--clay-soft); }
  .settings-tabs button { min-height: 44px; padding: 10px 20px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--text-2); font: inherit; font-weight: 600; cursor: pointer; }
  .settings-tabs button[aria-selected='true'] { border-color: var(--border-strong); background: var(--surface-2); color: var(--text); box-shadow: var(--clay-soft); }
  .settings-tabs button:focus-visible, .usage-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .usage-section { display: grid; gap: 20px; padding: 24px; min-width: 0; }
  .usage-scroll { max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
  .usage-cards { display: none; }
  .usage-table { width: 100%; min-width: 850px; border-collapse: collapse; text-align: left; font-size: 0.88rem; }
  .usage-table caption { padding: 12px 16px; text-align: left; color: var(--text-2); font-size: 0.82rem; }
  .usage-table th, .usage-table td { padding: 14px 16px; border-top: 1px solid var(--border); vertical-align: top; }
  .usage-table thead { color: var(--text-2); background: var(--surface-2); }
  .usage-table tbody th { font-weight: 400; }
  .usage-table .subtle { display: block; margin-top: 5px; font-size: 0.76rem; font-weight: 400; overflow-wrap: anywhere; }
  .usage-table strong { font-variant-numeric: tabular-nums; }
  .usage-notice { padding: 12px 16px; border: 1px solid var(--border); border-radius: 12px; color: var(--text-2); background: var(--surface-2); font-size: 0.88rem; }
  .usage-empty { display: grid; gap: 8px; padding: 16px 0; justify-items: start; }
  .usage-empty h3 { margin: 0; font-size: 1rem; }
  @media (max-width: 760px) {
    .usage-scroll { display: none; }
    .usage-cards { display: grid; gap: 12px; min-width: 0; }
    .usage-card { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: var(--clay-soft); }
    .usage-card-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .usage-card-head strong { font-size: .95rem; overflow-wrap: anywhere; }
    .usage-card-head .subtle { font-size: .72rem; }
    .usage-card dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 0; }
    .usage-card dt { color: var(--text-2); font-size: .72rem; margin-bottom: 5px; }
    .usage-card dd { margin: 0; font-size: 1rem; font-weight: 650; overflow-wrap: anywhere; }
    .usage-card dd small { display: block; margin-top: 4px; font-size: .7rem; font-weight: 400; color: var(--text-2); }
    .usage-card-foot { padding-top: 10px; border-top: 1px solid var(--border); font-size: .71rem; color: var(--text-2); }
  }

  .section {
    display: grid;
    grid-template-columns: minmax(0, 240px) minmax(0, 1fr);
    gap: 24px;
    padding: 24px;
  }

  .section-copy {
    display: grid;
    align-content: start;
    gap: 4px;
  }

  .section-copy p {
    font-size: 0.88rem;
  }

  .fields .field,
  .fields .input,
  .unit,
  .unit .input {
    width: 100%;
    max-width: none;
  }

  .field {
    display: grid;
    align-content: start;
    gap: 7px;
  }
  .fields {
    display: grid;
    gap: 20px;
  }

  .short {
    max-width: 260px;
  }

  .unit {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .unit .input {
    width: 100%;
    min-width: 0;
    flex: 1;
  }

  .unit span {
    color: var(--text-2);
    font-size: 0.9rem;
  }

  .themes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .theme-option {
    display: grid;
    justify-items: start;
    gap: 2px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    text-align: left;
    transition: border-color 150ms var(--ease);
  }

  .theme-option:hover {
    border-color: var(--text-3);
  }

  .theme-option[aria-checked='true'] {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .theme-option .subtle {
    font-size: 0.8rem;
  }

  .lang {
    display: flex;
    gap: 6px;
    padding: 5px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    width: fit-content;
    max-width: 100%;
  }

  .lang-btn {
    min-height: 34px;
    border-color: transparent;
    background: transparent;
    border-radius: 9px;
    padding-inline: 14px;
    font: inherit;
    font-size: .82rem;
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
  }

  .lang-btn:hover {
    color: var(--text);
    background: var(--surface);
  }

  .lang-btn.active {
    background: var(--surface);
    border-color: var(--border);
    color: var(--accent-text);
    box-shadow: var(--clay-soft);
    font-weight: 700;
  }

  .swatch {
    display: grid;
    place-items: center;
    width: 100%;
    height: 56px;
    margin-bottom: 8px;
    border-radius: 9px;
    border: 1px solid var(--border);
  }

  .swatch.light {
    background: #f8f5f7;
    color: #A8517E;
  }

  .swatch.dark {
    background: #060407;
    color: #FFB1DD;
  }

  .swatch.system {
    background: linear-gradient(135deg, #f8f5f7 0 50%, #060407 50% 100%);
    color: #F095C8;
  }

  .savebar {
    position: sticky;
    bottom: 12px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 10px 10px 16px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-bento);
    background: var(--surface);
    box-shadow: var(--shadow);
    animation: savebar-in 200ms var(--ease);
  }

  .savebar-copy {
    min-width: 0;
  }

  .savebar-actions {
    display: flex;
    gap: 8px;
  }

  .savebar-actions .btn {
    min-width: 112px;
    border-radius: 14px;
  }

  @keyframes savebar-in {
    from {
      transform: translateY(12px);
    }
  }

  .error {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--danger);
    font-size: 0.9rem;
  }

  @media (max-width: 760px) {
    .usage-section { padding: 18px; }
    .settings-tabs button { flex: 1; }
    .section {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
      padding: 18px;
    }

    .themes {
      gap: 8px;
    }

    .short {
      max-width: none;
    }

    .lang {
      width: 100%;
    }

    .lang-btn {
      flex: 1;
    }

    .savebar {
      flex-direction: column;
      align-items: stretch;
      padding: 12px;
    }

    .savebar-actions .btn {
      flex: 1;
      min-height: 48px;
    }
  }
</style>
