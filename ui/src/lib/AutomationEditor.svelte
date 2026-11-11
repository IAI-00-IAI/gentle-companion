<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { automationDraft, automationTimezones, parseAutomationDraft } from './automations.ts';
  import { t } from './i18n.svelte.ts';
  import type { Automation, AutomationDraft } from './types.ts';
  let { automation, busy = false, onsave, oncancel }: { automation?: Automation; busy?: boolean; onsave: (draft: AutomationDraft) => Promise<void>; oncancel: () => void } = $props();
  const initial = untrack(() => automationDraft(automation));
  let name = $state(initial.name);
  let enabled = $state(initial.enabled);
  let scheduled = $state(initial.schedule !== null);
  let cron = $state(initial.schedule ?? '0 9 * * 1-5');
  let timezone = $state(initial.timezone ?? 'UTC');
  const timezones = $derived([...new Set([timezone, ...automationTimezones()])]);
  let historyLimit = $state<number | undefined>(initial.historyLimit ?? 30);
  let retries = $state<number | undefined>(initial.maxRetries);
  let interval = $state<number | undefined>(initial.retryIntervalSeconds);
  type Stage = 'preconditions' | 'actions' | 'postActions';
  type Step = { id: number; text: string };
  let nextId = 0;
  const makeSteps = (stage: Stage): Step[] => initial[stage].map(step => ({ id: nextId++, text: JSON.stringify(step, null, 2) }));
  let stages = $state<Record<Stage, Step[]>>({ preconditions: makeSteps('preconditions'), actions: makeSteps('actions'), postActions: makeSteps('postActions') });
  const labels = $derived<{ key: Stage; title: string; note: string }[]>([
    { key: 'preconditions' as Stage, title: t('automation.editor.stage.preconditions'), note: t('automation.editor.stage.preconditions.note') },
    { key: 'actions' as Stage, title: t('automation.editor.stage.actions'), note: t('automation.editor.stage.actions.note') },
    { key: 'postActions' as Stage, title: t('automation.editor.stage.postactions'), note: t('automation.editor.stage.postactions.note') }
  ]);
  let error = $state('');
  let stepErrors = $state<Record<number, string>>({});

  function translateAutomationError(message: string): string {
    const stepMatch = message.match(/^([^:]+): (.*)$/);
    if (stepMatch) {
      const label = stepMatch[1];
      const rest = stepMatch[2];
      const map: Record<string, string> = {
        'provide a JSON object.': 'automation.editor.error.step.object',
        'type must be command or pi.': 'automation.editor.error.step.type',
        'unknown field.': 'automation.editor.error.step.unknown',
        'provide a valid executable.': 'automation.editor.error.step.text',
        'provide a valid prompt.': 'automation.editor.error.step.text',
        'args must be an array of at most 100 valid strings.': 'automation.editor.error.step.args',
        'Pi requires an absolute workdir.': 'automation.editor.error.step.piworkdir',
        'working directory must be absolute.': 'automation.editor.error.step.workingdir',
        'timeout must be 1–86400 seconds.': 'automation.editor.error.step.timeout'
      };
      if (map[rest]) return t(map[rest], { label });
    }
    const sectionMatch = message.match(/^([a-zA-Z]+) must be an array\.$/);
    if (sectionMatch) return t('automation.editor.error.section.array', { section: sectionMatch[1] });
    const staticMap: Record<string, string> = {
      'The script must be a JSON object.': 'automation.editor.error.script.object',
      'Provide a name.': 'automation.editor.error.name',
      'enabled must be true or false.': 'automation.editor.error.enabled',
      'schedule must be a five-field cron expression or null.': 'automation.editor.error.schedule.type',
      'Name must contain 1–120 characters.': 'automation.editor.error.name.length',
      'Provide an IANA timezone.': 'automation.editor.error.timezone.provide',
      'Provide a valid IANA timezone, such as UTC or Asia/Jakarta.': 'automation.editor.error.timezone.invalid',
      'Unknown definition field.': 'automation.editor.error.definition.unknown',
      'Schedule needs five cron fields.': 'automation.editor.error.cron.fields',
      'Cron accepts numbers, *, ranges, lists, and steps.': 'automation.editor.error.cron.format',
      'Cron step is out of range.': 'automation.editor.error.cron.step',
      'Cron field is out of range.': 'automation.editor.error.cron.field',
      'Max retries must be an integer from 0 to 5.': 'automation.editor.error.maxretries',
      'Retry interval must be 1–86400 seconds.': 'automation.editor.error.retryinterval',
      'History limit must be 1–1000 runs.': 'automation.editor.error.historylimit',
      'Total retry delay must be shorter than the shortest scheduled trigger gap.': 'automation.editor.error.retrydelay',
      'Provide 1–50 steps, including at least one action.': 'automation.editor.error.steps.range',
      'Malformed JSON. Check quotes, commas, and brackets.': 'automation.editor.step.error.malformed',
      'Fix the highlighted steps before saving.': 'automation.editor.error.steps',
      'Could not save automation.': 'automation.editor.error.save'
    };
    if (staticMap[message]) return t(staticMap[message]);
    return message;
  }

  function add(stage: Stage, type: 'command' | 'pi') {
    stages[stage].push({ id: nextId++, text: JSON.stringify(type === 'command' ? { type, command: 'echo', args: ['Hello from Gentle Companion'] } : { type, prompt: 'Summarize this repository without changing files.', cwd: '/absolute/project' }, null, 2) });
  }
  function move(stage: Stage, index: number, delta: number) {
    const list = [...stages[stage]];
    [list[index], list[index + delta]] = [list[index + delta], list[index]];
    stages[stage] = list;
  }
  async function submit() {
    error = ''; stepErrors = {};
    const parsed: Record<Stage, unknown[]> = { preconditions: [], actions: [], postActions: [] };
    for (const { key } of labels) {
      for (const step of stages[key]) {
        try { parsed[key].push(JSON.parse(step.text)); }
        catch { stepErrors[step.id] = t('automation.editor.step.error.malformed'); }
      }
    }
    if (Object.keys(stepErrors).length) { error = t('automation.editor.error.steps'); return; }
    try {
      const draft = parseAutomationDraft(JSON.stringify({ name, enabled, schedule: scheduled ? cron : null, timezone, ...parsed, historyLimit,
        ...(retries !== undefined ? { maxRetries: retries } : {}), ...(interval !== undefined ? { retryIntervalSeconds: interval } : {}) }));
      await onsave(draft);
    } catch (cause) { error = translateAutomationError(cause instanceof Error ? cause.message : t('automation.editor.error.save')); }
  }
