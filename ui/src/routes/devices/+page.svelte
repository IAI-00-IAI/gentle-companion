<script lang="ts">
$langStore;
  import PageHero from '#lib/PageHero.svelte';
  import clayIcon from '../../assets/clay/computer.webp';
  import { onDestroy } from 'svelte';
  import Icon from '#lib/Icon.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import { relativeTime, shortDate } from '#lib/format.ts';
  import { errorMessage, toasts } from '#lib/toast.svelte.ts';
  import { t , langStore} from '#lib/i18n.svelte.ts';;
  import type { PairedDevice, Pairing } from '#lib/types.ts';

  let pairing = $state<Pairing | null>(null);
  let starting = $state(false);
  let now = $state(Date.now());
  let confirmTarget = $state<PairedDevice | null>(null);
  let dialog = $state<HTMLDialogElement | null>(null);
  let busy = $state<string | null>(null);

  const timer = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(timer));

  const remaining = $derived(pairing ? Math.max(0, Math.round(pairing.expiresAt - now / 1000)) : 0);
  const expired = $derived(Boolean(pairing) && remaining === 0);
  const connected = $derived(companion.devices.filter((d) => d.connected).length);
  const knownIds = new Set(companion.devices.map((d) => d.id));

  // Close the pairing panel once a new device shows up.
  $effect(() => {
    const fresh = companion.devices.find((d) => !knownIds.has(d.id));
    for (const device of companion.devices) knownIds.add(device.id);
    if (fresh && pairing) {
      pairing = null;
      toasts.show(t('devices.toast.paired', { name: fresh.name }), 'success');
    }
  });

  function countdown(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return m + ':' + s;
  }

  async function startPairing() {
    starting = true;
    try {
      pairing = await companion.startPairing();
    } catch (error) {
      toasts.show(errorMessage(error), 'error');
    } finally {
      starting = false;
    }
  }

  async function copyLink() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.url);
      toasts.show(t('devices.toast.link'), 'success');
    } catch {
      toasts.show(t('devices.toast.link.fail'), 'error');
    }
  }

  async function copyCode() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      toasts.show(t('devices.toast.code'), 'success');
    } catch {
      toasts.show(t('devices.toast.code.fail'), 'error');
    }
  }

  async function disconnect(device: PairedDevice) {
    busy = device.id;
    try {
      await companion.disconnectDevice(device.id);
      toasts.show(t('devices.toast.disconnected', { name: device.name }), 'success');
    } catch (error) {
      toasts.show(errorMessage(error), 'error');
    } finally {
      busy = null;
    }
  }

  function askRevoke(device: PairedDevice) {
    confirmTarget = device;
    dialog?.showModal();
  }

  async function revoke() {
    const device = confirmTarget;
    dialog?.close();
    if (!device) return;
    busy = device.id;
    try {
      await companion.revokeDevice(device.id);
      toasts.show(t('devices.toast.revoked', { name: device.name }), 'success');
    } catch (error) {
      toasts.show(errorMessage(error), 'error');
    } finally {
      busy = null;
      confirmTarget = null;
    }
  }
</script>

<svelte:head><title>{t('devices.title')} · Gentle Companion</title></svelte:head>

