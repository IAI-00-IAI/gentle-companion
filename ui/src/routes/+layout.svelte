<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page, updated } from '$app/state';
  import logo from '../assets/gentle-logo.png';
  import AboutSheet from '#lib/AboutSheet.svelte';
  import ConnectionNotice from '#lib/ConnectionNotice.svelte';
  import Icon, { type IconName } from '#lib/Icon.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import { devicePermissions } from '#lib/device-permissions.svelte.ts';
  import { consumeTunnelPairingFragment } from '#lib/tailcat-boot.ts';
  import { theme, type ThemePreference } from '#lib/theme.svelte.ts';
  import { langStore, setLang, LOCALES, localeName, t } from '#lib/i18n.svelte.ts';
  import { toasts } from '#lib/toast.svelte.ts';

  let { children } = $props();

  type NavItem = { href: string; label: string; icon: IconName; admin?: boolean };
  const nav = $derived<NavItem[]>([
    { href: '/', label: t('shell.nav.overview'), icon: 'home' },
    { href: '/sessions', label: t('shell.nav.sessions'), icon: 'sessions' },
    { href: '/automations', label: t('shell.nav.automations'), icon: 'lightning' },
    { href: '/devices', label: t('shell.nav.devices'), icon: 'devices', admin: true },
    { href: '/settings', label: t('shell.nav.settings'), icon: 'settings' }
  ]);
  const visibleNav = $derived(nav.filter((item) => !item.admin || companion.isAdmin));
  const mobileNav = $derived(visibleNav.filter((item) => item.href !== '/settings'));
  const path = $derived(page.url.pathname);
  const bare = $derived(companion.remote && !companion.paired);
  const waiting = $derived(Object.values(companion.asks).reduce((total, list) => total + list.length, 0));
  const workSession = $derived(page.params.id
    ? companion.sessions.find((session) => session.id === page.params.id)
    : companion.sessions.find((session) => session.status === 'active'));
  const workPhase = $derived(companion.connection === 'online' && workSession?.status === 'active'
    ? companion.activity[workSession.id]?.at(-1)?.kind === 'thinking' ? 'thinking' : 'working'
    : '');
  let aboutOpen = $state(false);
  let insecureContext = $state(false);
  let httpsBannerDismissed = $state(false);

  // Sidebar collapse is an explicit preference, never inferred from the viewport:
  // the media queries below already own the responsive layouts.
  const SIDEBAR_KEY = 'pi-companion-sidebar';
  let sidebarCollapsed = $state(false);
  let sidebarTrigger = $state<HTMLButtonElement | null>(null);
  const sidebarExpanded = $derived(!sidebarCollapsed);
  const sidebarTitle = $derived(sidebarExpanded ? t('shell.sidebar.collapse') : t('shell.sidebar.expand'));

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    try { localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? 'collapsed' : 'expanded'); } catch { /* storage blocked */ }
    // The trigger keeps its node across states, but a hidden label must not drop focus
    // onto <body>: restore it explicitly after the DOM updates.
    const trigger = sidebarTrigger;
    if (trigger) queueMicrotask(() => trigger.focus());
  }

  function dismissHttpsBanner() { httpsBannerDismissed = true; }

  const connectionLabel = $derived({
    connecting: t('shell.connection.connecting'),
    online: t('shell.connection.online'),
    offline: t('shell.connection.offline'),
    disconnected: t('shell.connection.disconnected'),
    revoked: t('shell.connection.revoked')
  }[companion.connection]);

  const themes = $derived<{ value: ThemePreference; label: string; icon: IconName }[]>([
    { value: 'system', label: t('shell.theme.system'), icon: 'monitor' },
    { value: 'light', label: t('shell.theme.light'), icon: 'sun' },
    { value: 'dark', label: t('shell.theme.dark'), icon: 'moon' }
  ]);

  // Cyclic controls replace the two segmented radiogroups: three buttons each
  // do not fit in the 68px collapsed sidebar, and hiding them inverted what was
  // asked for. One button that rotates fits, and keeps the control reachable.
  let themeButton = $state<HTMLButtonElement | null>(null);
  let langButton = $state<HTMLButtonElement | null>(null);
  // A silent cycle is an accessibility regression versus the radiogroup it
  // replaces, so every press announces the value it landed on.
  let cycleAnnouncement = $state('');

  const themeLabel = $derived(themes.find((option) => option.value === theme.preference)?.label ?? '');
  const themeIcon = $derived(themes.find((option) => option.value === theme.preference)?.icon ?? 'monitor');

  function cycleTheme() {
    const index = themes.findIndex((option) => option.value === theme.preference);
    const next = themes[(index + 1) % themes.length];
    theme.set(next.value);
    cycleAnnouncement = t('shell.cycle.theme.announce', { value: next.label });
    themeButton?.focus();
  }

  function cycleLang() {
    const index = LOCALES.indexOf($langStore);
    const next = LOCALES[(index + 1) % LOCALES.length];
    setLang(next);
    cycleAnnouncement = t('shell.cycle.lang.announce', { value: localeName(next) });
    langButton?.focus();
  }

  function active(href: string) {
    return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
  }

  /** The browser Location plus history.replaceState, which SvelteKit's location omits. */
  function locationWithHistory(): { href: string; hash: string; replaceState(url: string): void } {
    return { href: location.href, hash: location.hash, replaceState: (url) => history.replaceState(history.state, '', url) };
  }

  // Cache busting: when a new UI build is deployed, finish the next navigation with a
  // full page load so the new shell and hashed assets are fetched.
  beforeNavigate(({ willUnload, to }) => {
    if (updated.current && !willUnload && to?.url) location.href = to.url.href;
  });

  // Paired devices only see sessions; unpaired devices only see the pairing screen.
  $effect(() => {
    if (!companion.booted) return;
    if (bare && path !== '/pair' && path !== '/privacy' && path !== '/terms') void goto('/pair', { replaceState: true });
    else if (companion.remote && path.startsWith('/devices')) void goto('/', { replaceState: true });
  });

  let notificationPromptDismissed = $state(true);
  const showNotificationPrompt = $derived(
    page.status < 400 && companion.booted && companion.paired && !notificationPromptDismissed && devicePermissions.notifications === 'prompt'
  );

  function dismissNotificationPrompt() {
    notificationPromptDismissed = true;
    try { localStorage.setItem('pi-companion-notification-prompt', 'dismissed'); } catch { /* storage blocked */ }
  }

  async function enableNotifications() {
    // Must stay inside the click handler: browsers only prompt from a user gesture.
    await devicePermissions.requestNotifications();
    dismissNotificationPrompt();
  }

  onMount(() => {
    insecureContext = !window.isSecureContext;
    theme.init();
    devicePermissions.init();
    companion.onSessionChange = (previous, next) => devicePermissions.sessionChanged(previous, next);
    try { notificationPromptDismissed = localStorage.getItem('pi-companion-notification-prompt') === 'dismissed'; } catch { /* storage blocked */ }
    try { sidebarCollapsed = localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch { /* storage blocked: stays expanded */ }
    const stopConnectivity = companion.watchConnectivity();
    // The tunnel pairing QR's fragment (#tunnel=…&port=…) configures tunnel mode
    // before boot reads it (feature tailcat-client T3); then it is stripped from the
    // address bar so a reload or a shared URL never re-carries the tunnel address.
    try { consumeTunnelPairingFragment(locationWithHistory(), localStorage); } catch { /* storage blocked: tunnel mode stays off */ }
    void companion.boot();

    // The PWA worker only caches the shell and immutable static assets. API/session data
    // stays network-only so an installed Companion never replays stale control state.
    if ('serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
    }

    // A file dropped outside a drop zone would make the browser navigate to file:///…,
    // which it blocks with a security error. Swallow stray drops everywhere.
    const swallow = (event: DragEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-dropzone]')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    const offline = () => companion.networkOffline();
    addEventListener('offline', offline);
    addEventListener('dragover', swallow);
    addEventListener('drop', swallow);
    return () => {
      stopConnectivity();
      removeEventListener('offline', offline);
      removeEventListener('dragover', swallow);
      removeEventListener('drop', swallow);
    };
  });
</script>

<svelte:head>
  <title>Gentle Companion</title>
  <meta name="description" content="Follow and steer your Pi sessions from your browser or phone." />
</svelte:head>

<a class="skip-link" href="#main">{t('shell.skip')}</a>

{#if bare}
  <main class="bare scroll" id="main">
    {#if insecureContext && !httpsBannerDismissed}
      <div class="banner danger" role="alert">
        <Icon name="alert" />
        <span>{t('shell.banner.https')}</span>
        {#if companion.httpsLink}
          <a class="btn btn-sm btn-primary" href={companion.httpsLink}>{t('shell.banner.https.open')}</a>
        {/if}
        <button class="btn btn-sm btn-ghost" onclick={dismissHttpsBanner} aria-label={t('shell.banner.dismiss')}>{t('shell.banner.dismiss')}</button>
      </div>
    {/if}
    <ConnectionNotice />{@render children()}
  </main>
{:else}
  <div class="shell" class:working={Boolean(workPhase)} class:sidebar-collapsed={sidebarCollapsed} data-work-phase={workPhase}>
    <span class="sr-only" role="status">{workPhase === 'thinking' ? t('shell.working.thinking') : workPhase === 'working' ? t('shell.working.working') : ''}</span>
    <aside class="sidebar scroll" aria-label={t('shell.nav.aria')}>
      <!-- Ricardo: "A sin flor, mantener solo la del logo, y que sea el logo el
           botón de plegar/replegar el panel". The whole brand is now the toggle:
           logo and title read as one unit, so splitting them would make half of
           it a button and half a link. The route home is not lost — `Overview`
           in the nav carries it. -->
      <button
        class="brand"
        type="button"
        bind:this={sidebarTrigger}
        aria-expanded={sidebarExpanded}
        aria-controls="sidebar-nav"
        aria-label={sidebarTitle}
        title={sidebarTitle}
        onclick={toggleSidebar}
      >
        <img src={logo} alt="" width="36" height="36" />
        <span class="brand-text">
          <strong>Gentle Companion</strong>
          <small>{companion.remote ? t('shell.brand.paired') : t('shell.brand.local')}</small>
        </span>
      </button>

      <nav class="nav" id="sidebar-nav" aria-label={t('shell.nav.aria')}>
        {#each visibleNav as item (item.href)}
          <a
            href={item.href}
            class:active={active(item.href)}
            aria-current={active(item.href) ? 'page' : undefined}
            aria-label={item.label}
            title={item.label}
          >
            <Icon name={item.icon} strokeWidth={2.5} />
            <span class="nav-label">{item.label}</span>
            {#if item.href === '/sessions' && waiting}
              <span class="count" aria-label={t('shell.nav.waiting.aria', { count: waiting })}>{waiting}</span>
            {/if}
          </a>
        {/each}
      </nav>

      <div class="sidebar-foot">
        <div class="cycle-controls">
          <button
            class="cycle theme-cycle"
            type="button"
            aria-label={t('shell.cycle.theme.aria', { value: themeLabel })}
            title={t('shell.cycle.theme.aria', { value: themeLabel })}
            bind:this={themeButton}
            onclick={cycleTheme}
          ><Icon name={themeIcon} size={16} /></button>
          <button
            class="cycle lang-cycle"
            type="button"
            aria-label={t('shell.cycle.lang.aria', { value: localeName($langStore) })}
            title={t('shell.cycle.lang.aria', { value: localeName($langStore) })}
            bind:this={langButton}
            onclick={cycleLang}
          ><span class="cycle-lang">{($langStore || 'es').toUpperCase()}</span></button>
        </div>
        <button class="status status-trigger" aria-haspopup="dialog" aria-label={t('shell.connection.aria', { status: connectionLabel })} title={connectionLabel} onclick={() => (aboutOpen = true)}>
          <span class="dot {companion.connection}" aria-hidden="true"></span>
          <span class="status-label">{connectionLabel}</span>
          {#if companion.version}<span class="subtle mono">v{companion.version}</span>{/if}
        </button>
        <span class="sr-only" aria-live="polite" aria-atomic="true">{cycleAnnouncement}</span>
        <nav class="legal-links" aria-label={t('shell.legal.aria')}>
          <a href="/privacy">{t('shell.legal.privacy')}</a><span aria-hidden="true">·</span><a href="/terms">{t('shell.legal.terms')}</a>
        </nav>
      </div>
    </aside>

    <div class="main-col">
      <header class="topbar">
        <a class="brand" href="/">
          <img src={logo} alt="" width="30" height="30" />
          <strong>Gentle Companion</strong>
        </a>
        <div class="topbar-actions">
          <button class="status compact status-trigger" aria-haspopup="dialog" aria-label={t('shell.connection.aria', { status: connectionLabel })} onclick={() => (aboutOpen = true)} class:primary={false} title={connectionLabel}>
            <span class="dot {companion.connection}" aria-hidden="true"></span>
            <span>{connectionLabel}</span>
          </button>
          <a class="btn btn-ghost btn-icon" href="/settings" aria-label={t('shell.nav.settings')} aria-current={active('/settings') ? 'page' : undefined}><Icon name="settings" /></a>
        </div>
      </header>

      <main class="content scroll" id="main" tabindex="-1">
        {#if insecureContext && !httpsBannerDismissed}
          <div class="banner danger" role="alert">
            <Icon name="alert" />
            <span>{t('shell.banner.https')}</span>
            {#if companion.httpsLink}
              <a class="btn btn-sm btn-primary" href={companion.httpsLink}>{t('shell.banner.https.open')}</a>
            {/if}
            <button class="btn btn-sm btn-ghost" onclick={dismissHttpsBanner} aria-label={t('shell.banner.dismiss')}>{t('shell.banner.dismiss')}</button>
          </div>
        {/if}
        {#if companion.connection === 'disconnected'}
          <div class="banner" role="alert">
            <Icon name="unplug" />
            <span>{t('shell.banner.disconnected')}</span>
            <button class="btn btn-sm" onclick={() => companion.reconnect()} class:primary={true}>{t('shell.banner.reconnect')}</button>
          </div>
        {/if}
        <div class="banner-slot"><ConnectionNotice /></div>
        {#if showNotificationPrompt}
          <div class="banner" role="region" aria-label={t('shell.banner.notifications.aria')}>
            <Icon name="bell" />
            <span>{t('shell.banner.notifications')}</span>
            <button class="btn btn-sm btn-primary" onclick={enableNotifications}>{t('shell.banner.notifications.on')}</button>
            <button class="btn btn-sm btn-ghost" onclick={dismissNotificationPrompt}>{t('shell.banner.notifications.later')}</button>
          </div>
        {/if}
        {#if updated.current}
          <div class="banner" role="status">
            <Icon name="sparkle" />
            <span>{t('shell.banner.update')}</span>
            <button class="btn btn-sm btn-primary" onclick={() => location.reload()} class:primary={true}>{t('shell.banner.reload')}</button>
          </div>
        {/if}

        {#if companion.booted && !companion.bootError}
          {@render children()}
        {:else}
          <div class="page connection-placeholder" role="status">
            <h1>{companion.bootError ? t('shell.boot.unavailable') : t('shell.boot.connecting')}</h1>
            <p>{companion.bootError ? t('shell.boot.restored') : t('shell.boot.waiting')}</p>
          </div>
        {/if}
      </main>

      <nav class="tabbar" aria-label={t('shell.nav.aria')}>
        {#each mobileNav as item (item.href)}
          <a href={item.href} class:active={active(item.href)} aria-current={active(item.href) ? 'page' : undefined}>
            <span class="tab-icon">
              <Icon name={item.icon} size={20} strokeWidth={2.5} />
              {#if item.href === '/sessions' && waiting}<span class="pip" aria-hidden="true"></span>{/if}
            </span>
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>
    </div>
  </div>
{/if}
<AboutSheet bind:open={aboutOpen} />

<div class="toasts" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    <div class="toast {toast.tone}">
      <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'sparkle'} size={16} />
      <span>{toast.message}</span>
      <button class="btn btn-ghost btn-sm" aria-label={t('toast.dismiss')} onclick={() => toasts.dismiss(toast.id)} class:primary={false}><Icon name="close" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .skip-link {
    position: fixed;
    left: 12px;
    top: -60px;
    z-index: 100;
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
    text-decoration: none;
  }

  .skip-link:focus {
    top: 12px;
  }

  /* The window never scrolls; sidebar and content scroll independently. */
  .shell {
    height: 100dvh;
    display: grid;
    grid-template-columns: var(--sidebar) minmax(0, 1fr);
    transition: grid-template-columns 220ms var(--ease);
  }

  .bare {
    height: 100dvh;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 20px 14px 16px;
    border-right: 1px solid var(--border);
    background: var(--bg-sunken);
  }

  /* The brand is the collapse toggle. It looks like a plain brand block on
   * purpose: the whole area is one control, and a visible button face would
   * compete with the logo for attention. */
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-width: 0;
    padding: 4px 8px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 150ms var(--ease), color 150ms var(--ease);
  }

  .brand:hover {
    background: var(--surface-2);
  }

  .brand:hover strong {
    color: var(--accent-text);
  }

  .brand:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
  }

  .brand img {
    border-radius: 9px;
    flex: none;
  }

  .brand-text {
    display: grid;
    min-width: 0;
    line-height: 1.2;
  }

  .brand strong {
    font-size: 0.98rem;
    letter-spacing: -0.01em;
  }

  .brand small {
    color: var(--text-3);
    font-size: 0.78rem;
  }

  .nav {
    display: grid;
    gap: 2px;
  }

  .nav a {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 38px;
    padding: 0 10px;
    border-radius: 9px;
    color: var(--text-2);
    font-weight: 550;
    text-decoration: none;
    transition: background-color 150ms var(--ease), color 150ms var(--ease);
  }
  .nav a:hover {
    background: var(--surface-2);
    color: var(--text);
  }

  .nav a.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .count {
    margin-left: auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 0.72rem;
    font-weight: 800;
  }

  .legal-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 4px;
    color: var(--text-3);
    font-size: 0.78rem;
  }

  .legal-links a {
    color: inherit;
    text-decoration: none;
  }

  .legal-links a:hover {
    color: var(--accent-text);
    text-decoration: underline;
  }
  .cycle-controls { display: flex; gap: 6px; justify-content: center; }

  .cycle {
    display: grid; place-items: center; min-height: 36px; min-width: 36px;
    padding: 0 8px; border-radius: 10px; cursor: pointer;
    background: var(--surface-2); border: 1px solid var(--border);
    color: var(--text-2); font: inherit;
    transition: color 150ms var(--ease), border-color 150ms var(--ease), background-color 150ms var(--ease);
  }
  .cycle:hover { color: var(--accent-text); border-color: var(--border-strong); }
  .cycle:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

  .cycle-lang {
    font-family: var(--mono); font-size: .68rem; font-weight: 700; letter-spacing: .03em;
  }

  .sidebar-foot {
    margin-top: auto;
    display: grid;
    gap: 12px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    font-size: 0.82rem;
    color: var(--text-2);
  }

  .status .mono {
    margin-left: auto;
    font-size: 0.75rem;
  }

  .theme-switch {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .theme-switch button {
    justify-content: center;
  }

  .lang-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--clay-radius);
    background: var(--surface-2);
    box-shadow: var(--clay-soft);
  }

  .lang-switch button {
    border: 1px solid transparent;
    border-radius: calc(var(--clay-radius) - 2px);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: .76rem;
    font-weight: 600;
    text-align: center;
    padding: 8px 6px;
    cursor: pointer;
  }

  .lang-switch button:hover {
    color: var(--text);
    background: var(--surface);
  }


  .main-col {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Ricardo, canvas 01-overview: "el ancho del borde tiene que estar todos
   * alineados ... calcular el borde sin ese mensaje".
   *
   * Measured cause: `main.content` scrolls, so its 21px scrollbar sat INSIDE
   * the content box. `.page` is centred with `margin: 0 auto`, which centred it
   * on the scrollable area (1015px) instead of on the box (1036px): left edge
   * flush at 244, right edge 21px short at 1259. Pages that did not scroll
   * looked aligned, which is why it seemed to depend on the banner.
   *
   * `stable` reserves the gutter always, so the centring box never changes with
   * scroll length. `both-edges` reserves it on the leading side too: with the
   * gutter on one side only, `.page` (width: 100% of the scrollable area)
   * hugged the left edge and left 21px dead on the right. Measured after
   * `both-edges`: 254..1270, exactly 10px of margin on each side.
   *
   * The banners are inside this box too (see the `.banner` rule below), so all
   * of them share one centring context and no rule needs a hardcoded scrollbar
   * width. */
  .content {
    flex: 1;
    min-height: 0;
    outline: none;
    scrollbar-gutter: stable both-edges;
  }

  .topbar,
  .tabbar {
    display: none;
  }

  /* Ricardo, canvas 01-overview: "todos los banners de notificaciones de este
   * tipo deben tener el mismo [ancho], quizás lo más fácil que el margen esté
   * alineado con el de la page y que quede unificado".
   *
   * They shared a fixed 16px inset, which lined them up with nothing: `.page`
   * is `min(1180px, 100%)` centred, so its edge moves with the viewport while
   * theirs did not.
   *
   * The banners now live INSIDE `main.content`, the box `.page` is centred on,
   * so the browser does the arithmetic instead of a hardcoded number that would
   * drift with the scrollbar width. `max-width` mirrors the page's inline
   * padding so a banner's border sits on the same column as the panels below.
   *
   * Vertical spacing stays 12px: a banner is transient and must not push the
   * page head around when it appears and disappears. */
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    /* Same box as `.page`, less the page's own 32px inline padding. */
    width: min(1180px, 100%);
    max-width: calc(min(1180px, 100%) - 64px);
    margin: 12px auto 0;
    padding: 10px 14px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius);
    background: var(--accent-soft);
    color: var(--text);
    font-size: 0.9rem;
  }

  .banner span {
    flex: 1;
  }

  /* `.page` drops its inline padding to 16px below 900px, so the banner's
     mirrored inset has to follow or it would sit narrower than the panels
     below it. Kept in its own query, after the base rule, so the mobile grid
     query above stays adjacent to `.shell` as sidebar.test.ts requires. */
  @media (max-width: 900px) {
    .banner {
      max-width: calc(min(1180px, 100%) - 32px);
    }
  }

  .banner.danger {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    background: var(--danger-soft);
  }

  .toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 90;
    display: grid;
    gap: 8px;
    width: min(380px, calc(100vw - 32px));
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 14px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    font-size: 0.9rem;
    animation: toast-in 220ms var(--ease);
  }

  .toast span {
    flex: 1;
  }

  .toast.success {
    color: var(--ok);
  }

  .toast.error {
    color: var(--danger);
  }

  .toast span {
    color: var(--text);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (max-width: 900px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
    }

    .sidebar {
      display: none;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: calc(4px + env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 4px
        max(8px, env(safe-area-inset-left));
      border-bottom: 1px solid var(--border);
      background: var(--bg-sunken);
    }

    .topbar .brand {
      padding: 0;
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .status.compact {
      font-size: 0.78rem;
    }

    .tabbar {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      padding: 2px max(8px, env(safe-area-inset-right)) calc(2px + env(safe-area-inset-bottom))
        max(8px, env(safe-area-inset-left));
      border-top: 1px solid var(--border);
      background: var(--bg-sunken);
    }

    .tabbar a {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 0;
      min-height: 44px;
      margin: 0;
      padding: 2px 4px;
      border-radius: 12px;
      color: var(--text-3);
      font-size: 0.68rem;
      font-weight: 600;
      text-decoration: none;
      transition: background-color 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out;
    }

    .tabbar a.active {
      border-radius: 999px;
      color: var(--accent-text);
      background: var(--clay-surface);
      box-shadow: var(--clay-pressed);
    }

    .tab-icon {
      position: relative;
      display: grid;
      place-items: center;
      width: 22px;
      height: 24px;
      border-radius: 999px;
    }

    .tabbar a.active .tab-icon {
      background: var(--accent-soft);
    }

    .pip {
      position: absolute;
      top: 1px;
      right: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 2px var(--bg-sunken);
    }

    .toasts {
      bottom: calc(48px + 12px + env(safe-area-inset-bottom));
      left: 16px;
      right: 16px;
      width: auto;
    }
  }

  @media (max-width: 380px) {
    .status.compact span:last-child { max-width: 58px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .topbar .brand { min-width: 0; }
    .topbar .brand strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
  .sidebar {
    margin: 10px 0 10px 10px;
    border: 1px solid var(--border);
    border-radius: var(--clay-radius);
    background: var(--clay-surface);
    box-shadow: var(--clay-raised);
  }
  .nav { gap: 6px; }
  .nav a {
    min-height: 44px;
    border-radius: var(--clay-radius);
    background: var(--surface-2);
    box-shadow: var(--clay-soft);
    transition: background-color 200ms ease-out, color 200ms ease-out, box-shadow 200ms ease-out, transform 200ms ease-out;
  }
  .nav a:hover { background: var(--clay-surface); color: var(--text); box-shadow: var(--clay-soft); }
  .nav a.active { background: var(--clay-surface); color: var(--accent-text); box-shadow: var(--clay-pressed); }
  .nav a:active { transform: scale(0.97); }
  .status-trigger {
    width: 100%;
    min-height: 42px;
    border: 1px solid var(--border);
    border-radius: var(--clay-radius);
    background: var(--clay-surface);
    box-shadow: var(--clay-soft);
    text-align: left;
    cursor: pointer;
  }
  .status-trigger:hover { color: var(--text); }
  .status-trigger:active { transform: scale(0.97); box-shadow: var(--clay-pressed); }
  .topbar, .tabbar { background: var(--clay-surface); box-shadow: var(--clay-raised); }
  @media (max-width: 900px) {
    .topbar {
      flex: none;
      margin: 6px 8px 4px;
      padding: calc(4px + env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left));
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--clay-raised);
    }
    .topbar .brand { min-height: 44px; }
    .topbar .brand strong { font-size: 0.9rem; }
    .topbar-actions { gap: 8px; }
    .topbar-actions > .btn-icon { border: 1px solid var(--border); border-radius: 14px; background: var(--surface-2); box-shadow: var(--clay-soft); }
    .tabbar {
      flex: none;
      margin: 4px 8px calc(6px + env(safe-area-inset-bottom));
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--clay-raised);
      gap: 6px;
    }
    .tabbar a { border-radius: 16px; background: var(--surface-2); box-shadow: var(--clay-soft); }
    .tabbar a.active { border-radius: 16px; color: var(--accent-text); background: var(--accent-soft); box-shadow: var(--clay-pressed); }
    .tabbar a:active { transform: scale(0.97); box-shadow: var(--clay-pressed); }
    .tab-icon, .tabbar a.active .tab-icon { background: transparent; }
    .status-trigger.compact { width: auto; min-height: 44px; padding: 0 10px; border-radius: 16px; background: var(--surface-2); box-shadow: var(--clay-soft); }
  }
  :global(:focus-visible) { outline: 3px solid var(--accent); outline-offset: 3px; }
  /* Collapsed sidebar: the column narrows and only text labels hide, so the life
   * indicator dot and the nav icons stay visible. Guarded to the desktop layout via
   * the min-width query below, because under 900px the sidebar is hidden entirely and
   * the tabbar owns navigation. */
  @media (min-width: 901px) {
    .shell.sidebar-collapsed { grid-template-columns: var(--sidebar-collapsed) minmax(0, 1fr); }
    .shell.sidebar-collapsed .brand { flex-direction: column; gap: 8px; padding: 4px 0; }
    .shell.sidebar-collapsed .brand-text,
    .shell.sidebar-collapsed .nav-label,
    .shell.sidebar-collapsed .status-label,
    .shell.sidebar-collapsed .legal-links { display: none; }
    .shell.sidebar-collapsed .nav a,
    .shell.sidebar-collapsed .status-trigger { justify-content: center; }
    .shell.sidebar-collapsed .nav a { position: relative; }
    .shell.sidebar-collapsed .count {
      position: absolute;
      top: 4px;
      right: 4px;
      margin: 0;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      font-size: 0.66rem;
    }
  }
  .shell.working .brand img { animation: clay-breathe 2.2s ease-in-out infinite; }
  .shell.working .topbar { position: relative; }
  .shell.working .topbar::after {
    content: ''; position: absolute; left: 20px; right: 20px; bottom: 1px; height: 3px;
    border-radius: 999px; pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: clay-sweep 2.2s ease-in-out infinite alternate;
  }
  .shell.working :global(.dot.active) { animation: clay-breathe 2.2s ease-in-out infinite; }
  .shell[data-work-phase='thinking'] .brand img,
  .shell[data-work-phase='thinking'] .topbar::after { animation-duration: 3.2s; }
  @keyframes clay-breathe { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.72; transform: scale(1.04); } }
  @keyframes clay-sweep { from { opacity: 0.45; transform: scaleX(0.25); } to { opacity: 0.85; transform: scaleX(1); } }
  /* The title block is the collapse trigger: a pointer-only affordance, so it must
   * never show as a button. The logo and mark stay as the sidebar home link. */
  @media (min-width: 901px) {
    .shell.sidebar-collapsed .sidebar { padding-left: 8px; padding-right: 8px; }
    /* The trigger's only child hides when collapsed. Without a size of its own
     * the button collapses to zero width and the sidebar cannot be reopened:
     * the control would hide itself. Give it a real hit target. */
    /* Ricardo, with a reference image: the bottom controls read badly when
     * collapsed. His image shows three equal SQUARES stacked and centred — theme,
     * language, then the life indicator — not full-width bars of different
     * widths. The order in the markup was also life-first; it now matches. */
    .shell.sidebar-collapsed .sidebar-foot {
      align-items: center;
      gap: 8px;
    }
    .shell.sidebar-collapsed .cycle-controls {
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .shell.sidebar-collapsed .cycle {
      width: 42px; min-width: 42px; height: 42px; min-height: 42px;
      padding: 0; border-radius: 12px;
    }
    /* The life indicator becomes a square matching the two pressers, with the
     * dot alone inside it. Its label is already hidden here. */
    .shell.sidebar-collapsed .status-trigger {
      width: 42px; min-width: 42px; height: 42px;
      border-radius: 12px;
      padding: 0;
      display: grid; place-items: center;
    }
    /* Ricardo: "botón 'en línea' indicador centrado y plegado desaparece
     * versión". The version string is hidden when collapsed, and the dot sits
     * dead centre rather than left-aligned in a wider box. */
    .shell.sidebar-collapsed .status-trigger .dot { margin: 0 auto; }
    .shell.sidebar-collapsed .status-trigger .subtle { display: none; }
    /* Keep the pip-ish round frame the image shows for the status specifically. */
    .shell.sidebar-collapsed .status-trigger { border-radius: 999px; }
    .shell.sidebar-collapsed .brand {
      padding: 4px; min-width: 40px; min-height: 40px;
      display: grid; place-items: center;
    }
    .shell.sidebar-collapsed .brand::after {
      content: '\203A'; /* › — points the way the panel will open */
      font-size: 1.1rem; line-height: 1; color: var(--accent-text);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shell.working .brand img, .shell.working .topbar::after, .shell.working :global(.dot.active) { animation: none; transform: none; }
    .nav a, .status-trigger, .tabbar a, .shell, .brand { transition: none; }
    .nav a:active, .status-trigger:active, .tabbar a:active { transform: none; }
  }
</style>