</script>
<form class="bento-card editor" onsubmit={event => { event.preventDefault(); void submit(); }}>
  <header><span class="eyebrow">{t('automation.editor.eyebrow')}</span><h2>{automation ? t('automation.editor.title.edit') : t('automation.editor.title.create')}</h2><p class="subtle">{t('automation.editor.intro')}</p></header>
  <fieldset disabled={busy}>
    <div class="fields"><label class="field wide">{t('automation.editor.name.label')}<input required maxlength="120" bind:value={name} placeholder={t('automation.editor.name.placeholder')} /></label><label class="check-field"><input type="checkbox" bind:checked={enabled} aria-describedby="schedule-enabled-hint" />{t('automation.editor.scheduled.label')}</label></div>
    <p class="hint" id="schedule-enabled-hint">{t('automation.editor.scheduled.hint')}</p>
    <section class="form-section"><div class="section-title"><Icon name="calendar" /><h3>{t('automation.editor.schedule.title')}</h3></div><label class="check-field"><input type="checkbox" bind:checked={scheduled} />{t('automation.editor.schedule.label')}</label>{#if scheduled}<div class="fields"><label class="field">{t('automation.editor.schedule.cron.label')}<input required bind:value={cron} placeholder={t('automation.editor.schedule.cron.placeholder')} spellcheck="false" /></label><label class="field">{t('automation.editor.schedule.timezone.label')}<select bind:value={timezone}>{#each timezones as zone}<option value={zone}>{zone}</option>{/each}</select></label></div><p class="hint">{t('automation.editor.schedule.hint', { timezone })}</p>{:else}<p class="hint">{t('automation.editor.manual.hint')}</p>{/if}</section>
    <section class="form-section"><div class="section-title"><Icon name="refresh" /><h3>{t('automation.editor.retries.title')}</h3></div><div class="fields"><label class="field">{t('automation.editor.retries.max.label')}<input type="number" min="0" max="5" step="1" bind:value={retries} placeholder={t('automation.editor.retries.max.placeholder')} /></label><label class="field">{t('automation.editor.retries.interval.label')}<input type="number" min="1" max="86400" step="1" bind:value={interval} placeholder={t('automation.editor.retries.interval.placeholder')} /></label></div><p class="hint">{t('automation.editor.retries.hint')}</p></section>
    <section class="form-section"><div class="section-title"><Icon name="archive" /><h3>{t('automation.editor.history.title')}</h3></div><label class="field">{t('automation.editor.history.label')}<input type="number" min="1" max="1000" step="1" bind:value={historyLimit} placeholder={t('automation.editor.history.placeholder')} /></label><p class="hint">{t('automation.editor.history.hint')}</p></section>
    {#each labels as stage, index}
      <section class="form-section"><div class="section-title"><span class="step-dot">{index + 1}</span><h3>{stage.title}</h3><span class="count">{t('automation.editor.steps.count', { n: stages[stage.key].length })}</span></div><p class="hint">{stage.note}</p>
        {#each stages[stage.key] as step, stepIndex (step.id)}<div class="step-editor"><div class="step-toolbar"><label for={'step-' + step.id}>{t('automation.editor.step.label', { n: stepIndex + 1 })}</label><div><button type="button" class="btn btn-sm" aria-label={t('automation.editor.step.aria.up', { n: stepIndex + 1 })} disabled={stepIndex === 0} onclick={() => move(stage.key, stepIndex, -1)}>↑</button><button type="button" class="btn btn-sm" aria-label={t('automation.editor.step.aria.down', { n: stepIndex + 1 })} disabled={stepIndex === stages[stage.key].length - 1} onclick={() => move(stage.key, stepIndex, 1)}>↓</button><button type="button" class="btn btn-sm btn-danger" aria-label={t('automation.editor.step.aria.remove', { n: stepIndex + 1 })} onclick={() => stages[stage.key] = stages[stage.key].filter(s => s.id !== step.id)}><Icon name="trash" size={14} /></button></div></div><textarea id={'step-' + step.id} bind:value={step.text} spellcheck="false" rows="7" aria-invalid={Boolean(stepErrors[step.id])} aria-describedby={stepErrors[step.id] ? 'error-' + step.id : undefined}></textarea>{#if stepErrors[step.id]}<p class="error" id={'error-' + step.id}>{stepErrors[step.id]}</p>{/if}</div>{/each}
        <div class="automation-actions"><button type="button" class="btn" onclick={() => add(stage.key, 'command')}><Icon name="plus" size={15} />{t('automation.editor.action.command')}</button><button type="button" class="btn" onclick={() => add(stage.key, 'pi')}><Icon name="brain" size={15} />{t('automation.editor.action.pi')}</button></div>
      </section>
    {/each}
  </fieldset>
  <p class="hint">{t('automation.editor.footer.hint')}</p>
  {#if error}<p class="validation-error" role="alert">{error}</p>{/if}
  <footer class="automation-actions"><button class="btn btn-primary" disabled={busy}><Icon name="check" />{busy ? t('automation.editor.save.busy') : t('automation.editor.save')}</button><button type="button" class="btn" disabled={busy} onclick={oncancel}>{t('automation.editor.cancel')}</button></footer>
</form>
<style>
  .editor { display: grid; gap: 20px; } header p { font-size: .8rem; margin-top: 8px; } fieldset { margin: 0; padding: 0; border: 0; min-width: 0; } .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: center; } .wide { grid-column: 1 / -1; } .field { display: grid; gap: 8px; font-size: .77rem; font-weight: 650; } .check-field { display: flex; gap: 10px; align-items: center; font-size: .8rem; min-height: 44px; } .check-field input { min-height: auto; width: 18px; height: 18px; accent-color: var(--accent); box-shadow: none; } .form-section { display: grid; gap: 14px; border-top: 1px solid var(--border); padding-top: 22px; margin-top: 22px; } .section-title { display: flex; align-items: center; gap: 10px; } h3 { font-size: .88rem; } .count { margin-left: auto; color: var(--text-2); font-size: .7rem; } .hint { font-size: .75rem; color: var(--text-2); line-height: 1.7; } .step-editor { padding: 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--clay-soft); } .step-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; } .step-toolbar label { font-size: .72rem; font-weight: 650; } .step-toolbar > div { display: flex; gap: 6px; } textarea { width: 100%; min-height: 160px; resize: vertical; padding: 14px; background: var(--code-bg); border: 1px solid var(--border-strong); border-radius: 12px; font-family: var(--mono); font-size: .76rem; line-height: 1.7; } textarea[aria-invalid='true'] { border-color: var(--danger); } .validation-error { color: var(--danger); padding: 14px; border-radius: 12px; border: 1px solid var(--danger); background: var(--danger-soft); font-size: .8rem; } @media(max-width: 550px) { .fields { grid-template-columns: 1fr; } }
</style>
