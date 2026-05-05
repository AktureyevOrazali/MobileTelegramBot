# Dynamic Survey Question Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show analytics cards for every survey-builder question for both client and employee survey audiences.

**Architecture:** Add backend question-level aggregation to the existing survey analytics endpoint, then map and render that contract in the React surveys page. Keep existing fixed analytics fields for compatibility, but drive question cards from the new dynamic `question_analytics` array.

**Tech Stack:** Python backend with PostgreSQL access through `backend/database.py`; React/Vite/TypeScript frontend; unittest and Vitest tests.

---

## File Structure

- Modify `backend/survey_analytics.py`: add pure helpers for per-question aggregation so unit tests can verify the rules without a database.
- Modify `backend/database.py`: pass the requested survey `audience`, collect rows for question aggregation, and return `question_analytics`.
- Modify `backend/api.py`: accept `audience` on `GET /analytics/surveys` and pass it to `database.get_survey_analytics`.
- Modify `webapp/src/types.ts`: add raw and mapped question analytics types.
- Modify `webapp/src/api/ApiClient.ts`: map `question_analytics` and send `audience` in `fetchSurveyAnalytics`.
- Modify `webapp/src/hooks/useSurveyData.ts`: request client survey analytics explicitly.
- Modify `webapp/src/pages/SurveysPage.tsx`: replace fixed client question cards with dynamic cards and make the employees survey tab use survey-builder analytics with `audience=employee`.
- Modify tests in `tests/test_survey_analytics.py`, `webapp/src/pages/SurveysPage.client-analytics.test.tsx`, and `webapp/src/pages/SurveysPage.employee-analytics.test.tsx`.

### Task 1: Backend Question Aggregator

**Files:**
- Modify: `backend/survey_analytics.py`
- Test: `tests/test_survey_analytics.py`

- [ ] **Step 1: Write failing backend tests**

Add tests that call a pure helper named `summarize_question_analytics`:

```python
def test_summarize_question_analytics_covers_all_question_types(self):
    summary = survey_analytics.summarize_question_analytics(
        [
            {
                "question_id": 1,
                "question_text": "Rate service",
                "question_type": "scale",
                "topic": "service",
                "sort_order": 1,
                "numeric_score": 5,
                "raw_text": "",
                "selected_options": [],
                "selected_employee_name": None,
                "option_labels_by_id": {},
            },
            {
                "question_id": 1,
                "question_text": "Rate service",
                "question_type": "scale",
                "topic": "service",
                "sort_order": 1,
                "numeric_score": 3,
                "raw_text": "",
                "selected_options": [],
                "selected_employee_name": None,
                "option_labels_by_id": {},
            },
            {
                "question_id": 2,
                "question_text": "Training",
                "question_type": "multi_choice",
                "topic": "training",
                "sort_order": 2,
                "numeric_score": None,
                "raw_text": "",
                "selected_options": ["webinars", "videos"],
                "selected_employee_name": None,
                "option_labels_by_id": {"webinars": "Webinars", "videos": "Videos"},
            },
            {
                "question_id": 3,
                "question_text": "Comment",
                "question_type": "text_comment",
                "topic": "comment",
                "sort_order": 3,
                "numeric_score": None,
                "raw_text": "Need faster replies",
                "selected_options": [],
                "selected_employee_name": None,
                "option_labels_by_id": {},
            },
            {
                "question_id": 4,
                "question_text": "Employee exclusion",
                "question_type": "employee_exclusion",
                "topic": "employee_exclusion",
                "sort_order": 4,
                "numeric_score": None,
                "raw_text": "Operator One",
                "selected_options": [],
                "selected_employee_name": "Operator One",
                "option_labels_by_id": {},
            },
            {
                "question_id": 9,
                "question_text": "Ninth question",
                "question_type": "single_choice",
                "topic": "extra",
                "sort_order": 9,
                "numeric_score": None,
                "raw_text": "",
                "selected_options": ["yes"],
                "selected_employee_name": None,
                "option_labels_by_id": {"yes": "Yes"},
            },
        ]
    )

    self.assertEqual([item["question_id"] for item in summary], [1, 2, 3, 4, 9])
    self.assertEqual(summary[0]["answer_count"], 2)
    self.assertEqual(summary[0]["average_score"], 4.0)
    self.assertEqual(summary[0]["score_distribution"], [{"label": "5", "count": 1}, {"label": "3", "count": 1}])
    self.assertEqual(summary[1]["top_answers"], [{"label": "Videos", "count": 1}, {"label": "Webinars", "count": 1}])
    self.assertEqual(summary[2]["top_answers"], [{"label": "Need faster replies", "count": 1}])
    self.assertEqual(summary[3]["top_answers"], [{"label": "Operator One", "count": 1}])
    self.assertEqual(summary[4]["top_answers"], [{"label": "Yes", "count": 1}])
```

