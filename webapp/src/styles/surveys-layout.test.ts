import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDir, 'modern-overrides.css'), 'utf8');
const surveysCss = readFileSync(resolve(currentDir, 'surveys.css'), 'utf8');
const normalizedCss = css.replace(/\r\n/g, '\n');
const normalizedSurveysCss = surveysCss.replace(/\r\n/g, '\n');

describe('surveys app-sidebar layout', () => {
  it('keeps tabs and analytics content in separate grid rows', () => {
    expect(normalizedCss).toContain('grid-template-rows: auto auto minmax(0, 1fr) !important;');
  });

  it('locks the survey shell while only the analytics body scrolls', () => {
    expect(normalizedCss).toContain('.app-shell--surveys .app-main--sidebar .app-page-transition {\n  display: flex !important;');
    expect(normalizedCss).toContain('.app-shell--surveys .surveys-page--app-sidebar {\n  height: calc(100vh - 28px) !important;');
    expect(normalizedCss).toContain('.app-shell--surveys .surveys-page--app-sidebar .surveys-analytics-panel {\n  min-height: 0 !important;');
    expect(normalizedCss).toContain('.app-shell--surveys .surveys-page--app-sidebar .surveys-analytics-panel > .surveys-panel__body {\n  min-height: 0 !important;\n  overflow-y: auto !important;');
    expect(normalizedCss).toContain('.app-shell--surveys .surveys-page--app-sidebar > .surveys-assessment {\n  min-height: 0 !important;\n  overflow-y: auto !important;');
  });

  it('overrides survey sidebar surfaces and form controls in dark theme', () => {
    expect(normalizedCss).toContain('[data-theme=\'dark\'] .app-shell--surveys .surveys-page--app-sidebar {');
    expect(normalizedCss).toContain('[data-theme=\'dark\'] .app-shell--surveys .surveys-page--app-sidebar .surveys-hero,');
    expect(normalizedCss).toContain('[data-theme=\'dark\'] .app-shell--surveys .surveys-page--app-sidebar .surveys-question-card,');
    expect(normalizedCss).toContain('[data-theme=\'dark\'] .app-shell--surveys .surveys-page--app-sidebar .surveys-assessment-card,');
    expect(normalizedCss).toContain('background: var(--surface-color) !important;');
    expect(normalizedCss).toContain('[data-theme=\'dark\'] .app-shell--surveys .surveys-page--app-sidebar .surveys-field input,');
    expect(normalizedCss).toContain('background: var(--input-bg) !important;');
  });
});

describe('employee assessment analytics styling', () => {
  it('uses dashboard-style progress rhythm for assessment charts', () => {
    expect(normalizedSurveysCss).toContain('grid-template-columns: minmax(112px, 0.7fr) minmax(180px, 1.3fr) 42px;');
    expect(normalizedSurveysCss).toContain('height: 8px;\n  overflow: hidden;\n  border-radius: 999px;\n  background: #e8eef7;');
    expect(normalizedSurveysCss).toContain('background: linear-gradient(90deg, #5a7ab8, #3d5a8f);');
    expect(normalizedSurveysCss).toContain('.surveys-assessment-series {\n  display: flex;\n  justify-content: flex-end;');
  });

  it('stretches the character card content through the available card height', () => {
    expect(normalizedSurveysCss).toContain('.surveys-assessment-card--character {\n  display: flex;\n  flex-direction: column;');
    expect(normalizedSurveysCss).toContain('.surveys-assessment-card--character .surveys-assessment-character {\n  flex: 1;');
  });

  it('centers the donut label and limits assessment tables to five visible rows', () => {
    expect(normalizedSurveysCss).toContain('.surveys-assessment-donut__stage {\n  position: relative;\n  width: 120px;\n  height: 130px;');
    expect(normalizedSurveysCss).toContain('.surveys-assessment-donut__center {\n  position: absolute;\n  inset: 0;');
    expect(normalizedSurveysCss).toContain('.surveys-assessment-table-wrap--limited {\n  max-height: 292px;\n  overflow: auto;');
  });
});
