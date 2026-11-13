<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import jsQR from 'jsqr';
  import logo from '../../assets/pi-companion.webp';
  import Icon from '#lib/Icon.svelte';
  import { companion } from '#lib/companion.svelte.ts';
  import { errorMessage } from '#lib/toast.svelte.ts';
  import { cameraAvailability, cameraFailure, devicePermissions, openCameraStream } from '#lib/device-permissions.svelte.ts';
  import { t , langStore} from '#lib/i18n.svelte.ts';;

  const invite = $derived(page.url.searchParams.get('invite'));
  let name = $state(guessName());
  let code = $state('');
  let pairing = $state(false);
  let error = $state('');
  let scannerAvailable = $state(false);
  let scanning = $state(false);
  let cameraPrompt = $state(false);
  let cameraDenied = $state(false);
  let cameraError = $state('');
  let cameraPending = $state(false);
  let cameraAttempt = 0;
  let video = $state<HTMLVideoElement>();
  let stream: MediaStream | undefined;
  let frame = 0;
  let lastScan = 0;
  let scanCanvas = $state<HTMLCanvasElement>();

  function guessName() {
    if (typeof navigator === 'undefined') return t('pair.name.my');
    const agent = navigator.userAgent;
    if (/iPhone/.test(agent)) return 'iPhone';
    if (/iPad/.test(agent)) return 'iPad';
    if (/Android/.test(agent)) return t('pair.name.android');
    if (/Mac/.test(agent)) return t('pair.name.mac');
    if (/Windows/.test(agent)) return t('pair.name.windows');
    return t('pair.name.my');
  }

  onMount(() => {
    scannerAvailable = cameraAvailability() === 'prompt';
    devicePermissions.init();
    if (devicePermissions.camera === 'policy') cameraError = cameraFailure(undefined).message;
  });


  onDestroy(stopCamera);

  // Already paired: nothing to do here.
  $effect(() => {
    if (companion.booted && companion.paired && !pairing) void goto('/', { replaceState: true });
  });

  function stopCamera() {
    cameraAttempt++;
    cameraPending = false;
    if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
    frame = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    scanning = false;
    if (video) video.srcObject = null;
  }

  async function claim(source: { invite: string } | { code: string }) {
    error = '';
    pairing = true;
    stopCamera();
    try {
      await companion.claim(source, name.trim());
      await goto('/', { replaceState: true });
    } catch (e) {
      error = errorMessage(e);
    } finally {
      pairing = false;
    }
  }

  function handleCodeInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const compact = input.value.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
    code = compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (invite) void claim({ invite });
    else if (code.replace(/[^a-z0-9]/gi, '').length === 8) void claim({ code });
  }

  function inspectFrame() {
    if (!scanning || !video || !scanCanvas) return;
    frame = requestAnimationFrame(inspectFrame);
    if (performance.now() - lastScan < 120 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    lastScan = performance.now();
    const context = scanCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const scale = Math.min(1, 480 / video.videoWidth);
    scanCanvas.width = Math.round(video.videoWidth * scale);
    scanCanvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
    const pixels = context.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
    if (!result) return;
    try {
      const url = new URL(result.data, location.href);
      const token = url.searchParams.get('invite');
      if (!token) return;
      stopCamera();
      void claim({ invite: token });
    } catch {
      cameraError = t('pair.cameraerror.invalidqr');
    }
  }

  function startCamera() {
    cameraError = '';
    cameraDenied = false;
    // Skip the explainer once the browser has already granted the camera.
    if (devicePermissions.camera === 'granted') void allowCamera();
    else cameraPrompt = true;
  }

  async function allowCamera() {
    if (cameraPending) return;
    cameraError = '';
    cameraDenied = false;
    if (cameraAvailability() !== 'prompt') {
      const failure = cameraFailure(undefined);
      cameraError = failure.message;
      devicePermissions.markCamera(failure.state);
      return;
    }
    stopCamera();
    const attempt = cameraAttempt;
    cameraPending = true;
    let acquired = false;
    try {
      const nextStream = await openCameraStream();
      // A dismissed scanner/unmounted page must not keep a late grant running.
      if (attempt !== cameraAttempt) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = nextStream;
      acquired = true;
      cameraPrompt = false;
      devicePermissions.markCamera('granted');
      scanning = true;
      await tick();
      if (attempt !== cameraAttempt || !video) return stopCamera();
      video.srcObject = stream;
      await video.play();
      if (attempt === cameraAttempt) frame = requestAnimationFrame(inspectFrame);
    } catch (e) {
      if (attempt !== cameraAttempt) return;
      stopCamera();
      if (acquired) {
        // Playback failure is not permission denial: the camera was acquired.
        cameraError = t('pair.cameraerror.preview');
      } else {
        const failure = cameraFailure(e);
        cameraDenied = failure.state === 'denied';
        devicePermissions.markCamera(failure.state);
        cameraError = failure.message;
      }
    } finally {
      if (attempt === cameraAttempt) cameraPending = false;
    }
  }
$effect(() => { $langStore; });
</script>

<svelte:head><title>{t('pair.title')}</title></svelte:head>

<div class="wrap">
  <section class="card pair">
    <img src={logo} alt="Gentle Companion" width="64" height="64" />

    {#if companion.connection === 'revoked' && !invite}
      <span class="eyebrow">{t('pair.revoked.eyebrow')}</span>
      <h1>{t('pair.revoked.title')}</h1>
      <p class="muted">{t('pair.revoked.body1')}<strong>{t('pair.devices')}</strong>{t('pair.revoked.body2')}</p>
    {:else}
      <span class="eyebrow">{invite ? t('pair.eyebrow.invite') : t('pair.eyebrow.notpaired')}</span>
      <h1>{invite ? t('pair.h1.invite') : t('pair.h1.notpaired')}</h1>
      <p class="muted">{t('pair.intro')}</p>

      {#if !invite}
        <section class="scanner" aria-label={t('pair.scanner.label')}>
          {#if scannerAvailable}
            {#if scanning}
              <video bind:this={video} playsinline muted aria-label="Camera view for scanning the pairing QR code"></video>
              <button class="btn btn-ghost" type="button" onclick={stopCamera}>{t('pair.stopcamera')}</button>
            {:else if cameraPrompt}
              <div class="camera-permission" role="group" aria-label="Camera permission">
                <Icon name="devices" size={24} />
                <div>
                  <strong>{t('pair.camera.prompt')}</strong>
                  <p class="subtle">{t('pair.camera.explain')}</p>
                </div>
                <div class="camera-actions">
                  <button class="btn btn-primary" type="button" onclick={allowCamera} disabled={cameraPending}>{cameraPending ? t('pair.camera.requesting') : t('pair.camera.allow')}</button>
                  <button class="btn btn-ghost" type="button" onclick={() => { stopCamera(); cameraPrompt = false; }}>{t('pair.camera.notnow')}</button>
                </div>
              </div>
            {:else}
              <button class="btn" type="button" onclick={startCamera}><Icon name="devices" />{t('pair.camera.scan')}</button>
            {/if}
          {:else}
            <p class="subtle">
              {t('pair.scanner.unavail1')}
              <code>/pair?invite=…</code>
              {t('pair.scanner.unavail2')}
            </p>
          {/if}
          {#if cameraError}
            <p class="error" role="alert">{cameraError}</p>
            {#if cameraDenied}
              <p class="subtle small">On iPhone/iPad Safari: open Website Settings for this site, set Camera to Allow, reload, then scan again.</p>
            {/if}
          {/if}
          <canvas bind:this={scanCanvas} class="scan-canvas" aria-hidden="true"></canvas>
        </section>
        <div class="divider"><span>{t('pair.divider')}</span></div>
      {/if}

      <form onsubmit={submit}>
        {#if !invite}
          <div class="field">
            <label for="pair-code">{t('pair.code.label')}</label>
            <input id="pair-code" class="input pair-code" value={code} oninput={handleCodeInput} placeholder="XXXX-XXXX" maxlength="9" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required aria-describedby="pair-code-hint" />
            <span id="pair-code-hint" class="subtle small">{t('pair.code.hint')}</span>
          </div>
        {/if}
        <div class="field">
          <label for="device-name">{t('pair.name.label')}</label>
          <input id="device-name" class="input" bind:value={name} maxlength="80" required autocomplete="off" />
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button class="btn btn-primary" disabled={pairing || !name.trim() || (!invite && code.replace(/[^a-z0-9]/gi, '').length !== 8)}>{pairing ? t('pair.connecting') : t('pair.connect')}</button>
      </form>
      <p class="subtle small"><Icon name="check" size={14} />{t('pair.note')}</p>
    {/if}
  </section>
</div>

<style>
  .wrap {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
    background: radial-gradient(circle at 50% 0%, var(--accent-soft), transparent 60%);
  }

  .pair {
    width: min(460px, 100%);
    display: grid;
    gap: 12px;
    padding: 28px;
  }

  .pair img { border-radius: 15px; margin-bottom: 6px; }
  form { display: grid; gap: 14px; margin-top: 6px; }
  .field { display: grid; gap: 6px; }
  .field label { font-weight: 600; }
  .pair-code { font: 700 1.2rem/1 var(--mono); letter-spacing: 0.16em; }
  .scanner { display: grid; justify-items: center; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: var(--clay-radius); background: var(--surface-2); }
  .camera-permission { width: 100%; display: grid; gap: 10px; justify-items: start; }
  .camera-permission p { margin: 2px 0 0; }
  .camera-actions { display: flex; gap: 8px; flex-wrap: wrap; width: 100%; }
  .camera-actions .btn { min-height: 44px; }
  video { width: min(100%, 320px); max-height: 280px; border-radius: 14px; object-fit: cover; }
  .scan-canvas { display: none; }
  .divider { display: flex; align-items: center; gap: 12px; color: var(--text-3); font-size: 0.82rem; }
  .divider::before, .divider::after { content: ''; height: 1px; flex: 1; background: var(--border); }
  .error { color: var(--danger); font-size: 0.85rem; }
  .small { display: flex; gap: 6px; font-size: 0.8rem; }

  @media (max-width: 480px) { .pair { padding: 22px; } }
</style>
