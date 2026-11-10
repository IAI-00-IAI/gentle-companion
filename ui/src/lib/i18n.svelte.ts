export type Locale = 'en' | 'es';

export const LOCALES: Locale[] = ['en', 'es'];

interface MessageSet {
  [key: string]: string;
}

const messages: Record<Locale, MessageSet> = {
  en: {
    'locale.en': 'English',
    'locale.es': 'Spanish',
    'count': '{count} {label}',
    'status.online': 'Online',
    'status.disconnected': 'Disconnected',
    'status.connecting': 'Connecting',
    'status.idle': 'Idle',
    'status.active': 'Active',
    'status.stopped': 'Stopped',
    'status.archived': 'Archived',
    'hero.eyebrow.admin': 'Gentle Companion',
    'hero.eyebrow.linked': 'Linked to your computer',
    'hero.title': 'Go grab a coffee.',
    'hero.accent': 'Pi’ll ping you.',
    'hero.body': 'Pi keeps chipping away on your computer while you’re off doing other stuff. Check in from your phone, answer when it gets stuck, nudge it in a new direction or toss it a file. No need to sit by the terminal.',
    'hero.cta.sessions': 'See what Pi’s up to',
    'hero.cta.help': 'How it works',
    'hero.cta.devices': 'Add your phone',
    'hero.journey.1': 'Pi works',
    'hero.journey.2': 'Your computer',
    'hero.journey.3': 'You check in',
    'hero.field.label': 'Gentle Shell mark and workspace views',
    'stat.running.label': 'Running',
    'stat.running.hint.busy': 'Pi is busy on {{count}}',
    'stat.running.hint.quiet': 'All quiet for now',
    'stat.waiting.label': 'Waiting on you',
    'stat.waiting.hint.busy': 'Pi has a question for you',
    'stat.waiting.hint.idle': 'Nothing to answer',
    'stat.devices.label': 'Your devices',
    'stat.devices.hint.online': '{{count}} online now',
    'stat.devices.hint.none': 'None online right now',
    'stat.devices.hint.no': 'No phone paired yet',
    'stat.phone.label': 'On your phone',
    'stat.phone.hint': 'Sessions you can reach from your devices',
    'guide.title': 'First time here?',
    'guide.body': 'It takes about two minutes: install it, switch it on in Pi, scan a code with your phone. Done.',
    'guide.cta': 'Show me how',
    'needs.title': 'Pi’s waiting on you',
    'running.title': 'Running now',
    'running.sub': 'Your shared sessions, at a glance.',
    'running.viewall': 'All sessions',
    'running.filter.all': 'All',
    'running.filter.working': 'Working',
    'running.filter.idle': 'Idle',
    'running.empty.waiting': 'Every session is waiting on your answer.',
    'running.empty.nomatch': 'No sessions match this filter.',
    'running.empty.unreachable.title': 'Can’t reach your computer right now',
    'running.empty.unreachable.body': 'Hang tight. We’ll keep trying, and everything shows up again as soon as it’s back.',
    'running.empty.norunning.title': 'Nothing running yet',
    'running.empty.norunning.body': 'Type /companion in any Pi session and it’ll pop up here. Haven’t installed it yet? The guide walks you through it.',
    'running.empty.noshared.title': 'Nothing shared with you yet',
    'running.empty.noshared.body': 'On the computer running Pi, type /companion in a session to share it. It’ll show up here right away.',
    'automations.title': 'Your automations',
    'automations.sub': 'Your repeatable routines, ready when you need them.',
    'automations.viewall': 'All automations',
    'automations.filter.all': 'All',
    'automations.filter.enabled': 'Enabled',
    'automations.filter.disabled': 'Disabled',
    'automations.error': 'Automations are unavailable right now: {{error}}',
    'automations.loading': 'Loading your automations…',
    'automations.empty.title': 'A little less busywork',
    'automations.empty.body': 'Set up your first automation on the desktop dashboard, or ask Pi to create one for you.',
    'automations.cta': 'Explore automations',
    'automations.empty.nomatch': 'No automations match this filter.',
    'hero.journey.label': 'How it connects',
    'running.filter.label': 'Filter running sessions',
    'automations.filter.label': 'Filter automations',
    'lang.label': 'Language',
  },
  es: {
    'locale.en': 'Inglés',
    'locale.es': 'Español',
    'count': '{count} {label}',
    'status.online': 'En línea',
    'status.disconnected': 'Desconectado',
    'status.connecting': 'Conectando',
    'status.idle': 'Inactivo',
    'status.active': 'Activo',
    'status.stopped': 'Detenido',
    'status.archived': 'Archivado',
    'hero.eyebrow.admin': 'Gentle Companion',
    'hero.eyebrow.linked': 'Conectado a tu ordenador',
    'hero.title': 'Ve a tomar un café.',
    'hero.accent': 'Pi te avisará.',
    'hero.body': 'Pi sigue trabajando en tu ordenador mientras haces otras cosas. Revisa desde tu teléfono, contesta cuando se atasque, dale una nueva dirección o mándale un archivo. No necesitas quedarte junto al terminal.',
    'hero.cta.sessions': 'Ver qué está haciendo Pi',
    'hero.cta.help': 'Cómo funciona',
    'hero.cta.devices': 'Añade tu teléfono',
    'hero.journey.1': 'Pi trabaja',
    'hero.journey.2': 'Tu ordenador',
    'hero.journey.3': 'Tú te informas',
    'hero.field.label': 'Marca de Gentle Shell y vistas del espacio de trabajo',
    'stat.running.label': 'En ejecución',
    'stat.running.hint.busy': 'Pi está ocupado con {{count}}',
    'stat.running.hint.quiet': 'Todo tranquilo por ahora',
    'stat.waiting.label': 'Esperando tu respuesta',
    'stat.waiting.hint.busy': 'Pi tiene una pregunta para ti',
    'stat.waiting.hint.idle': 'No hay nada que contestar',
    'stat.devices.label': 'Tus dispositivos',
    'stat.devices.hint.online': '{{count}} en línea ahora',
    'stat.devices.hint.none': 'Ninguno en línea por ahora',
    'stat.devices.hint.no': 'Aún no has emparejado un teléfono',
    'stat.phone.label': 'En tu teléfono',
    'stat.phone.hint': 'Sesiones a las que puedes acceder desde tus dispositivos',
    'guide.title': '¿Primera vez aquí?',
    'guide.body': 'Solo lleva unos dos minutos: instálalo, actívalo en Pi y escanea un código con tu teléfono. Listo.',
    'guide.cta': 'Muéstrame cómo',
    'needs.title': 'Pi está esperando tu respuesta',
    'running.title': 'En ejecución ahora',
    'running.sub': 'Tus sesiones compartidas, de un vistazo.',
    'running.viewall': 'Todas las sesiones',
    'running.filter.all': 'Todas',
    'running.filter.working': 'Trabajando',
    'running.filter.idle': 'Inactivas',
    'running.empty.waiting': 'Todas las sesiones esperan tu respuesta.',
    'running.empty.nomatch': 'No hay sesiones que coincidan con este filtro.',
    'running.empty.unreachable.title': 'No puedo alcanzar tu ordenador ahora',
    'running.empty.unreachable.body': 'Mantente a la espera. Seguiremos intentándolo y todo volverá a aparecer en cuanto vuelva.',
    'running.empty.norunning.title': 'Todavía no hay nada en ejecución',
    'running.empty.norunning.body': 'Escribe /companion en cualquier sesión de Pi y aparecerá aquí. ¿Todavía no lo has instalado? La guía te lo explica.',
    'running.empty.noshared.title': 'Todavía no se te ha compartido nada',
    'running.empty.noshared.body': 'En el ordenador donde corre Pi, escribe /companion en una sesión para compartirla. Aparecerá aquí de inmediato.',
    'automations.title': 'Tus automatizaciones',
    'automations.sub': 'Tus rutinas repetibles, listas cuando las necesites.',
    'automations.viewall': 'Todas las automatizaciones',
    'automations.filter.all': 'Todas',
    'automations.filter.enabled': 'Activadas',
    'automations.filter.disabled': 'Desactivadas',
    'automations.error': 'Las automatizaciones no están disponibles ahora: {{error}}',
    'automations.loading': 'Cargando tus automatizaciones…',
    'automations.empty.title': 'Un poco menos de trabajo pesado',
    'automations.empty.body': 'Configura tu primera automatización en el panel de escritorio o pide a Pi que cree una para ti.',
    'automations.cta': 'Explora automatizaciones',
    'automations.empty.nomatch': 'No hay automatizaciones que coincidan con este filtro.',
    'hero.journey.label': 'Cómo se conecta',
    'running.filter.label': 'Filtrar sesiones en ejecución',
    'automations.filter.label': 'Filtrar automatizaciones',
    'lang.label': 'Idioma',
  },
};

const LANG_STORAGE_KEY = 'gentle-companion:lang';

function storedLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  return stored === 'en' || stored === 'es' ? stored : 'en';
}

export let lang = $state<Locale>(storedLocale());

export function setLang(next: Locale): void {
  lang = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LANG_STORAGE_KEY, next);
  }
}

export function t(
  key: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  let value: string | undefined = messages[lang][key];
  if (value === undefined) value = messages.en[key];
  if (value === undefined) return key;
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_m, group) => {
    const raw = params[group];
    return raw === undefined || raw === null ? '' : String(raw);
  });
}

export function localeName(locale: Locale): string {
  return t('locale.' + locale);
}
