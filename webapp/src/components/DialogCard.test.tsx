import React from 'react';
import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../types';
import DialogCard from './DialogCard';

const makeChat = (): ChatSummary => ({
  chatId: 1,
  dialogId: 10,
  title: 'External User',
  username: null,
  type: 'private',
  updatedAt: new Date('2026-05-05T08:00:00Z'),
  dialogStartedAt: new Date('2026-05-05T07:00:00Z'),
  dialogClosedAt: null,
  section: null,
  sectionTitle: null,
  bin: null,
  isFavorite: false,
  aiEnabled: false,
  unreadCount: 0,
  lastMessageText: 'Здравствуйте',
  lastMessageDirection: 'incoming',
  lastMessageAuthor: 'Клиент',
  lastMessageHasAttachments: false,
  lastMessageAttachmentKind: null,
  employeeAssessmentId: null,
  employeeAssessmentPending: false,
  employeeAssessmentCreatedAt: null,
});

describe('DialogCard', () => {
  it('renders the three-dot menu with readable labels', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DialogCard
        chat={makeChat()}
        index={0}
        isActive={false}
        aiToggleDialogId={null}
        canDeleteDialog
        statusBadge={{ canClick: true, onClick: vi.fn() }}
        onOpenChat={vi.fn()}
        onToggleAi={vi.fn()}
        onToggleFavorite={vi.fn()}
        onDeleteRequest={vi.fn()}
      />,
    );

    const kebab = container.querySelector<HTMLButtonElement>('.dialog-card__kebab');
    expect(kebab).not.toBeNull();

    await user.click(kebab!);

    const menu = container.querySelector<HTMLElement>('.dialog-card__menu');
    expect(menu).not.toBeNull();
    expect(within(menu!).getByRole('button', { name: /Удалить диалог/ })).toBeInTheDocument();
    expect(within(menu!).getByRole('button', { name: /Включить AI/ })).toBeInTheDocument();
    expect(container.textContent).not.toContain('\\u0423');
    expect(container.textContent).not.toContain('\\uD83E');
  });
});
