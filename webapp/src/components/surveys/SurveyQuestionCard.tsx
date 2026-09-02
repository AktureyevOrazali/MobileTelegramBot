import SelectPill from '../SelectPill';
import { SURVEY_QUESTION_TYPES, SURVEY_TOPICS } from '../../hooks/useSurveyData';
import type {
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyQuestionType,
} from '../../types';
import { buildQuestionPreview } from './surveyBuilderModel';

const questionTypeLabels: Record<SurveyQuestionType, string> = {
  scale: 'Шкала оценки',
  single_choice: 'Один выбор',
  multi_choice: 'Множественный выбор',
  text_comment: 'Комментарий',
  employee_exclusion: 'Выбор сотрудника',
};

interface SurveyQuestionCardProps {
  question: SurveyQuestion;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  updateQuestion: (index: number, patch: Partial<SurveyQuestion>) => void;
  removeQuestion: (index: number) => void;
  updateOption: (
    questionIndex: number,
    optionIndex: number,
    patch: Partial<SurveyQuestionOption>,
  ) => void;
  addOption: (questionIndex: number) => void;
  removeOption: (questionIndex: number, optionIndex: number) => void;
}

export function SurveyQuestionCard({
  question,
  index,
  expanded,
  onToggle,
  updateQuestion,
  removeQuestion,
  updateOption,
  addOption,
  removeOption,
}: SurveyQuestionCardProps) {
  const preview = buildQuestionPreview(question);
  const isChoice = question.questionType === 'single_choice' || question.questionType === 'multi_choice';

  const setQuestionType = (questionType: SurveyQuestionType) => {
    if (questionType === 'single_choice' || questionType === 'multi_choice') {
      updateQuestion(index, {
        questionType,
        config: question.config.options?.length
          ? question.config
          : { options: [{ id: 'option_1', label: 'Да' }, { id: 'option_2', label: 'Нет' }] },
      });
      return;
    }

    updateQuestion(index, {
      questionType,
      config: questionType === 'scale' ? { min: 1, max: 5, presentation: 'scale' } : {},
    });
  };

  return (
    <article
      id={`survey-builder-question-${index}`}
      className={`surveys-question surveys-question-card${expanded ? ' is-expanded' : ''}`}
    >
      <div className="surveys-question__top surveys-question-card__summary">
        <button
          type="button"
          className="surveys-question-card__lead surveys-question-card__lead--button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Свернуть вопрос ${index + 1}: ${question.text || `Вопрос ${index + 1}`}` : `Открыть вопрос ${index + 1}: ${question.text || `Вопрос ${index + 1}`}`}
        >
          <span className="surveys-question-card__number">{index + 1}</span>
          <div className="surveys-question-card__copy">
            <strong>{question.text || `Вопрос ${index + 1}`}</strong>
            <div className="surveys-question-card__meta">
              <span>{questionTypeLabels[question.questionType]}</span>
              <small>{preview}</small>
            </div>
          </div>
        </button>

        <div className="surveys-actions surveys-question-card__actions">
          <button
            type="button"
            className="surveys-icon-button surveys-icon-button--danger"
            onClick={() => removeQuestion(index)}
            aria-label={`Удалить вопрос ${index + 1}`}
            title={`Удалить вопрос ${index + 1}`}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="surveys-question-card__editor">
          <label className="surveys-field surveys-field--wide">
            <span>Текст вопроса</span>
            <input
              aria-label="Текст вопроса"
              value={question.text}
              onChange={(event) => updateQuestion(index, { text: event.target.value })}
            />
          </label>

          <div className="surveys-form-grid surveys-form-grid--question">
            <div className="surveys-field">
              <span>Тип ответа</span>
              <SelectPill
                label="Тип ответа"
                value={question.questionType}
                showLabelInside={false}
                options={SURVEY_QUESTION_TYPES.map((item) => ({
                  value: item.id,
                  label: item.id === 'scale'
                    ? 'Шкала оценки'
                    : item.id === 'multi_choice'
                      ? 'Множественный выбор'
                      : item.label,
                }))}
                onChange={(value) => setQuestionType(value as SurveyQuestionType)}
              />
            </div>

            <div className="surveys-field">
              <span>Категория аналитики</span>
              <SelectPill
                label="Категория аналитики"
                value={question.topic ?? ''}
                showLabelInside={false}
                options={SURVEY_TOPICS.map((topic) => ({ value: topic.id, label: topic.label }))}
                onChange={(value) => updateQuestion(index, { topic: value || null })}
              />
            </div>
            <label className="surveys-check">
              <input
                type="checkbox"
                checked={question.required}
                onChange={() => updateQuestion(index, { required: !question.required })}
              />
              <span>Обязательный</span>
            </label>
          </div>

          {question.questionType === 'scale' ? (
            <div className="surveys-scale-preview">
              <div className="surveys-score-slider">
                <strong>1</strong>
                <input
                  aria-label="Предпросмотр оценки"
                  type="range"
                  min={1}
                  max={5}
                  defaultValue={3}
                />
                <strong>5</strong>
              </div>
              <div className="surveys-scale-preview__legend">
                <span>Очень плохо</span>
                <span>Отлично</span>
              </div>
            </div>
          ) : null}

          {isChoice ? (
            <div className="surveys-options">
              <div className="surveys-options__head">
                <span>Варианты ответа</span>
                <button
                  type="button"
                  className="surveys-button surveys-button--compact"
                  onClick={() => addOption(index)}
                >
                  Добавить
                </button>
              </div>
              {(question.config.options ?? []).map((option, optionIndex) => (
                <div key={`${option.id}-${optionIndex}`} className="surveys-option-row surveys-choice-row">
                  <input
                    className="surveys-choice-control"
                    type={question.questionType === 'single_choice' ? 'radio' : 'checkbox'}
                    name={`survey-question-${index}`}
                    aria-label={option.label || `Вариант ${optionIndex + 1}`}
                    disabled
                  />
                  <input
                    className="surveys-option-input"
                    aria-label={`Вариант ${optionIndex + 1}`}
                    value={option.label}
                    onChange={(event) => updateOption(index, optionIndex, { label: event.target.value })}
                  />
                  <button
                    type="button"
                    className="surveys-link-button"
                    aria-label={`Удалить вариант ${optionIndex + 1}`}
                    onClick={() => removeOption(index, optionIndex)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {question.questionType === 'text_comment' ? (
            <label className="surveys-field surveys-field--wide surveys-comment-preview">
              <span>Предпросмотр</span>
              <textarea
                aria-label="Комментарий"
                placeholder="Введите ваш ответ..."
              />
            </label>
          ) : null}

          {question.questionType === 'employee_exclusion' ? (
            <label className="surveys-field surveys-field--wide">
              <span>Ответ респондента</span>
              <select aria-label="Выбор сотрудника" disabled>
                <option>Список сотрудников</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
