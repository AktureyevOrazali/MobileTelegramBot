import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary } from '../types';
import EmployeeClientAssessmentCard from './EmployeeClientAssessmentCard';

const makeChat = (): ChatSummary => ({
  chatId: 1,
  dialogId: 10,
  title: 'ТОО Пример',
  username: 'client',
  type: 'private',
  updatedAt: new Date('2026-05-04T08:00:00Z'),
  dialogStartedAt: new Date('2026-05-04T07:00:00Z'),
  dialogClosedAt: new Date('2026-05-04T08:30:00Z'),
  dialogPurgeAt: new Date('2026-05-05T08:30:00Z'),
  section: 'support',
  sectionTitle: 'Поддержка',
  bin: '123456789012',
  isFavorite: false,
  aiEnabled: true,
  unreadCount: 0,
  lastMessageText: null,
  lastMessageDirection: null,
  lastMessageAuthor: null,
  lastMessageHasAttachments: false,
  lastMessageAttachmentKind: null,
  employeeAssessmentId: 42,
  employeeAssessmentPending: true,
  employeeAssessmentCreatedAt: new Date('2026-05-04T08:35:00Z'),
});

describe('EmployeeClientAssessmentCard', () => {
  it('uses compact 1-5 buttons for scoring and submits the selected score', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <EmployeeClientAssessmentCard
        chat={makeChat()}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole('combobox', { name: 'Постановка вопроса' })).not.toBeInTheDocument();

    const clarityGroup = screen.getByRole('group', { name: 'Постановка вопроса' });
    const scoreButtons = within(clarityGroup).getAllByRole('button');
    expect(scoreButtons.map((button) => button.textContent)).toEqual(['1', '2', '3', '4', '5']);

    await user.click(within(clarityGroup).getByRole('button', { name: '3' }));

    expect(within(clarityGroup).getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('4.60').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Сохранить оценку' }));

    expect(onSubmit).toHaveBeenCalledWith(42, expect.objectContaining({
      questionClarityScore: 3,
      dataCompletenessScore: 5,
    }));
  });

  it('hides duplicate bottom score and only shows low score reason for low average scores', async () => {
    const user = userEvent.setup();

    render(
      <EmployeeClientAssessmentCard
        chat={makeChat()}
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByText('итоговый балл')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Причина низкой оценки' })).not.toBeInTheDocument();

    for (const label of [
      'Постановка вопроса',
      'Полнота данных',
      'Скорость обратной связи',
      'Деловая коммуникация',
      'Готовность клиента',
    ]) {
      await user.click(within(screen.getByRole('group', { name: label })).getByRole('button', { name: '1' }));
    }

    expect(screen.getByRole('combobox', { name: 'Причина низкой оценки' })).toBeInTheDocument();
  });

  it('grows the comment field to fit typed text', async () => {
    const user = userEvent.setup();

    render(
      <EmployeeClientAssessmentCard
        chat={makeChat()}
        isSubmitting={false}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const comment = screen.getByRole('textbox', { name: 'Комментарий' });
    Object.defineProperty(comment, 'scrollHeight', { configurable: true, value: 128 });

    await user.type(comment, 'Развернутый внутренний комментарий по обращению');

    expect(comment).toHaveStyle({ height: '128px' });
  });
});
