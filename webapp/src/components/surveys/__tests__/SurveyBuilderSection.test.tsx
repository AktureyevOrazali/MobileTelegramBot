import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SurveyQuestion, SurveyQuestionOption, SurveyTemplate } from '../../../types';
import { SurveyBuilderSection } from '../SurveyBuilderSection';

type SurveyDraft = Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>;

const draftQuestion: SurveyQuestion = {
  sortOrder: 1,
  questionType: 'scale',
  text: 'Как прошла консультация?',
  topic: 'consultation_quality',
  required: true,
  anonymityMode: 'inherit',
  config: { min: 1, max: 5, presentation: 'scale' },
};

const makeTemplate = (
  id: number,
  title: string,
  status: SurveyTemplate['status'],
  question: SurveyQuestion = draftQuestion,
): SurveyTemplate => ({
  id,
  title,
  description: '',
  audience: 'client',
  status,
  triggerType: 'after_appeal_closed',
  periodicInterval: null,
  scheduledAt: null,
  launchRules: [{ type: 'after_appeal_closed', dates: [] }],
  isAnonymous: false,
  createdBy: 1,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-01T00:00:00Z'),
  questions: [question],
});

const makeDraft = (question: SurveyQuestion = draftQuestion): SurveyDraft => ({
  title: 'Активный опрос',
  description: '',
  audience: 'client',
  status: 'active',
  triggerType: 'after_appeal_closed',
  periodicInterval: null,
  scheduledAt: null,
  launchRules: [{ type: 'after_appeal_closed', dates: [] }],
  isAnonymous: false,
  questions: [question],
});

function renderBuilderSection(question: SurveyQuestion = draftQuestion) {
  const Wrapper: React.FC = () => {
    const [draft, setDraft] = React.useState<SurveyDraft>(makeDraft(question));
    const updateQuestion = (questionIndex: number, patch: Partial<SurveyQuestion>) => {
      setDraft((current) => ({
        ...current,
        questions: current.questions.map((item, currentIndex) => (
          currentIndex === questionIndex ? { ...item, ...patch } : item
        )),
      }));
    };
    const updateOption = (
      questionIndex: number,
      optionIndex: number,
      patch: Partial<SurveyQuestionOption>,
    ) => {
      setDraft((current) => ({
        ...current,
        questions: current.questions.map((item, currentIndex) => {
          if (currentIndex !== questionIndex) return item;
          const options = [...(item.config.options ?? [])];
          options[optionIndex] = { ...options[optionIndex], ...patch };
          return { ...item, config: { ...item.config, options } };
        }),
      }));
    };
    const addOption = (questionIndex: number) => {
      setDraft((current) => ({
        ...current,
        questions: current.questions.map((item, currentIndex) => (
          currentIndex === questionIndex
            ? {
              ...item,
              config: {
                ...item.config,
                options: [
                  ...(item.config.options ?? []),
                  { id: `option_${(item.config.options ?? []).length + 1}`, label: 'Новый вариант' },
                ],
              },
            }
            : item
        )),
      }));
    };
    const removeOption = (questionIndex: number, optionIndex: number) => {
      setDraft((current) => ({
        ...current,
        questions: current.questions.map((item, currentIndex) => (
          currentIndex === questionIndex
            ? { ...item, config: { ...item.config, options: (item.config.options ?? []).filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex) } }
            : item
        )),
      }));
    };

    return (
      <SurveyBuilderSection
        audience="client"
        onAudienceChange={vi.fn()}
        templates={[
          makeTemplate(1, 'Активный опрос', 'active', question),
          makeTemplate(2, 'Черновик', 'draft', question),
        ]}
        selectedTemplateId={1}
        onSelectTemplate={vi.fn()}
        draft={draft}
        setDraft={setDraft}
        isLoading={false}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        updateQuestion={updateQuestion}
        addQuestion={vi.fn()}
        removeQuestion={vi.fn()}
        updateOption={updateOption}
        addOption={addOption}
        removeOption={removeOption}
      />
    );
  };

  return render(<Wrapper />);
}

