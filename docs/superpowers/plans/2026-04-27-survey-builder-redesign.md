# Survey Builder HTML-Reference Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the `Конструктор` tab so its layout, spacing, and question-card rhythm closely match `MobileBot_Companion_Builder.html` while keeping the existing app colors, typography, data flow, and shared controls.

**Architecture:** Keep the current extracted builder component structure and refit it instead of rebuilding from scratch. Drive the redesign from integration tests in `SurveyBuilderSection.test.tsx`, keep summary/preview logic in `surveyBuilderModel.ts`, and isolate most visual change inside `surveys.css` plus the focused survey-builder components.

**Tech Stack:** React 18, TypeScript, Vite, existing `SelectPill` and `Modal` components, `surveys.css`, Vitest, React Testing Library.

---

## File Structure

**Modify**

- `webapp/src/components/surveys/SurveyBuilderSection.tsx` - reshape the editor shell to the HTML-reference composition: lighter heading, compact header card, compact launch card, cleaner questions block.
- `webapp/src/components/surveys/SurveyBuilderSidebar.tsx` - narrow the sidebar information hierarchy to `segmented -> new survey -> active -> saved`.
- `webapp/src/components/surveys/SurveyQuestionCard.tsx` - align collapsed and expanded question cards to the reference rhythm, including the summary row, compact actions, and type-specific editor bodies.
- `webapp/src/components/surveys/SurveyLaunchSettingsModal.tsx` - keep modal behavior but align the preset group and text density to the cleaner builder style.
- `webapp/src/components/surveys/surveyBuilderModel.ts` - keep preview strings short and reference-aligned.
- `webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx` - add failing tests that lock the reference-style structure and compact metadata.
- `webapp/src/components/surveys/__tests__/surveyBuilderModel.test.ts` - tighten preview expectations if needed for the new `type · preview` presentation.
- `webapp/src/styles/surveys.css` - add the HTML-reference spacing, widths, borders, labels, and question-card styling while preserving the project palette.
- `webapp/src/pages/SurveysPage.tsx` - remove the dead inline `BuilderSection` / `QuestionEditor` block left behind from the extraction so the page has one builder implementation.

**Reuse As-Is Unless A Task Says Otherwise**

- `webapp/src/test/setup.ts`
- `webapp/package.json`
- `webapp/vite.config.ts`
- `webapp/src/hooks/useSurveyData.ts`

## Task 1: Lock The HTML-Reference Shell In Tests

**Files:**
- Modify: `webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`
- Test: `webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`

- [ ] **Step 1: Add a failing shell-layout test for the reference-style builder hierarchy**

