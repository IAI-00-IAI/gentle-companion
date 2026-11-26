<script lang="ts">
  import Icon, { type IconName } from '#lib/Icon.svelte';
  import { devicePermissions, type PermissionValue } from '#lib/device-permissions.svelte.ts';
  import { t , langStore} from '#lib/i18n.svelte.ts';;
  import { toasts } from '#lib/toast.svelte.ts';

  $effect(() => devicePermissions.init());

  const labels = $derived<Record<PermissionValue, string>>({
    granted: t('permissions.label.granted'),
    denied: t('permissions.label.denied'),
    prompt: t('permissions.label.prompt'),
    unsupported: t('permissions.label.unsupported'),
    insecure: t('permissions.label.insecure'),
    policy: t('permissions.label.policy')
  });

  async function enableNotifications() {
    const result = await devicePermissions.requestNotifications();
    if (result === 'denied') toasts.show(t('permissions.toast.denied'), 'error');
  }

  async function enableCamera() {
    const result = await devicePermissions.requestCamera();
    if (result === 'granted') toasts.show(t('permissions.toast.camera'), 'success');
    else if (devicePermissions.cameraError) toasts.show(devicePermissions.cameraError, 'error');
  }

  /**
   * The browser owns a granted permission; a page cannot take it back. Saying so
   * is more useful than a disabled button that looks broken.
   */
  function explainRevoke() {
    toasts.show(t('permissions.notifications.revoke.hint'), 'info');
  }

  async function testNotification() {
    const shown = await devicePermissions.notify(t('permissions.notifications.test'), t('permissions.notifications.test.description'), { tag: 'pi-companion-test' });
    if (!shown) toasts.show(t('permissions.notifications.test.fail'), 'error');
  }

  function hint(kind: 'notifications' | 'camera', state: PermissionValue) {
    if (kind === 'camera' && devicePermissions.cameraError) return devicePermissions.cameraError;
    if (state === 'policy') return t('permissions.camera.policy.hint');
    if (state === 'insecure') return t('permissions.camera.insecure.hint');
    if (state === 'denied') return t('permissions.camera.denied.hint');
    if (kind === 'notifications') {
      if (state === 'unsupported') return devicePermissions.needsInstall ? t('permissions.notifications.unsupported.hint.install') : t('permissions.notifications.unsupported.hint');
      return t('permissions.notifications.prompt.hint');
    }
    if (state === 'unsupported') return t('permissions.camera.unsupported.hint');
    return t('permissions.camera.hint');
  }

  const rows = $derived<{ kind: 'notifications' | 'camera'; icon: IconName; title: string; state: PermissionValue }[]>([
    { kind: 'notifications', icon: 'bell', title: t('permissions.notifications.title'), state: devicePermissions.notifications },
    { kind: 'camera', icon: 'camera', title: t('permissions.camera.title'), state: devicePermissions.camera }
  ]);
$effect(() => { $langStore; });
</script>

<ul class="permissions">
  {#each rows as row (row.kind)}
    <li>
      <span class="permission-icon" aria-hidden="true"><Icon name={row.icon} /></span>
      <div class="permission-copy">
        <strong>{row.title} <span class="badge {row.state}">{labels[row.state]}</span></strong>
        <p class="subtle">{hint(row.kind, row.state)}</p>
      </div>
      <div class="permission-actions">
        {#if row.kind === 'notifications'}
          {#if row.state === 'prompt'}
            <button class="btn btn-primary btn-sm" class:primary={false} type="button" onclick={enableNotifications}>{t('permissions.notifications.prompt.cta')}</button>
          {:else if row.state === 'granted'}
            <label class="toggle">
              <input type="checkbox" checked={devicePermissions.notificationsEnabled} onchange={(event) => devicePermissions.setNotificationsEnabled(event.currentTarget.checked)} />
              <span class="primary">{t('permissions.notifications.toggle')}</span>
            </label>
            <button class="btn btn-ghost btn-sm" class:primary={false} type="button" onclick={testNotification}>{t('permissions.notifications.test')}</button>
            <!-- Ricardo: "Si se desmarca el checkbox no hay método de fijar el
                 estado... debería aparecer un botón para poder No permitir".
                 He is right: the checkbox only silences alerts inside the app.
                 A granted browser permission cannot be revoked from here, so the
                 button states that plainly instead of pretending to revoke. -->
            <button class="btn btn-ghost btn-sm revoke-hint" class:primary={false} type="button" onclick={explainRevoke}>{t('permissions.notifications.revoke')}</button>
          {/if}
        {:else if row.state === 'prompt' || row.state === 'denied' || row.state === 'unsupported'}
          <button class="btn btn-primary btn-sm" type="button" onclick={enableCamera} disabled={devicePermissions.cameraPending}>{devicePermissions.cameraPending ? t('permissions.camera.requesting') : row.state === 'prompt' ? t('permissions.camera.prompt.cta') : t('permissions.camera.retry.cta')}</button>
        {/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .permissions { display: grid; gap: 10px; padding: 0; margin: 0; list-style: none; }
  /* Was `--bg-sunken` (#000000): a pure black block against the plum surfaces,
   * which Ricardo read as a hole with misaligned text. Every other card in the
   * system sits on surface-2, so this follows them. */
  .permissions li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 12px; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); border: 1px solid var(--border); }
  .permission-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--surface); color: var(--accent); }
  .permission-copy { min-width: 0; }
  /* In es-ES "Permitida" is longer than "Granted", and the whole badge wrapped
   * to its own line while the eye still read it as part of the title. The badge
   * must stay on one line; the TITLE is what gives way. */
  .permission-copy strong { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; min-width: 0; }
  .permission-copy strong > span.badge { flex: none; white-space: nowrap; }
  .permission-copy p { margin: 3px 0 0; }
  .permission-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; }
  .badge.granted { color: var(--ok); }
  .badge.denied, .badge.insecure, .badge.policy { color: var(--danger); }
  .toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; }
  @media (max-width: 560px) {
    .permissions li { grid-template-columns: auto minmax(0, 1fr); }
    .permission-actions { grid-column: 1 / -1; justify-content: flex-start; }
  }
</style>
