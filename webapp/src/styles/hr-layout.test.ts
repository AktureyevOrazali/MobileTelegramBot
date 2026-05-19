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

  it('locks employee cards to equal row height', () => {
    expect(css).toContain('.hr-employee-grid {\n  display: grid;');
    expect(css).toContain('grid-auto-rows: minmax(210px, 1fr);');
    expect(css).toContain('.hr-employee-card {\n  min-height: 210px;');
  });

  it('keeps request and template layouts aligned', () => {
    expect(css).toContain('.hr-requests-grid {\n  display: grid;');
    expect(css).toContain('align-items: stretch;');
    expect(css).toContain('.hr-template-layout {\n  display: grid;');
  });
});
