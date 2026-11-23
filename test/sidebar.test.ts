import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const layout = readFileSync(new URL('../ui/src/routes/+layout.svelte', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../ui/src/app.css', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../ui/src/lib/i18n.svelte.ts', import.meta.url), 'utf8');

/** The slice of the sidebar that owns the brand block, nav and footer. */
const sidebar = layout.slice(layout.indexOf('<aside class="sidebar'), layout.indexOf('</aside>'));

test('the title block toggles the sidebar and the logo stays a separate home link', () => {
  const brand = sidebar.slice(sidebar.indexOf('<div class="brand">'), sidebar.indexOf('</div>\n\n      <nav'));

  // The title block is a real button that reports the collapse state.
  assert.match(brand, /<button\s[^>]*class="brand-title"[^>]*type="button"/s);
  assert.match(brand, /aria-expanded=\{sidebarExpanded\}/);
  assert.match(brand, /aria-controls="sidebar-nav"/);
  assert.match(brand, /<strong>Gentle Companion<\/strong>/);
  assert.match(brand, /onclick=\{toggleSidebar\}/);
  // The button's accessible name states the action, not the state.
  assert.match(brand, /aria-label=\{sidebarTitle\}/);
  assert.match(layout, /sidebarExpanded \? t\('shell\.sidebar\.collapse'\) : t\('shell\.sidebar\.expand'\)/);

  // The logo plus mark stay a link to home, outside the button.
  assert.match(brand, /<a class="brand-home" href="\/" title=\{t\('shell\.sidebar\.home\.title'\)\}/);
  assert.match(brand, /<img src=\{logo\} alt="" width="36" height="36" \/>/);
  assert.match(brand, /<span class="brand-mark" aria-hidden="true">✿<\/span>/);
  assert.equal(brand.match(/<button/g)?.length, 1);
  assert.equal(brand.match(/<a /g)?.length, 1);

  // No visible toggler was added anywhere: the title is the only mechanism.
  assert.ok(!/class="[^"]*sidebar-toggle/.test(layout));
  assert.ok(!sidebar.includes('<Icon name="minimize"'));
  assert.ok(!sidebar.includes('<Icon name="maximize"'));
});

test('the nav the trigger controls exists and keeps its accessible name', () => {
  assert.match(sidebar, /<nav class="nav" id="sidebar-nav" aria-label=\{t\('shell\.nav\.aria'\)\}>/);
  assert.equal(layout.match(/aria-controls="sidebar-nav"/g)?.length, 1);
  assert.equal(layout.match(/id="sidebar-nav"/g)?.length, 1);
});

test('collapsing hides the visible label but keeps an accessible name on every nav link', () => {
  const nav = sidebar.slice(sidebar.indexOf('<nav class="nav"'), sidebar.indexOf('</nav>') + 6);
  assert.match(nav, /aria-label=\{item\.label\}/);
  assert.match(nav, /title=\{item\.label\}/);
  assert.match(nav, /<span class="nav-label">\{item\.label\}<\/span>/);

  // Collapse styles hide the text labels and keep the icons and status dot.
  assert.match(layout, /\.shell\.sidebar-collapsed \.nav-label,[\s\S]*?display: none;/);
  assert.match(layout, /\.shell\.sidebar-collapsed \.status-label,/);
  assert.match(layout, /\.shell\.sidebar-collapsed \.brand-text,/);
  // The nav link contains only the icon and the label span, so hiding the label leaves the icon.
  assert.ok(!/\.shell\.sidebar-collapsed \.nav a \{[^}]*display: none/s.test(layout));
  assert.ok(!/\.shell\.sidebar-collapsed \.sidebar\s*\{[^}]*display: none/s.test(layout));
});

test('the status trigger keeps its dot when collapsed', () => {
  const foot = sidebar.slice(sidebar.indexOf('<div class="sidebar-foot">'));
  assert.match(foot, /class="status status-trigger"[^>]*aria-haspopup="dialog"/);
  assert.match(foot, /<span class="dot \{companion\.connection\}" aria-hidden="true"><\/span>/);
  assert.match(foot, /<span class="status-label">\{connectionLabel\}<\/span>/);
});

test('collapse is a persisted preference, never inferred from the viewport', () => {
  assert.match(layout, /const SIDEBAR_KEY = 'pi-companion-sidebar'/);
  assert.match(layout, /localStorage\.setItem\(SIDEBAR_KEY, sidebarCollapsed \? 'collapsed' : 'expanded'\)/);
  assert.match(layout, /sidebarCollapsed = localStorage\.getItem\(SIDEBAR_KEY\) === 'collapsed'/);
  // Absent key starts expanded.
  assert.match(layout, /let sidebarCollapsed = \$state\(false\)/);
  // No viewport measurement decides the state.
  assert.ok(!/innerWidth|matchMedia\([^)]*\)[\s\S]{0,80}sidebarCollapsed/.test(layout));
});

test('the collapsed grid stays off the mobile layouts that hide the sidebar', () => {
  // The collapse rules live inside a min-width query so they cannot apply where
  // .sidebar is display: none and the tabbar replaced the navigation.
  const guard = layout.slice(layout.indexOf('.shell.sidebar-collapsed { grid-template-columns'));
  const mediaStart = layout.lastIndexOf('@media (min-width: 901px)', layout.indexOf('.shell.sidebar-collapsed { grid-template-columns'));
  assert.ok(mediaStart > -1);
  assert.ok(layout.indexOf('.shell.sidebar-collapsed { grid-template-columns') > mediaStart);
  assert.match(guard, /grid-template-columns: var\(--sidebar-collapsed\) minmax\(0, 1fr\)/);
  // The mobile media queries keep the sidebar hidden and the single column intact.
  assert.match(layout, /@media \(max-width: 900px\) \{\s*\.shell \{\s*grid-template-columns: minmax\(0, 1fr\);[\s\S]*?\.sidebar \{\s*display: none;/);
  // The base desktop grid still uses the original token, and collapse adds a second.
  assert.match(layout, /\.shell \{\s*height: 100dvh;\s*display: grid;\s*grid-template-columns: var\(--sidebar\) minmax\(0, 1fr\);/);
  assert.match(appCss, /--sidebar: 244px;/);
  assert.match(appCss, /--sidebar-collapsed: 68px;/);
});

test('new strings exist in both locales', () => {
  const en = i18n.slice(i18n.indexOf('  en: {'), i18n.indexOf('  es: {'));
  const es = i18n.slice(i18n.indexOf('  es: {'));
  for (const key of ['shell.sidebar.collapse', 'shell.sidebar.expand', 'shell.sidebar.home.title']) {
    assert.match(en, new RegExp(`'${key.replace(/\./g, '\\.')}': '`, 'u'));
    assert.match(es, new RegExp(`'${key.replace(/\./g, '\\.')}': '`, 'u'));
  }
  assert.match(en, /'shell\.sidebar\.collapse': 'Collapse menu'/);
  assert.match(en, /'shell\.sidebar\.expand': 'Expand menu'/);
  assert.match(en, /'shell\.sidebar\.home\.title': 'Go to home'/);
  assert.match(es, /'shell\.sidebar\.collapse': 'Replegar menú'/);
  assert.match(es, /'shell\.sidebar\.expand': 'Desplegar menú'/);
  assert.match(es, /'shell\.sidebar\.home\.title': 'Ir a inicio'/);
  // No key is left behind in only one locale.
  assert.equal(en.match(/shell\.sidebar\./g)?.length, es.match(/shell\.sidebar\./g)?.length);
});
