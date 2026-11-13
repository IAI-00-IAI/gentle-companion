import { t } from './i18n.svelte.ts';

export function isPageAssetError(error: unknown): boolean {
  return error instanceof Error && /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(error.message);
}

export function pageError(status: number, message?: string): { title: string; message: string } {
  if (message === 'Page assets unavailable') return {
    title: t('error.assets.title'),
    message: t('error.assets.message')
  };
  if (status === 404) return {
    title: t('error.404.title'),
    message: t('error.404.message')
  };
  if (status === 401 || status === 403) return {
    title: t('error.access.title'),
    message: t('error.access.message')
  };
  if (status >= 500) return {
    title: t('error.server.title'),
    message: t('error.server.message')
  };
  return {
    title: t('error.fallback.title'),
    message: t('error.fallback.message')
  };
}
