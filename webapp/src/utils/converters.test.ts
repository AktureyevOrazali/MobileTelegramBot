import { describe, expect, it } from 'vitest';
import type { ChatSummary, ChatSummaryRaw } from '../types';
import { mapChatSummary } from './converters';

const makeRawChat = (
  override: Partial<ChatSummaryRaw> & { dialog_purge_at?: string | null } = {},
): ChatSummaryRaw & { dialog_purge_at?: string | null } => ({
  chat_id: 1,
  dialog_id: 10,
  title: 'Client',
  username: null,
  type: 'private',
  updated_at: '2026-06-04T12:00:00Z',
  dialog_started_at: '2026-06-04T10:00:00Z',
  dialog_closed_at: null,
  section: null,
  section_title: null,
  bin: null,
  is_favorite: false,
  ...override,
});

describe('mapChatSummary', () => {
  it('maps the purge deadline for closed dialogs', () => {
    const raw = makeRawChat({
      dialog_closed_at: '2026-06-04T12:00:00Z',
      dialog_purge_at: '2026-06-05T12:00:00Z',
    });

    const mapped = mapChatSummary(raw) as ChatSummary & { dialogPurgeAt: Date | null };

    expect(mapped.dialogPurgeAt?.toISOString()).toBe('2026-06-05T12:00:00.000Z');
  });
});
