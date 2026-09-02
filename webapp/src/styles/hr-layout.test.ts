import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDir, 'hr.css'), 'utf8').replace(/\r\n/g, '\n');

describe('HR layout CSS', () => {
  it('uses compact aligned cards instead of a large hero', () => {
    expect(css).toContain('.hr-header {\n  display: grid;');
    expect(css).toContain('border-radius: var(--radius-md);');
    expect(css).toContain('.hr-stat-grid {\n  display: grid;');
    expect(css).toContain('align-items: stretch;');
  });

  it('keeps employee cards as a compact one-row list', () => {
    expect(css).toContain('font-family: var(--font-sans);');
    expect(css).toContain('.hr-employee-grid {\n  display: grid;');
    expect(css).toContain('grid-template-columns: 1fr;');
    expect(css).toContain('grid-auto-rows: minmax(58px, auto);');
    expect(css).toContain('.hr-employee-card {\n  min-height: 58px;');
    expect(css).toContain('grid-template-columns: 34px minmax(0, 1fr) minmax(78px, 0.45fr) auto;');
    expect(css).toContain('box-shadow: none;');
  });

  it('stretches the employee side panel as a larger right card', () => {
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(340px, 420px);');
    expect(css).toContain('align-items: stretch;');
    expect(css).toContain('height: 100%;');
    expect(css).toContain('.hr-side-panel {\n  position: static;');
  });

  it('locks the HR shell while scrolling only the employee list', () => {
    expect(css).toContain('.app-shell--hr .app-main--sidebar {\n  display: flex;');
    expect(css).toContain('.app-shell--hr .app-main--sidebar .app-page-transition {\n  flex: 1 1 auto;');
    expect(css).toContain('.app-shell--hr .hr-page {\n  flex: 1 1 auto;');
    expect(css).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(css).toContain('.hr-panel {\n  min-width: 0;\n  min-height: 0;\n  overflow-x: hidden;\n  overflow-y: auto;');
    expect(css).toContain('.hr-panel--employees {\n  overflow: hidden;');
    expect(css).toContain('.hr-employee-grid {\n  display: grid;');
    expect(css).toContain('overflow-y: auto;');
  });

  it('keeps request and template layouts aligned', () => {
    expect(css).toContain('.hr-requests-grid {\n  display: grid;');
    expect(css).toContain('align-items: stretch;');
    expect(css).toContain('.hr-template-layout {\n  display: grid;');
  });

  it('keeps the employee requests page compact and evenly aligned', () => {
    expect(css).toContain('.hr-employee-requests-layout {\n  display: grid;');
    expect(css).toContain('grid-template-columns: minmax(250px, 300px) minmax(640px, 1fr) minmax(280px, 360px);');
    expect(css).toContain('.hr-page--employee .hr-request-wizard {\n  display: contents;');
    expect(css).toContain('.hr-page--employee .hr-template-preview {\n  gap: 12px;');
    expect(css).toContain('.hr-employee-request-editor {\n  display: grid;');
    expect(css).toContain('grid-template-columns: minmax(500px, 1fr) minmax(250px, 320px);');
    expect(css).toContain('.hr-employee-request-document-column {\n  display: grid;');
    expect(css).toContain('.hr-employee-request-fields {\n  display: grid;');
    expect(css).toContain('.hr-employee-request-date-stack {\n  display: grid;');
    expect(css).toContain('.hr-employee-request-bottom {\n  display: grid;');
    expect(css).toContain('.hr-employee-request-reason {\n  grid-column: 1 / -1;');
    expect(css).toContain('.hr-page--employee .hr-document-preview {\n  width: min(100%, 410px, 44dvh);');
    expect(css).toContain('aspect-ratio: 210 / 297;');
    expect(css).toContain('.hr-document-preview--hr-detail {\n  grid-template-rows: auto minmax(0, auto) auto auto;\n  gap: 14px;\n  width: min(100%, 300px, 32dvh);');
    expect(css).toContain('.hr-requests-grid > .hr-detail-card {\n  align-self: stretch;\n  height: 100%;');
    expect(css).toContain('.hr-requests-grid > .hr-detail-card .hr-detail-card__actions {\n  margin-top: auto;');
    expect(css).toContain('.hr-request-row--employee {\n  grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('min-height: 62px;');
    expect(css).toContain('overflow: hidden;');
    expect(css).toContain('.hr-request-row__summary {\n  display: grid;');
  });

  it('fits non-employee HR sections into the available viewport', () => {
    expect(css).toContain('.app-shell--hr .hr-page,\n.app-shell--hr .hr-page * {\n  font-family: var(--font-sans) !important;');
    expect(css).toContain('.hr-panel:not(.hr-panel--employees) {\n  overflow: hidden;');
    expect(css).toContain('.hr-requests-grid,\n.hr-template-layout,\n.hr-calendar-shell,\n.hr-archive-table-wrap {\n  height: 100%;');
    expect(css).toContain('.hr-detail-card {\n  gap: 10px;\n  padding: 14px;\n  overflow-x: hidden;\n  overflow-y: auto;');
    expect(css).toContain('.hr-document-preview-shell {\n  flex: 0 0 auto;\n  display: flex;\n  min-height: 250px;\n  align-items: center;');
    expect(css).toContain('.hr-document-preview {\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr) auto;');
    expect(css).toContain('width: min(100%, clamp(260px, 40dvh, 420px));');
    expect(css).toContain('aspect-ratio: 210 / 297;');
    expect(css).toContain('font-size: 0.76rem;');
    expect(css).toContain('.hr-document-preview__to {\n  display: grid;\n  gap: 8px;\n  justify-self: end;\n  width: 46%;');
    expect(css).toContain('font-size: 0.82rem;');
    expect(css).toContain('.hr-document-preview__body {\n  align-self: center;');
    expect(css).toContain('.hr-detail-card__actions {\n  display: flex;\n  flex-wrap: wrap;');
    expect(css).toContain('.hr-decision-comment {\n  display: grid;\n  gap: 6px;\n  width: 100%;');
    expect(css).toContain('gap: 9px;');
    expect(css).toContain('border-top: 1px solid var(--border-color);');
    expect(css).toContain('.hr-decision-actions__group {\n  display: flex;');
    expect(css).toContain('.hr-decision-comment textarea {\n  min-height: 54px;');
    expect(css).toContain('.hr-calendar-month {\n  display: grid;\n  grid-template-columns: repeat(7, minmax(96px, 1fr));');
    expect(css).toContain('grid-template-rows: 30px repeat(6, minmax(62px, 1fr));');
    expect(css).toContain('.hr-calendar-day {\n  display: grid;\n  align-content: start;');
    expect(css).toContain('overflow-y: auto;');
    expect(css).toContain('scrollbar-width: thin;');
  });

  it('defines HR entrance and tab opening animations', () => {
    expect(css).toContain('@keyframes hr-panel-enter');
    expect(css).toContain('@keyframes hr-card-enter');
    expect(css).toContain('.hr-panel {\n  min-width: 0;');
    expect(css).toContain('animation: hr-panel-enter var(--motion-base)');
    expect(css).toContain('.hr-request-row,\n.hr-template-item,\n.hr-employee-card,\n.hr-calendar-event {');
    expect(css).toContain('animation: hr-card-enter 320ms');
    expect(css).toContain('.hr-side-panel {\n  position: static;');
    expect(css).toContain('animation: hr-side-panel-enter 300ms');
    expect(css).toContain('@media (prefers-reduced-motion: reduce) {\n  .hr-page,');
  });
});