```tsx
it('renders the html-reference shell with compact sidebar sections and cards', () => {
  renderBuilderSection();

  expect(screen.getByRole('heading', { name: 'Конструктор' })).toBeInTheDocument();
  expect(screen.getByText('Активный опрос', { selector: '.surveys-builder-sidebar__title' })).toBeInTheDocument();
  expect(screen.getByText('Сохраненные опросы', { selector: '.surveys-builder-sidebar__title' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Новый опрос' })).toBeInTheDocument();
  expect(screen.getByText('Название опроса')).toBeInTheDocument();
  expect(screen.getByText('Статус')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Настроить запуск' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Добавить вопрос' })).toBeInTheDocument();
  expect(screen.queryByText(/в шаблоне/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add a failing test that locks the compact summary row of a collapsed question card**

```tsx
it('renders the collapsed question summary as number, title, and compact type-preview row', () => {
  renderBuilderSection({
    ...draftQuestion,
    questionType: 'single_choice',
    config: { options: [{ id: '1', label: 'Да' }, { id: '2', label: 'Нет' }, { id: '3', label: 'Не знаю' }] },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Свернуть вопрос 1' }));

  expect(screen.getByText('Один выбор')).toBeInTheDocument();
  expect(screen.getByText('Да, Нет +1')).toBeInTheDocument();
  expect(screen.queryByText(/обязательный вопрос/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run the integration test to verify the new assertions fail for the expected reasons**

Run: `npm run test -- src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`

Expected: FAIL because the current builder still shows extra service text or the wrong shell hierarchy relative to the new HTML-reference assertions.

- [ ] **Step 4: Commit the test-only red state after the failure is confirmed locally if your workflow requires it; otherwise continue directly to implementation**

```bash
git diff -- webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx
```

Expected: Diff shows only the new failing assertions for shell hierarchy and compact question summary.

## Task 2: Rebuild The Sidebar And Editor Shell To Match The Reference

**Files:**
- Modify: `webapp/src/components/surveys/SurveyBuilderSidebar.tsx`
- Modify: `webapp/src/components/surveys/SurveyBuilderSection.tsx`
- Modify: `webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`

- [ ] **Step 1: Update `SurveyBuilderSidebar.tsx` to use the simplified `segmented -> new -> active -> saved` stack**

```tsx
export const SurveyBuilderSidebar: React.FC<SurveyBuilderSidebarProps> = ({
  audience,
  templates,
  selectedTemplateId,
  onAudienceChange,
  onSelectTemplate,
  onNew,
}) => {
  const { activeTemplate, savedTemplates } = buildBuilderTemplateGroups(templates);

  return (
    <aside className="surveys-panel surveys-template-list surveys-builder-sidebar">
      <div className="surveys-segmented surveys-builder-sidebar__segmented">
        {(['client', 'employee'] as SurveyTemplateAudience[]).map((item) => (
          <button
            key={item}
            type="button"
            className={audience === item ? 'is-active' : ''}
            onClick={() => onAudienceChange(item)}
          >
            {item === 'client' ? 'Клиенты' : 'Сотрудники'}
          </button>
        ))}
      </div>

      <button type="button" className="surveys-button surveys-button--full surveys-button--ghost-dashed" onClick={onNew}>
        Новый опрос
      </button>

      <section className="surveys-builder-sidebar__section">
        <div className="surveys-builder-sidebar__title">Активный опрос</div>
        {activeTemplate ? (
          <button
            type="button"
            className={`surveys-template-card surveys-template-card--active ${selectedTemplateId === activeTemplate.id ? 'is-active' : ''}`}
            onClick={() => onSelectTemplate(activeTemplate.id)}
          >
            <strong>{activeTemplate.title}</strong>
            <span>{buildLaunchSummary(activeTemplate)}</span>
          </button>
        ) : (
          <div className="surveys-empty surveys-empty--compact">Активного опроса нет.</div>
        )}
      </section>

      <section className="surveys-builder-sidebar__section">
        <div className="surveys-builder-sidebar__title">Сохраненные опросы</div>
        <div className="surveys-template-list__items">
          {savedTemplates.length === 0 ? (
            <div className="surveys-empty surveys-empty--compact">Сохраненных опросов нет.</div>
          ) : (
            savedTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`surveys-template-card ${selectedTemplateId === template.id ? 'is-active' : ''}`}
                onClick={() => onSelectTemplate(template.id)}
              >
                <strong>{template.title}</strong>
                <span>{buildLaunchSummary(template)}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </aside>
  );
};
```

- [ ] **Step 2: Update `SurveyBuilderSection.tsx` to the lighter reference-style editor stack**

```tsx
<div className="surveys-panel surveys-editor">
  <div className="surveys-editor__head surveys-editor__head--builder">
    <h2>Конструктор</h2>
  </div>

  <section className="surveys-card surveys-builder-card surveys-builder-card--header">
    <div className="surveys-builder-card__row">
      <label className="surveys-field surveys-builder-field surveys-builder-field--grow">
        <span>Название опроса</span>
        <input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        />
      </label>
      <div className="surveys-field surveys-builder-field surveys-builder-field--status">
        <span>Статус</span>
        <SelectPill
          label="Статус"
          value={draft.status}
          showLabelInside={false}
          options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
          onChange={(value) => setDraft((current) => ({ ...current, status: value as SurveyTemplateStatus }))}
        />
      </div>
    </div>

    <div className="surveys-actions">
      <button type="button" className="surveys-button" onClick={onDuplicate} disabled={!selectedTemplateId || isLoading}>Дублировать</button>
      <button type="button" className="surveys-button" onClick={onDelete} disabled={!selectedTemplateId || isLoading}>Удалить</button>
      <button type="button" className="surveys-button surveys-button--primary" onClick={onSave} disabled={isLoading}>Сохранить</button>
    </div>
  </section>

  <section className="surveys-card surveys-builder-card surveys-builder-card--launch">
    <div>
      <h3>Запуск</h3>
      <p className="surveys-builder-card__meta">{buildLaunchSummary(draft)}</p>
    </div>
    <button type="button" className="surveys-button" onClick={() => setIsLaunchModalOpen(true)}>
      Настроить запуск
    </button>
  </section>

  <div className="surveys-question-head surveys-question-head--builder">
    <h3>Вопросы</h3>
    <button
      type="button"
      className="surveys-button"
      onClick={() => {
        addQuestion();
        setExpandedQuestionIndex(draft.questions.length);
      }}
    >
      Добавить вопрос
    </button>
  </div>

  <div className="surveys-question-list surveys-question-list--builder">
    {draft.questions.map((question, index) => (
      <SurveyQuestionCard
        key={`${question.id ?? 'new'}-${index}`}
        question={question}
        index={index}
        expanded={expandedQuestionIndex === index}
        onToggle={() => setExpandedQuestionIndex((current) => current === index ? null : index)}
        updateQuestion={updateQuestion}
        removeQuestion={removeQuestion}
        updateOption={updateOption}
        addOption={addOption}
        removeOption={removeOption}
      />
    ))}
  </div>
</div>
```

- [ ] **Step 3: Run the integration test to verify the shell assertions turn green**

Run: `npm run test -- src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`

Expected: PASS or partial PASS with the shell test green and any remaining failure now isolated to question-card internals.

- [ ] **Step 4: Commit the shell refit**

```bash
git add webapp/src/components/surveys/SurveyBuilderSidebar.tsx webapp/src/components/surveys/SurveyBuilderSection.tsx webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx
git commit -m "feat: align survey builder shell to html reference"
```

## Task 3: Refine Question Cards To The Reference Pattern

**Files:**
- Modify: `webapp/src/components/surveys/SurveyQuestionCard.tsx`
- Modify: `webapp/src/components/surveys/surveyBuilderModel.ts`
- Modify: `webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`
- Modify: `webapp/src/components/surveys/__tests__/surveyBuilderModel.test.ts`

- [ ] **Step 1: Tighten the question preview strings in `surveyBuilderModel.ts` if they still include extra words**

```ts
export function buildQuestionPreview(question: SurveyQuestion): string {
  if (question.questionType === 'scale') {
    const min = question.config.min ?? 1;
    const max = question.config.max ?? 10;
    return `${min}-${max}`;
  }

  if (question.questionType === 'text_comment') {
    return 'Текстовый ответ';
  }

  const optionLabels = (question.config.options ?? []).map((item) => item.label).filter(Boolean);
  if (optionLabels.length <= 2) {
    return optionLabels.join(', ');
  }
  return `${optionLabels.slice(0, 2).join(', ')} +${optionLabels.length - 2}`;
}
```

- [ ] **Step 2: Update `surveyBuilderModel.test.ts` so the preview contract matches the reference-style compact summary**

```ts
it('builds compact previews for every approved question type', () => {
  expect(buildQuestionPreview(question())).toBe('1-10');
  expect(buildQuestionPreview(question({
    questionType: 'single_choice',
    config: { options: [{ id: '1', label: 'Да' }, { id: '2', label: 'Нет' }, { id: '3', label: 'Не знаю' }] },
  }))).toBe('Да, Нет +1');
  expect(buildQuestionPreview(question({ questionType: 'text_comment', config: {} }))).toBe('Текстовый ответ');
});
```

- [ ] **Step 3: Run the model test to verify the updated preview expectation fails before the UI card changes**

Run: `npm run test -- src/components/surveys/__tests__/surveyBuilderModel.test.ts`

Expected: FAIL if the current scale preview still returns `Шкала 1-10`.

- [ ] **Step 4: Refit `SurveyQuestionCard.tsx` to the HTML-reference summary row and lighter editor body**

```tsx
const questionTypeLabels: Record<SurveyQuestionType, string> = {
  scale: 'Шкала оценки',
  single_choice: 'Один выбор',
  multi_choice: 'Множественный выбор',
  text_comment: 'Комментарий',
  employee_exclusion: 'Сотрудник',
};

const preview = buildQuestionPreview(question);
const typeLine = question.questionType === 'scale'
  ? `${questionTypeLabels[question.questionType]} · ${preview}`
  : `${questionTypeLabels[question.questionType]} · ${preview}`;

return (
  <article className={`surveys-question surveys-question-card${expanded ? ' is-expanded' : ''}`}>
    <div className="surveys-question__top surveys-question-card__summary">
      <div className="surveys-question-card__number">{index + 1}</div>

      <div className="surveys-question-card__copy">
        <strong>{question.text || `Вопрос ${index + 1}`}</strong>
        <small>{typeLine}</small>
      </div>

      <div className="surveys-actions surveys-question-card__actions">
        <button type="button" className="surveys-icon-button" onClick={onToggle} aria-label={expanded ? `Свернуть вопрос ${index + 1}` : `Открыть вопрос ${index + 1}`}>
          <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
        <button type="button" className="surveys-icon-button surveys-icon-button--danger" onClick={() => removeQuestion(index)} aria-label={`Удалить вопрос ${index + 1}`}>
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
              options={[
                { value: 'scale', label: 'Шкала оценки' },
                { value: 'single_choice', label: 'Один выбор' },
                { value: 'multi_choice', label: 'Множественный выбор' },
                { value: 'text_comment', label: 'Комментарий' },
              ]}
              onChange={(value) => setQuestionType(value as SurveyQuestionType)}
            />
          </div>

          <div className="surveys-field">
            <span>Тематика</span>
            <SelectPill
              label="Тематика"
              value={question.topic ?? ''}
              showLabelInside={false}
              options={SURVEY_TOPICS.map((topic) => ({ value: topic.id, label: topic.label }))}
              onChange={(value) => updateQuestion(index, { topic: value || null })}
            />
          </div>
        </div>

        <label className="surveys-check">
          <input
            type="checkbox"
            checked={question.required}
            onChange={() => updateQuestion(index, { required: !question.required })}
          />
          <span>Обязательный вопрос</span>
        </label>

        {question.questionType === 'scale' ? (
          <div className="surveys-scale-strip">
            {buildScaleMarks(question).map((mark) => (
              <span key={mark} className="surveys-scale-strip__chip">{mark}</span>
            ))}
          </div>
        ) : null}

        {isChoice ? (
          <div className="surveys-options">
            <div className="surveys-options__head">
              <span>Варианты ответа</span>
              <button type="button" className="surveys-link-button" onClick={() => addOption(index)}>Добавить вариант</button>
            </div>
            {(question.config.options ?? []).map((option, optionIndex) => (
              <div key={`${option.id}-${optionIndex}`} className="surveys-option-row surveys-option-row--choice">
                <span className={`surveys-choice-marker ${question.questionType === 'multi_choice' ? 'is-multi' : ''}`} />
                <input
                  value={option.label}
                  onChange={(event) => updateOption(index, optionIndex, { label: event.target.value })}
                />
                <button type="button" className="surveys-icon-button" onClick={() => removeOption(index, optionIndex)} aria-label={`Удалить вариант ${optionIndex + 1}`}>
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {question.questionType === 'text_comment' ? (
          <div className="surveys-comment-preview">Введите ваш ответ...</div>
        ) : null}
      </div>
    ) : null}
  </article>
);
```

- [ ] **Step 5: Run the builder tests to verify the updated card pattern passes**

Run: `npm run test -- src/components/surveys/__tests__/surveyBuilderModel.test.ts src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`

Expected: PASS with the compact summary, preview, and editor assertions green.

- [ ] **Step 6: Commit the question-card refit**

```bash
git add webapp/src/components/surveys/SurveyQuestionCard.tsx webapp/src/components/surveys/surveyBuilderModel.ts webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx webapp/src/components/surveys/__tests__/surveyBuilderModel.test.ts
git commit -m "feat: align survey question cards to html reference"
```

## Task 4: Apply The Reference Styling And Remove Dead Builder Code

**Files:**
- Modify: `webapp/src/styles/surveys.css`
- Modify: `webapp/src/pages/SurveysPage.tsx`
- Test: `webapp/src/components/surveys/__tests__/surveyBuilderModel.test.ts`
- Test: `webapp/src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`

- [ ] **Step 1: Remove the dead inline builder implementation from `SurveysPage.tsx`**

```tsx
// Delete the old local BuilderSectionProps, BuilderSection, and QuestionEditor
// definitions that start below the main page component and are no longer rendered.
// Keep only the imported SurveyBuilderSection path used in the main render branch.
```

- [ ] **Step 2: Add the HTML-reference builder styles to `surveys.css`**

```css
.surveys-layout--builder {
  grid-template-columns: minmax(232px, 248px) minmax(0, 1fr);
  gap: 0;
}

.surveys-builder-sidebar {
  gap: 12px;
  padding: 14px 12px;
  border-right: 1px solid #e8eef5;
}

.surveys-builder-sidebar__segmented {
  padding: 3px;
  border-radius: 10px;
  background: #f1f5f9;
  box-shadow: none;
}

.surveys-button--ghost-dashed {
  border-style: dashed;
  border-width: 1.5px;
  background: transparent;
  color: #64748b;
}

.surveys-button--ghost-dashed:hover {
  border-color: #93b4e8;
  background: #eef5ff;
  color: #164b9b;
}

.surveys-editor {
  gap: 12px;
  padding: 0 20px 28px;
}

.surveys-editor__head--builder {
  padding: 14px 0 4px;
}

.surveys-editor__head--builder h2 {
  font-size: 1rem;
}

.surveys-builder-card {
  padding: 14px 16px;
  border-radius: 12px;
}

.surveys-builder-card--header .surveys-actions {
  padding-top: 12px;
  border-top: 1px solid #edf2f7;
}

.surveys-builder-card__row {
  grid-template-columns: minmax(0, 1fr) 190px;
  align-items: end;
}

.surveys-builder-card__meta,
.surveys-template-card span,
.surveys-question-card__copy small,
.surveys-builder-sidebar__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.surveys-question-card {
  padding: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #ffffff;
}

.surveys-question-card__summary {
  padding: 10px 14px;
  gap: 10px;
  align-items: center;
}

.surveys-question-card__number {
  width: 22px;
  height: 22px;
  border: 1px solid #d8e0ea;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 700;
  flex: 0 0 auto;
}

.surveys-question-card.is-expanded .surveys-question-card__number {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

.surveys-question-card__copy {
  gap: 2px;
}

.surveys-question-card__copy strong {
  font-size: 0.84rem;
}

.surveys-question-card__copy small {
  color: #64748b;
  font-size: 0.76rem;
}

.surveys-question-card__editor {
  gap: 10px;
  padding: 12px 14px 14px;
  border-top: 1px solid #edf2f7;
  background: #f8fafc;
}

.surveys-form-grid--question {
  grid-template-columns: 1fr 1fr;
}

.surveys-icon-button {
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
}

.surveys-icon-button:hover {
  border-color: #d8e0ea;
  background: #f8fafc;
  color: #172033;
}

.surveys-icon-button--danger:hover {
  border-color: transparent;
  background: #fff1f2;
  color: #dc2626;
}

.surveys-option-row--choice {
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
}

.surveys-choice-marker {
  width: 16px;
  height: 16px;
  border: 1.5px solid #cbd5e1;
  border-radius: 999px;
  background: #ffffff;
  flex: 0 0 auto;
}

.surveys-choice-marker.is-multi {
  border-radius: 4px;
}

.surveys-comment-preview {
  min-height: 60px;
  padding: 8px 10px;
  border: 1px solid #d8e0ea;
  border-radius: 8px;
  background: #ffffff;
  color: #94a3b8;
  font-size: 0.82rem;
}

@media (max-width: 860px) {
  .surveys-layout--builder {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .surveys-builder-card__row,
  .surveys-form-grid--question {
    grid-template-columns: 1fr;
  }

  .surveys-question-card__summary,
  .surveys-builder-card--launch {
    align-items: stretch;
    flex-direction: column;
  }
}
```

- [ ] **Step 3: Run the focused builder suite after the CSS and page cleanup**

Run: `npm run test -- src/components/surveys/__tests__/surveyBuilderModel.test.ts src/components/surveys/__tests__/SurveyBuilderSection.test.tsx`

Expected: PASS with all builder tests green.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: PASS from `tsc && vite build`.

- [ ] **Step 5: Run the dev server for a manual `/surveys` check**

Run: `npm run dev`

Expected: Vite starts successfully; manual `/surveys` check confirms:

- the sidebar feels narrow and reference-like;
- `Новый опрос` is a lighter service button, not a heavy primary CTA;
- the header and launch cards are compact;
- collapsed question cards read like the HTML reference;
- service text does not wrap on cards;
- mobile width stacks sidebar above the editor cleanly.

- [ ] **Step 6: Commit the visual refit and cleanup**

```bash
git add webapp/src/styles/surveys.css webapp/src/pages/SurveysPage.tsx
git commit -m "style: apply html-reference survey builder design"
```

## Self-Review

**Spec coverage**

- HTML-reference layout and visual rhythm: covered by Tasks 2, 3, and 4.
- Existing app colors, typography, and control patterns preserved: covered by Tasks 2 and 4.
- Narrow sidebar with `Клиенты / Сотрудники`, `Новый опрос`, `Активный`, `Сохраненные`: covered by Task 2.
- Compact `Название + Статус` card and compact `Запуск` card: covered by Task 2.
- Summary-first question cards with light expanded editor: covered by Task 3.
- Scale rendered as a horizontal `1..10` strip: covered by Task 3.
- No service-text wrapping on cards: covered by Task 4 CSS assertions and manual check.

**Placeholder scan**

- No `TODO` / `TBD` markers remain.
- Every code-change step includes explicit code targets.
- Every verification step includes the exact command and expected outcome.

**Type consistency**

- `buildBuilderTemplateGroups`, `buildLaunchSummary`, `buildQuestionPreview`, and `buildScaleMarks` remain the model helper names across all tasks.
- `SurveyBuilderSection`, `SurveyBuilderSidebar`, `SurveyQuestionCard`, and `SurveyLaunchSettingsModal` stay the component boundary names.
- The plan keeps `SelectPill` as the shared dropdown control instead of introducing a second custom dropdown system.