function renderBuilderSectionWithDraft(initialDraft: SurveyDraft) {
  const Wrapper: React.FC = () => {
    const [draft, setDraft] = React.useState<SurveyDraft>(initialDraft);

    return (
      <SurveyBuilderSection
        audience="client"
        onAudienceChange={vi.fn()}
        templates={[makeTemplate(1, 'Активный опрос', 'active')]}
        selectedTemplateId={1}
        onSelectTemplate={vi.fn()}
        draft={draft}
        setDraft={setDraft}
        isLoading={false}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        updateQuestion={vi.fn()}
        addQuestion={vi.fn()}
        removeQuestion={vi.fn()}
        updateOption={vi.fn()}
        addOption={vi.fn()}
        removeOption={vi.fn()}
      />
    );
  };

  return render(<Wrapper />);
}

describe('SurveyBuilderSection', () => {
  it('keeps launch presets hidden until configure is clicked', () => {
    const { container } = renderBuilderSection();

    expect(container.querySelector('.surveys-editor--builder')).toBeInTheDocument();
    expect(container.querySelector('.surveys-editor__head--builder .surveys-actions')).toBeInTheDocument();
    expect(container.querySelector('.surveys-builder-card--launch')).toBeInTheDocument();
    expect(container.querySelector('.surveys-builder-card .surveys-actions')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.surveys-launch-option')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Настроить запуск' }));

    expect(container.querySelectorAll('.surveys-launch-option')).toHaveLength(4);
    expect(container.querySelector('.surveys-launch-option.is-active')).toBeInTheDocument();
  });

  it('renders a compact builder without saved survey cards', () => {
    const { container } = renderBuilderSection();

    expect(screen.getByRole('heading', { name: 'Активный опрос' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Опрос' })).toHaveValue('1');
    expect(within(container.querySelector('.surveys-builder-sidebar') as HTMLElement).queryByText('Опрос')).not.toBeInTheDocument();
    expect(screen.getByText('Активный опрос', { selector: '.surveys-status-dot' })).toBeInTheDocument();
    expect(screen.queryByText('Сохраненные опросы')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Новый' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Копия' })).not.toBeInTheDocument();
    expect(screen.getByText('Название')).toBeInTheDocument();
    expect(screen.getByText('Статус')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Настроить запуск' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить вопрос' })).toBeInTheDocument();
    expect(screen.queryByText(/в шаблоне/i)).not.toBeInTheDocument();
  });

  it('keeps audience and survey selection in the builder toolbar', () => {
    const { container } = renderBuilderSection();

    expect(container.querySelector('.surveys-builder-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Активный опрос' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Название' })).toHaveValue('Активный опрос');
    expect(screen.getByRole('button', { name: 'Клиенты' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сотрудники' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Вопросы активного опроса' })).toHaveTextContent('Как прошла консультация?');
  });

  it('opens the first question in expanded mode and allows collapsing it', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    renderBuilderSection();

    expect(screen.getByDisplayValue('Как прошла консультация?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Свернуть вопрос 1/ }));
    expect(screen.queryByDisplayValue('Как прошла консультация?')).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Вопросы активного опроса' })).getByRole('button'));
    expect(screen.getByDisplayValue('Как прошла консультация?')).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });
  });

  it('opens inline launch choices and applies a custom date summary', () => {
    renderBuilderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Настроить запуск' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Своя дата' }));
    fireEvent.change(screen.getByLabelText('Дата запуска'), { target: { value: '2026-05-15' } });
    expect(screen.getAllByText('Своя дата: 15.05.2026')).toHaveLength(2);
  });

  it('keeps after-appeal launch active when legacy calendar data is still present', () => {
    const { container } = renderBuilderSectionWithDraft({
      ...makeDraft(),
      triggerType: 'after_appeal_closed',
      launchRules: [{ type: 'calendar', schedule: 'month_start', dates: [] }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Настроить запуск' }));

    expect(screen.getByRole('button', { name: 'После обращения' })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: 'Начало месяца' })).not.toHaveClass('is-active');
    expect(container.querySelector('.surveys-launch-option.is-active')).toHaveTextContent('После обращения');
  });

  it('renders one aligned 1-5 scale preview slider', () => {
    renderBuilderSection({
      ...draftQuestion,
      config: { min: 2, max: 4, presentation: 'scale' },
    });

    const slider = screen.getByRole('slider', { name: 'Предпросмотр оценки' });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '5');
    expect(slider).toHaveValue('3');
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    expect(screen.getAllByText('Шкала 1-5')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Оценка \d+/ })).not.toBeInTheDocument();
  });

  it('switches answer types and shows only relevant controls', () => {
    renderBuilderSection();

    fireEvent.click(screen.getByText('Шкала оценки', { selector: '.value' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Один выбор'));
    expect(screen.getByRole('radio', { name: 'Да' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Предпросмотр оценки' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Один выбор', { selector: '.value' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Комментарий'));
    expect(screen.getByLabelText('Комментарий')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Комментарий', { selector: '.value' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Выбор сотрудника'));
    expect(screen.getByRole('combobox', { name: 'Выбор сотрудника' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Список сотрудников' })).toBeInTheDocument();
  });

  it('renders single choice options as radio rows', () => {
    renderBuilderSection({
      ...draftQuestion,
      questionType: 'single_choice',
      config: { options: [{ id: '1', label: 'Да' }, { id: '2', label: 'Нет' }] },
    });

    expect(screen.getByRole('radio', { name: 'Да' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Нет' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Да' })).not.toBeInTheDocument();
  });

  it('renders multiple choice options as checkbox rows', () => {
    renderBuilderSection({
      ...draftQuestion,
      questionType: 'multi_choice',
      config: { options: [{ id: '1', label: 'Инструкции' }, { id: '2', label: 'Памятки' }] },
    });

    expect(screen.getByRole('checkbox', { name: 'Инструкции' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Памятки' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Инструкции' })).not.toBeInTheDocument();
  });

  it('renders comment questions with a textarea preview field', () => {
    renderBuilderSection({
      ...draftQuestion,
      questionType: 'text_comment',
      config: {},
    });

    expect(screen.getByLabelText('Комментарий')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Введите ваш ответ...')).toBeInTheDocument();
  });

  it('shows compact previews when a question card is collapsed', () => {
    renderBuilderSection({
      ...draftQuestion,
      questionType: 'single_choice',
      config: { options: [{ id: '1', label: 'Да' }, { id: '2', label: 'Нет' }, { id: '3', label: 'Не знаю' }] },
    });

    fireEvent.click(screen.getByRole('button', { name: /Свернуть вопрос 1/ }));
    expect(screen.getByText('Один выбор')).toBeInTheDocument();
    expect(screen.getAllByText('Да, Нет +1')).toHaveLength(2);
    expect(screen.queryByLabelText('Текст вопроса')).not.toBeInTheDocument();
  });

  it('renders the collapsed question summary as number, title, and compact actions', () => {
    renderBuilderSection({
      ...draftQuestion,
      questionType: 'single_choice',
      config: { options: [{ id: '1', label: 'Да' }, { id: '2', label: 'Нет' }, { id: '3', label: 'Не знаю' }] },
    });

    fireEvent.click(screen.getByRole('button', { name: /Свернуть вопрос 1/ }));

    const card = screen.getByText('1', { selector: '.surveys-question-card__number' }).closest('.surveys-question-card');

    expect(screen.getByText('1', { selector: '.surveys-question-card__number' })).toBeInTheDocument();
    expect(screen.getByText('Один выбор')).toBeInTheDocument();
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('Да, Нет +1')).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });
});