<div class="page automation-workspace">
  <PageHero icon={clayIcon} eyebrow={t('devices.eyebrow')} title={t('devices.title')} subtitle={t('devices.subtitle')}>
    {#if !pairing}<button class="btn-bento primary" onclick={startPairing} disabled={starting}><Icon name="plus" />{t('devices.pair')}</button>{/if}
  </PageHero>

  {#if pairing}
    <section class="pair card" aria-labelledby="pair-heading">
      <div class="qr" class:expired>
        {@html pairing.qrSvg}
        {#if expired}<span class="primary">{t('devices.expired.badge')}</span>{/if}
      </div>
      <div class="pair-copy">
        <span class="eyebrow">{t('devices.new')}</span>
        <h2 id="pair-heading">{t('devices.scan')}</h2>
        <ol>
          <li>{t('devices.step1')}</li>
          <li>{t('devices.step2')}</li>
          <li>{t('devices.step3')}</li>
        </ol>
        <div class="code-block" aria-label={t('devices.code.aria')}>
          <div>
            <span class="subtle">{t('devices.code.label')}</span>
            <code class="pair-code">{pairing.code}</code>
          </div>
          <button class="btn btn-sm" onclick={copyCode}><Icon name="copy" size={14} />{t('devices.copy.code')}</button>
        </div>
        <div class="link-row">
          <code title={pairing.url}>{pairing.url}</code>
          <button class="btn btn-sm" onclick={copyLink}><Icon name="copy" size={14} />{t('devices.copy.link')}</button>
        </div>
        <p class="subtle expiry" role="timer" aria-live="off">
          {#if expired}{t('devices.expired.title')}{:else}{t('devices.expired.note', { time: countdown(remaining) })}{/if}
        </p>
        <div class="actions">
          {#if expired}
            <button class="btn btn-primary" onclick={startPairing}><Icon name="refresh" size={16} />{t('devices.newcode')}</button>
          {/if}
          <button class="btn btn-ghost" onclick={() => (pairing = null)}>{t('devices.done')}</button>
        </div>
      </div>
    </section>
  {/if}

  <section class="card list-card" aria-labelledby="list-heading">
    <div class="card-head">
      <h2 id="list-heading">{t('devices.list')}</h2>
      <div class="chips" class:primary={false} aria-label={t('devices.chips.aria')} >
        <span class="badge count">{companion.devices.length}<span class="sr-only">{t('devices.chips.total.aria')}</span></span>
        <span class="badge count quiet">{connected}<span class="sr-only">{t('devices.chips.connected.aria')}</span></span>
      </div>
    </div>
    {#if companion.devices.length === 0}
      <div class="empty">
        <span class="empty-icon"><Icon name="devices" /></span>
        <h2>{t('devices.empty.title')}</h2>
        <p>{t('devices.empty.body')}</p>
      </div>
    {:else}
      <ul class="devices">
        {#each companion.devices as device (device.id)}
          <li class:online={device.connected}>
            <span class="device-icon"><Icon name="devices" /></span>
            <div class="device-main">
              <div class="device-title">
                <strong class="chip"><span>{device.name}</span></strong>
                {#if device.connected}
                  <span class="badge ok"><span class="dot online" aria-hidden="true"></span>{t('devices.connected')}{#if device.connections > 1}<span class="badge count quiet">{device.connections}</span>{/if}</span>
                {:else}
                  <span class="badge"><span class="dot" aria-hidden="true"></span>{t('devices.disconnected')}</span>
                {/if}
              </div>
              <span class="subtle">
                {device.connected ? t('devices.active') : t('devices.lastseen', { time: relativeTime(device.lastSeen, now) })} · {t('devices.paired', { date: shortDate(device.pairedAt) })}
              </span>
            </div>
            <div class="device-actions">
              <button class="btn btn-sm" onclick={() => disconnect(device)} disabled={!device.connected || busy === device.id}
                title={t('devices.disconnect.title')}>
                <Icon name="unplug" size={14} />{t('devices.disconnect')}
              </button>
              <button class="btn btn-sm btn-danger" onclick={() => askRevoke(device)} disabled={busy === device.id}
                title={t('devices.revoke.title')}>
                <Icon name="ban" size={14} />{t('devices.revoke')}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <p class="subtle footnote">
    {t('devices.footnote')}
  </p>
</div>

<dialog bind:this={dialog} class="dialog" aria-labelledby="revoke-title" onclose={() => (confirmTarget = null)}>
  <form method="dialog">
    <h2 id="revoke-title">{t('devices.revoke.confirm.title', { name: confirmTarget?.name })}</h2>
    <p class="muted">{t('devices.revoke.confirm.body')}</p>
    <div class="dialog-actions">
      <button class="btn" value="cancel">{t('devices.revoke.cancel')}</button>
      <button class="btn btn-danger solid" type="button" onclick={revoke}>{t('devices.revoke.action')}</button>
    </div>
  </form>
</dialog>

<style>
  .pair {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 28px;
    padding: 24px;
    border-color: var(--accent-line);
  }

  .qr {
    position: relative;
    width: 220px;
    height: 220px;
    padding: 10px;
    border-radius: var(--radius);
    background: #fff;
    box-shadow: 0 0 0 1px var(--border);
  }

  .qr :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .qr.expired :global(svg) {
    opacity: 0.12;
  }

  .qr span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #1a1815;
    font-weight: 700;
  }

  .pair-copy {
    display: grid;
    align-content: start;
    gap: 10px;
    min-width: 0;
  }

  .pair-copy ol {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 4px;
    color: var(--text-2);
  }

  .code-block {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
  }

  .code-block > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .pair-code {
    font: 800 1.35rem/1.1 var(--mono);
    letter-spacing: 0.16em;
    color: var(--accent-text);
    user-select: all;
  }

  .link-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }

  .link-row code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }

  .expiry {
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .list-card {
    overflow: hidden;
  }

  .devices {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .devices li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 20px;
    border-top: 1px solid var(--border);
  }

  .devices li:first-child {
    border-top: 0;
  }

  .device-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    flex: none;
    border-radius: 11px;
    background: var(--surface-2);
    color: var(--text-3);
  }

  .online .device-icon {
    background: var(--ok-soft);
    color: var(--ok);
  }

  .device-main {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .device-title {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .device-main > .subtle {
    font-size: 0.82rem;
  }

  .device-actions {
    display: flex;
    gap: 8px;
    flex: none;
  }

  .footnote {
    font-size: 0.85rem;
  }

  .dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 22px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }

  .dialog::backdrop {
    background: var(--overlay);
    backdrop-filter: blur(2px);
  }

  .dialog form {
    display: grid;
    gap: 10px;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  @media (max-width: 760px) {
    .pair {
      grid-template-columns: minmax(0, 1fr);
      justify-items: center;
      padding: 18px;
      gap: 18px;
    }

    .qr {
      width: min(240px, 70vw);
      height: min(240px, 70vw);
    }

    .devices li {
      flex-wrap: wrap;
      padding: 14px 16px;
    }

    .code-block {
      width: 100%;
      align-items: stretch;
      flex-direction: column;
    }

    .code-block .btn {
      width: 100%;
    }

    .device-actions {
      width: 100%;
      padding-left: 52px;
    }

    .device-actions .btn {
      flex: 1;
    }
  }
</style>