- [ ] **Step 2: Run backend test and verify failure**

Run: `python -m unittest tests.test_survey_analytics -v`

Expected: failure or error because `summarize_question_analytics` does not exist.

- [ ] **Step 3: Implement `summarize_question_analytics`**

In `backend/survey_analytics.py`, add a helper that groups rows by `question_id`, counts every answer, calculates scale averages, builds score distribution, and builds top answers for choice/text/employee-exclusion questions.

Use this public signature:

```python
def summarize_question_analytics(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    ...
```

Output rows must include:

```python
{
    "question_id": question_id,
    "question_text": question_text,
    "question_type": question_type,
    "topic": topic,
    "sort_order": sort_order,
    "answer_count": answer_count,
    "average_score": average_score_or_none,
    "score_distribution": score_distribution,
    "top_answers": top_answers,
}
```

- [ ] **Step 4: Run backend test and verify pass**

Run: `python -m unittest tests.test_survey_analytics -v`

Expected: all tests pass.

### Task 2: API Contract

**Files:**
- Modify: `backend/database.py`
- Modify: `backend/api.py`

- [ ] **Step 1: Update database analytics function signature**

Change:

```python
def get_survey_analytics(...):
```

to include:

```python
audience: str | None = None,
```

Normalize with `customer_surveys.normalize_survey_audience(audience)` and use it in the SQL params instead of the hardcoded `"client"`.

- [ ] **Step 2: Collect rows for question aggregation**

Inside the existing row loop in `get_survey_analytics`, append a row to `question_rows` after resolving `selected_options` and `by_id`:

```python
question_rows.append({
    "question_id": int(row["question_id"]),
    "question_text": row["question_text"],
    "question_type": row["question_type"],
    "topic": row["topic"],
    "sort_order": int(row.get("question_sort_order") or 0),
    "numeric_score": score,
    "raw_text": row.get("raw_text"),
    "selected_options": selected_options if isinstance(selected_options, list) else [],
    "selected_employee_name": row.get("selected_employee_name"),
    "option_labels_by_id": by_id,
})
```

Add `sq.sort_order AS question_sort_order` to the SELECT and GROUP BY.

- [ ] **Step 3: Return question analytics**

Add this key to the returned dict:

```python
"question_analytics": survey_analytics.summarize_question_analytics(question_rows),
```

- [ ] **Step 4: Add API audience param**

In `backend/api.py`, add `audience: str | None = None` to `get_survey_analytics_endpoint` and pass it to `database.get_survey_analytics(audience=audience, ...)`.

### Task 3: Frontend Types And Mapping

**Files:**
- Modify: `webapp/src/types.ts`
- Modify: `webapp/src/api/ApiClient.ts`

- [ ] **Step 1: Add types**

Add:

```ts
export interface SurveyQuestionAnalyticsRaw {
  question_id: number;
  question_text: string;
  question_type: SurveyQuestionType;
  topic?: string | null;
  sort_order: number;
  answer_count: number;
  average_score?: number | null;
  score_distribution: SurveyAnalyticsTopItemRaw[];
  top_answers: SurveyAnalyticsTopItemRaw[];
}

export interface SurveyQuestionAnalytics {
  questionId: number;
  questionText: string;
  questionType: SurveyQuestionType;
  topic: string | null;
  sortOrder: number;
  answerCount: number;
  averageScore: number | null;
  scoreDistribution: SurveyAnalyticsTopItemRaw[];
  topAnswers: SurveyAnalyticsTopItemRaw[];
}
```

