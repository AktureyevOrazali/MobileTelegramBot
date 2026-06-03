import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCanonicalPayload, encodePayloadForSigning, signWithNcalayer } from './ncalayer';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {}
}

describe('ncalayer service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it('builds stable canonical JSON with sorted keys', () => {
    expect(buildCanonicalPayload({ b: 2, a: 1, nested: { d: 4, c: 3 } })).toBe('{"a":1,"b":2,"nested":{"c":3,"d":4}}');
  });

  it('encodes unicode payload as base64', () => {
    expect(encodePayloadForSigning('{"text":"Қазақша"}')).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('sends a basics CMS sign request and returns a normalized signature', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    const promise = signWithNcalayer({ action: 'submit', requestId: 31 });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      module: 'kz.gov.pki.knca.basics',
      method: 'sign',
    });

    socket.onmessage?.({
      data: JSON.stringify({
        status: true,
        body: {
          result: ['MIICMS'],
          certificate: {
            subject: 'CN=Employee User',
            serialNumber: '123456',
            pem: 'CERT',
          },
        },
      }),
    });

    await expect(promise).resolves.toMatchObject({
      signature: 'MIICMS',
      certificateSubject: 'CN=Employee User',
      certificateSerial: '123456',
      certificatePem: 'CERT',
    });
  });
});
