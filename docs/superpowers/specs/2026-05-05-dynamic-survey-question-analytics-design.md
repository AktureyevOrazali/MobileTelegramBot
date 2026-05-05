# Dynamic Survey Question Analytics Design

## Goal

Survey analytics must show data for every question configured in the survey builder, for both client and employee survey audiences. The dashboard must not assume that a survey has exactly 8 questions. If a template later has 9 or more questions, analytics cards for the new questions must appear automatically after responses are collected.

## Current Problem

Client survey analytics currently renders only fixed cards for:

- client requests
- training wishes
- employee remarks

Those cards cover only some of the default client survey questions. Other questions from the same survey template do not get a dedicated analytics card. Employee survey-builder analytics also needs the same dynamic behavior, separate from the existing fixed internal employee-client assessment form.

## Recommended Approach

Add a shared question-level analytics contract to the survey analytics API and make the frontend render cards from that contract.

The backend remains the source of truth for aggregation, so analytics are complete even when the raw answer preview is limited. The frontend only formats and displays the returned question analytics.

## Backend Contract

Extend `GET /analytics/surveys` with an optional `audience` query parameter:

- `client` for client survey templates
- `employee` for employee survey templates

Default behavior remains client analytics for backward compatibility.

Add `question_analytics` to the response. Each item contains:

- `question_id`
- `question_text`
- `question_type`
- `topic`
- `sort_order`
- `answer_count`
- `average_score` for scale questions when numeric answers exist
- `score_distribution` for scale questions
- `top_answers` for choice, employee exclusion, and text comment questions

Keep the old fields `top_client_requests`, `top_training_wishes`, and `employee_remarks` for compatibility, but the UI should stop depending on them for the main question cards.

## Aggregation Rules

For `scale` questions:

- count all numeric answers
- compute average score
- group counts by score label

For `single_choice` and `multi_choice` questions:

- resolve option ids through the question config
- count selected option labels

For `employee_exclusion` questions:

- count selected employee names

For `text_comment` questions:

- trim blank text
- count repeated identical comments

Questions with no answers can be omitted from the analytics cards unless the active filtered dataset contains the question with zero answers. Empty analytics cards are not required for unanswered questions.

## Frontend Behavior

Update the survey analytics mapper and types to include `questionAnalytics`.

Client analytics:

- request survey analytics with `audience=client`
- render a responsive grid of question analytics cards
- keep CSAT summary, trend, donut, and answered survey table

Employee survey-builder analytics:

- request survey analytics with `audience=employee`
- render the same dynamic question analytics grid
- this is separate from the fixed internal employee-client assessment dashboard

Each question card should use the existing `ProgressCard` visual language:

- title from the question text
- rows from `topAnswers` or `scoreDistribution`
- for scale questions, show average score and answer count in the card header/body
- show the existing empty state when a question has no aggregate rows

## Testing

Backend tests should cover question aggregation for:

- scale questions
- single-choice or multi-choice questions
- text comments
- employee exclusion answers
- a survey with more than 8 questions

Frontend tests should cover:

- client analytics renders cards from `questionAnalytics`, including a ninth question
- employee survey-builder analytics requests `audience=employee`
- employee survey-builder analytics renders the same dynamic cards

## Out Of Scope

This change does not redesign the survey builder and does not replace the existing internal employee-client assessment analytics. It only makes survey-builder analytics complete and dynamic for both audiences.
