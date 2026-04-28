const MEDIA_PLACEHOLDER_RE = /^\[?(photo|image|video|document|file|attachment)(?:\s+message)?\]?$/i;
const ONLY_BROKEN_SYMBOLS_RE = /^[\s\uFFFD.,:;!?()[\]{}\-_'"`~]+$/;
const MOJIBAKE_HINT_RE = /(?:Р.|С.|Ð.|Ñ.){2,}/;
const MOJIBAKE_EXTRA_CHARS_RE = /[\u00A0\u0098\u040E\u0453\u2018\u2019\u201A\u2020\u2026\u2030]/;
const UNICODE_ESCAPE_RE = /\\u([0-9a-fA-F]{4})/g;
const SIMPLE_ESCAPE_RE = /\\([nrt])/g;
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

function looksBroken(value: string): boolean {
  return MOJIBAKE_HINT_RE.test(value) || MOJIBAKE_EXTRA_CHARS_RE.test(value) || value.includes('\uFFFD');
}

function repairMojibakeOnce(value: string): string | null {
  if (!looksBroken(value)) {
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

function repairMojibake(value: string): string | null {
  let current = value;
  let changed = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const repaired = repairMojibakeOnce(current);
    if (!repaired || repaired === current) {
      break;
    }
    current = repaired;
    changed = true;
  }

  return changed ? current : null;
}

function decodeEscapedSequences(value: string): string | null {
  if (!value.includes('\\')) {
    return null;
  }

  let decoded = value.replace(UNICODE_ESCAPE_RE, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)));

  decoded = decoded.replace(SIMPLE_ESCAPE_RE, (_, escapeChar: string) => {
    switch (escapeChar) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return `\\${escapeChar}`;
    }
  });

  return decoded === value ? null : decoded;
}

export function sanitizeUiText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const normalized = (decodeEscapedSequences(value) ?? value).replace(/\s+/g, ' ').trim();
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
    lower.includes('фото сообщение') ||
    lower.includes('видео сообщение')
  ) {
    return null;
  }

  return normalized;
}

export function getAttachmentKindLabel(kind: string | null | undefined): string {
  if (kind === 'image') return 'Фото';
  if (kind === 'video') return 'Видео';
  return 'Файл';
}
