const MEDIA_PLACEHOLDER_RE = /^\[?(photo|image|video|document|file|attachment)(?:\s+message)?\]?$/i;
const ONLY_BROKEN_SYMBOLS_RE = /^[\s\uFFFD.,:;!?()[\]{}\-_'"`~]+$/;
const MOJIBAKE_HINT_RE = /(?:Р.|С.|Ð.|Ñ.){2,}/;
const CP1251_DECODER = new TextDecoder('windows-1251');
const CP1251_REVERSE = new Map<string, number>();

for (let byte = 0; byte <= 0xff; byte += 1) {
  CP1251_REVERSE.set(CP1251_DECODER.decode(new Uint8Array([byte])), byte);
}

function encodeCp1251(value: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const char of value) {
    const byte = CP1251_REVERSE.get(char);
    if (byte === undefined) {
      return null;
    }
    bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

function countCyrillic(value: string): number {
  const matches = value.match(/[\u0400-\u04ff]/g);
  return matches ? matches.length : 0;
}

function repairMojibake(value: string): string | null {
  if (!MOJIBAKE_HINT_RE.test(value)) {
    return null;
  }

  const bytes = encodeCp1251(value);
  if (!bytes) {
    return null;
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    if (!decoded || decoded === value) {
      return null;
    }
    if (countCyrillic(decoded) < countCyrillic(value)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function sanitizeUiText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const repaired = repairMojibake(normalized) ?? normalized;
  if (ONLY_BROKEN_SYMBOLS_RE.test(repaired)) return null;
  if (!repaired.includes('\uFFFD')) return repaired;

  const cleaned = repaired.replace(/\uFFFD+/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

export function sanitizeMessageText(value: string | null | undefined): string | null {
  const normalized = sanitizeUiText(value);
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (
    MEDIA_PLACEHOLDER_RE.test(lower) ||
    lower.includes('[photo') ||
    lower.includes('[image') ||
    lower.includes('[video') ||
    lower.includes('photo message') ||
    lower.includes('\u0444\u043e\u0442\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435') ||
    lower.includes('\u0432\u0438\u0434\u0435\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435')
  ) {
    return null;
  }

  return normalized;
}

export function getAttachmentKindLabel(kind: string | null | undefined): string {
  if (kind === 'image') return '\u0424\u043e\u0442\u043e';
  if (kind === 'video') return '\u0412\u0438\u0434\u0435\u043e';
  return '\u0424\u0430\u0439\u043b';
}
