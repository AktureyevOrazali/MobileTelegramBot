import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
  config: { min: 1, max: 10, presentation: 'scale' },
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
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onNew={vi.fn()}
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

describe('SurveyBuilderSection', () => {
  it('keeps launch presets hidden until configure is clicked', () => {
    const { container } = renderBuilderSection();

    expect(container.querySelector('.surveys-builder-sidebar')).toBeInTheDocument();
    expect(container.querySelector('.surveys-editor--builder')).toBeInTheDocument();
    expect(container.querySelector('.surveys-editor__head--builder .surveys-actions')).toBeInTheDocument();
    expect(container.querySelector('.surveys-builder-card .surveys-actions')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.surveys-launch-option')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Настроить запуск' }));

    expect(container.querySelectorAll('.surveys-launch-option')).toHaveLength(4);
    expect(container.querySelector('.surveys-launch-option.is-active')).toBeInTheDocument();
  });

  it('renders the html-reference shell with compact sidebar sections and cards', () => {
    renderBuilderSection();

    expect(screen.getByRole('heading', { name: 'Конструктор' })).toBeInTheDocument();
    expect(screen.getByText('Активный опрос', { selector: '.surveys-builder-sidebar__title' })).toBeInTheDocument();
    expect(screen.getByText('Сохраненные опросы', { selector: '.surveys-builder-sidebar__title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Новый опрос' })).toBeInTheDocument();
    expect(screen.getByText('Название')).toBeInTheDocument();
    expect(screen.getByText('Статус')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Настроить запуск' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить вопрос' })).toBeInTheDocument();
    expect(screen.queryByText(/в шаблоне/i)).not.toBeInTheDocument();
  });

  it('renders the audience slider, active survey card, and saved surveys section', () => {
    const { container } = renderBuilderSection();

    expect(container.querySelector('.surveys-builder-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Конструктор' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Активный опрос')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Клиенты' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сотрудники' })).toBeInTheDocument();
  });

  it('opens the first question in expanded mode and allows collapsing it', () => {
    renderBuilderSection();

    expect(screen.getByDisplayValue('Как прошла консультация?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть вопрос 1' }));
    expect(screen.queryByDisplayValue('Как прошла консультация?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Как прошла консультация/i }));
    expect(screen.getByDisplayValue('Как прошла консультация?')).toBeInTheDocument();
  });

  it('opens inline launch choices and applies a custom date summary', () => {
    renderBuilderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Настроить запуск' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Своя дата' }));
    fireEvent.change(screen.getByLabelText('Дата запуска'), { target: { value: '2026-05-15' } });
    expect(screen.getByText('Своя дата: 15.05.2026')).toBeInTheDocument();
  });

  it('renders scale questions with selectable marks capped at five', () => {
    renderBuilderSection({
      ...draftQuestion,
      config: { min: 1, max: 10, presentation: 'scale' },
    });

    expect(screen.getByRole('button', { name: 'Оценка 5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Оценка 6' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Максимальный балл/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Оценка 4' }));

    expect(screen.getByText('Шкала 1-5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Оценка 5' })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть вопрос 1' }));
    expect(screen.getByText('Один выбор')).toBeInTheDocument();
    expect(screen.getByText('Да, Нет +1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Текст вопроса')).not.toBeInTheDocument();
  });

  it('renders the collapsed question summary as number, title, and compact actions', () => {
    renderBuilderSection({
      ...draftQuestion,
      questionType: 'single_choice',
      config: { options: [{ id: '1', label: 'Да' }, { id: '2', label: 'Нет' }, { id: '3', label: 'Не знаю' }] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть вопрос 1' }));

    const card = screen.getByText('1', { selector: '.surveys-question-card__number' }).closest('.surveys-question-card');

    expect(screen.getByText('1', { selector: '.surveys-question-card__number' })).toBeInTheDocument();
    expect(screen.getByText('Один выбор')).toBeInTheDocument();
    expect(screen.getByText('Да, Нет +1')).toBeInTheDocument();
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });
});
