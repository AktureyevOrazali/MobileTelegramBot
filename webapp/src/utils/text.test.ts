import { describe, expect, it } from 'vitest';
import { sanitizeUiText } from './text';

describe('sanitizeUiText', () => {
  it('repairs mojibake with latin P/C marker characters', () => {
    expect(sanitizeUiText('PђPґPјPёPЅPёCЃC‚CЂP°C‚PѕCЂ')).toBe('Администратор');
  });
});