Add `question_analytics: SurveyQuestionAnalyticsRaw[]` to `SurveyAnalyticsRaw` and `questionAnalytics: SurveyQuestionAnalytics[]` to `SurveyAnalytics`.

- [ ] **Step 2: Map API fields**

In `mapSurveyAnalytics`, map `raw.question_analytics ?? []` to camelCase.

- [ ] **Step 3: Send audience**

Add `audience?: SurveyTemplateAudience | null` to `fetchSurveyAnalytics` options and include `audience: options.audience ?? undefined` in the query.

### Task 4: Frontend Rendering

**Files:**
- Modify: `webapp/src/hooks/useSurveyData.ts`
- Modify: `webapp/src/pages/SurveysPage.tsx`

- [ ] **Step 1: Request client analytics explicitly**

In `useSurveyData`, update the analytics load call:

```ts
setAnalytics(await apiClient.fetchSurveyAnalytics({ audience: 'client' }));
```

- [ ] **Step 2: Add employee survey-builder analytics state**

In `SurveysPage.tsx`, replace the `/surveys/employees` data source from `fetchEmployeeClientAssessmentAnalytics()` to `fetchSurveyAnalytics({ audience: 'employee' })`.

Use state:

```ts
const [employeeSurveyAnalytics, setEmployeeSurveyAnalytics] = useState<SurveyAnalytics | null>(null);
```

- [ ] **Step 3: Add dynamic question cards component**

Add a component:

```tsx
const SurveyQuestionAnalyticsGrid: React.FC<{ questions: SurveyQuestionAnalytics[] }> = ({ questions }) => (
  <div className="surveys-assessment-grid surveys-assessment-grid--three">
    {questions.map((question) => (
      <QuestionAnalyticsCard key={question.questionId} question={question} />
    ))}
  </div>
);
```

Add `QuestionAnalyticsCard` that selects `question.scoreDistribution` for scale questions and `question.topAnswers` for all other question types, then uses `ProgressCard`.

- [ ] **Step 4: Use dynamic cards for clients and employees**

Replace the three fixed client `ProgressCard` nodes with:

```tsx
<SurveyQuestionAnalyticsGrid questions={analytics?.questionAnalytics ?? []} />
```

Render the same client-style survey analytics component for employees, passing employee copy and `employeeSurveyAnalytics`.

### Task 5: Frontend Tests

**Files:**
- Modify: `webapp/src/pages/SurveysPage.client-analytics.test.tsx`
- Modify: `webapp/src/pages/SurveysPage.employee-analytics.test.tsx`

- [ ] **Step 1: Update client fixture**

Add `questionAnalytics` to `clientAnalytics` with at least four questions, including a `sortOrder: 9` item named `Ninth question`.

- [ ] **Step 2: Assert dynamic cards**

Assert that the screen shows the old covered questions and `Ninth question`.

- [ ] **Step 3: Update employee test**

Change the employee page mock so `fetchSurveyAnalytics` returns employee survey-builder analytics when called with `audience: 'employee'`.

Assert:

```ts
expect(apiClient.fetchSurveyAnalytics).toHaveBeenCalledWith(expect.objectContaining({ audience: 'employee' }));
expect(screen.getByText('Employee survey question')).toBeInTheDocument();
```

### Task 6: Verification

**Files:**
- No source edits.

- [ ] **Step 1: Run backend tests**

Run: `python -m unittest tests.test_survey_analytics -v`

Expected: pass.

- [ ] **Step 2: Run focused frontend tests**

Run: `npm test -- --run src/pages/SurveysPage.client-analytics.test.tsx src/pages/SurveysPage.employee-analytics.test.tsx`

Expected: pass.

- [ ] **Step 3: Run build**

Run from `webapp`: `npm run build`

Expected: TypeScript and Vite build pass.
