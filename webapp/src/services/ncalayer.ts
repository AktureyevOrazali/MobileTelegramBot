import type { HrSignature } from '../types';

const NCALAYER_URL = 'wss://127.0.0.1:13579/';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function buildCanonicalPayload(value: unknown): string {
  const normalize = (input: unknown): JsonValue => {
    if (input === null || ['string', 'number', 'boolean'].includes(typeof input)) {
      return input as JsonValue;
    }
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (typeof input === 'object') {
      return Object.keys(input as Record<string, unknown>).sort().reduce<Record<string, JsonValue>>((acc, key) => {
        const next = (input as Record<string, unknown>)[key];
        if (typeof next !== 'undefined') {
          acc[key] = normalize(next);
        }
        return acc;
      }, {});
    }
    return String(input);
  };

  return JSON.stringify(normalize(value));
}

export function encodePayloadForSigning(payload: string): string {
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function normalizeNcalayerResponse(raw: unknown, signedPayload: string): HrSignature {
  const response = raw as {
    body?: {
      result?: string | string[];
      certificate?: { subject?: string; serialNumber?: string; pem?: string };
      subjectCn?: string;
      serialNumber?: string;
      pem?: string;
    };
    responseObject?: string | { result?: string | string[] };
    result?: string | string[];
    message?: string;
  };
  const body = response.body ?? response.responseObject ?? response;
  const result = typeof body === 'object' && body !== null && 'result' in body
    ? (Array.isArray(body.result) ? body.result[0] : body.result)
    : body;

  if (!result || typeof result !== 'string') {
    throw new Error(response.message || 'NCALayer не вернул подпись.');
  }

  const bodyObject = (typeof body === 'object' && body !== null ? body : {}) as {
    certificate?: { subject?: string; serialNumber?: string; pem?: string };
    subjectCn?: string;
    serialNumber?: string;
    pem?: string;
  };

  return {
    signature: result,
    signedPayload,
    signedAt: new Date().toISOString(),
    certificateSubject: 'certificate' in bodyObject ? bodyObject.certificate?.subject ?? null : bodyObject.subjectCn ?? null,
    certificateSerial: 'certificate' in bodyObject ? bodyObject.certificate?.serialNumber ?? null : bodyObject.serialNumber ?? null,
    certificatePem: 'certificate' in bodyObject ? bodyObject.certificate?.pem ?? null : bodyObject.pem ?? null,
  };
}

export function signWithNcalayer(payload: unknown): Promise<HrSignature> {
  const signedPayload = buildCanonicalPayload(payload);
  const base64Payload = encodePayloadForSigning(signedPayload);

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(NCALAYER_URL);

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // Ignore close errors after a failed local NCALayer connection.
      }
      reject(new Error(message));
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({
        module: 'kz.gov.pki.knca.basics',
        method: 'sign',
        args: {
          allowedStorages: ['PKCS12'],
          format: 'cms',
          data: base64Payload,
          signingParams: {
            decode: true,
            encapsulate: true,
            digested: false,
            tsaProfile: null,
          },
          signerParams: {
            extKeyUsageOids: [],
            chain: [],
          },
          locale: 'ru',
        },
      }));
    };

    socket.onerror = () => fail('NCALayer недоступен. Запустите NCALayer и повторите подпись.');
    socket.onclose = () => {
      if (!settled) {
        fail('Соединение с NCALayer закрыто до завершения подписи.');
      }
    };
    socket.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        if (raw?.status === false || raw?.code === '500') {
          fail(raw?.message || 'Подписание через NCALayer отменено или завершилось ошибкой.');
          return;
        }
        const signature = normalizeNcalayerResponse(raw, signedPayload);
        settled = true;
        socket.close();
        resolve(signature);
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Не удалось обработать ответ NCALayer.');
      }
    };
  });
}
