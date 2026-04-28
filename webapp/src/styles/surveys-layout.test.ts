import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDir, 'modern-overrides.css'), 'utf8');
const normalizedCss = css.replace(/\r\n/g, '\n');

describe('surveys app-sidebar layout', () => {
  it('keeps tabs and analytics content in separate grid rows', () => {
    expect(normalizedCss).toContain('grid-template-rows: auto auto minmax(0, 1fr) !important;');
  });

  it('locks the survey shell while only the analytics body scrolls', () => {
    expect(normalizedCss).toContain('.app-shell--surveys .app-main--sidebar .app-page-transition {\n  display: flex !important;');
    expect(normalizedCss).toContain('.app-shell--surveys .surveys-page--app-sidebar {\n  height: calc(100vh - 28px) !important;');
    expect(normalizedCss).toContain('.app-shell--surveys .surveys-page--app-sidebar .surveys-analytics-panel {\n  min-height: 0 !important;');
    expect(normalizedCss).toContain('.app-shell--surveys .surveys-page--app-sidebar .surveys-analytics-panel > .surveys-panel__body {\n  min-height: 0 !important;\n  overflow-y: auto !important;');
  });
});
