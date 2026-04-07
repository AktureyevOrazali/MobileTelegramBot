# План реализации модулей оценок, опросов и аналитики MobileBot

Подробный план, адаптированный для последовательного выполнения (Codex-ready). Все таблицы описаны SQL-схемой, все эндпоинты — сигнатурой, все фронт-компоненты — интерфейсами и поведением.

> [!IMPORTANT]
> Терминология: "задача" = "обращение" (appeal) в текущей системе. Все API работают через `appeal_id / dialog_id`.

---

## Предложенные изменения

Реализация разбита на **5 фаз** (каждую можно деплоить независимо):

| Фаза | Описание | Слой |
|------|----------|------|
| 1 | Опрос клиентов (расширенный) | DB → Backend → Telegram Bot → 1C API |
| 2 | Оценка клиента сотрудником | DB → Backend → Webapp (карточка опроса) |
| 3 | Оценка ИИ сотрудником | DB → Backend → Webapp |
| 4 | Сводная аналитика рейтингов | DB → Backend → Webapp (новая страница) |
| 5 | Разграничение доступа к оценкам | Backend → Webapp |

---

## Фаза 1: Модуль опросов клиентов

### 1.1. Новые таблицы БД

#### [NEW] Таблица `surveys`
Хранит шаблоны опросов (редактируются администратором).

```sql
CREATE TABLE IF NOT EXISTS surveys (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,                    -- "Опрос по качеству Q1 2026"
    description TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'after_close',  -- 'after_close' | 'periodic' | 'manual'
    periodic_cron TEXT,                     -- для periodic: '0 0 1 */3 *' (каждый квартал)
    is_anonymous BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by BIGINT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

#### [NEW] Таблица `survey_questions`
Вопросы опроса с типами.

```sql
CREATE TABLE IF NOT EXISTS survey_questions (
    id BIGSERIAL PRIMARY KEY,
    survey_id BIGINT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL,  -- 'scale' | 'single_choice' | 'multi_choice' | 'text' | 'employee_select'
    options JSONB,               -- для choice: ["Вариант 1", "Вариант 2", ...]
    scale_min INTEGER DEFAULT 1,
    scale_max INTEGER DEFAULT 5,
    is_required BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    category TEXT                -- 'quality' | 'speed' | 'usability' | 'seminars' | 'complaints' | 'suggestions'
);
```

#### [NEW] Таблица `survey_responses`
Записи ответов клиентов.

```sql
CREATE TABLE IF NOT EXISTS survey_responses (
    id BIGSERIAL PRIMARY KEY,
    survey_id BIGINT NOT NULL REFERENCES surveys(id),
    chat_id BIGINT,                -- NULL если анонимный
    dialog_id BIGINT,              -- привязка к обращению (если after_close)
    appeal_id BIGINT,
    bin TEXT,
    respondent_name TEXT,          -- NULL если анонимный
    started_at TEXT NOT NULL,
    completed_at TEXT,
    is_complete BOOLEAN DEFAULT FALSE
);
```

#### [NEW] Таблица `survey_answers`
Ответы на каждый вопрос.

```sql
CREATE TABLE IF NOT EXISTS survey_answers (
    id BIGSERIAL PRIMARY KEY,
    response_id BIGINT NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL REFERENCES survey_questions(id),
    answer_scale INTEGER,          -- для type='scale'
    answer_choice JSONB,           -- для single/multi: ["выбранный вариант"]
    answer_text TEXT,              -- для type='text'
    answer_employee_id BIGINT,     -- для type='employee_select'
    created_at TEXT NOT NULL
);
```

### 1.2. Backend — Новые файлы

#### [NEW] `backend/surveys.py`
Все функции работы с БД для опросов:

```python
# --- CRUD для surveys ---
def create_survey(title, description, trigger_type, ...) -> dict
def update_survey(survey_id, ...) -> dict
def delete_survey(survey_id) -> bool
def list_surveys(active_only=False) -> list[dict]
def get_survey(survey_id) -> dict | None

# --- CRUD для survey_questions ---
def add_question(survey_id, question_text, question_type, options, ...) -> dict
def update_question(question_id, ...) -> dict
def delete_question(question_id) -> bool
def list_questions(survey_id) -> list[dict]

# --- Ответы ---
def start_survey_response(survey_id, chat_id, dialog_id, appeal_id, bin, respondent_name) -> dict
def save_answer(response_id, question_id, answer_scale, answer_choice, answer_text, answer_employee_id) -> dict
def complete_survey_response(response_id) -> bool
def get_survey_response(response_id) -> dict | None

# --- Аналитика ---
def get_survey_analytics(survey_id=None, date_from=None, date_to=None, bin=None, section=None) -> dict
```

### 1.3. Backend — Новые API endpoint'ы

Все эндпоинты добавляются в `api.py` (либо выносим в отдельный `api_surveys.py` router):

```
# Администрирование опросов (admin/moderator only)
POST   /api/surveys                           — создать опрос
GET    /api/surveys                           — список опросов
GET    /api/surveys/{survey_id}               — детали опроса с вопросами
PUT    /api/surveys/{survey_id}               — обновить опрос
DELETE /api/surveys/{survey_id}               — удалить опрос

# Вопросы
POST   /api/surveys/{survey_id}/questions     — добавить вопрос
PUT    /api/surveys/questions/{question_id}   — обновить вопрос
DELETE /api/surveys/questions/{question_id}   — удалить вопрос

# Прохождение опроса (клиент через 1С или Telegram)
POST   /api/surveys/{survey_id}/start         — начать прохождение
POST   /api/survey-responses/{response_id}/answers — отправить ответ на вопрос
POST   /api/survey-responses/{response_id}/complete — завершить опрос

# 1С интеграция
GET    /api/integrations/1c/surveys/pending    — получить ожидающие опросы для клиента
POST   /api/integrations/1c/surveys/respond    — отправить ответы из 1С

# Аналитика (admin/moderator)
GET    /api/analytics/surveys                  — сводная аналитика опросов

# Фоновые задачи (APScheduler)
# Будет настроен cron-job `apscheduler` на запуск в начале каждого месяца:
# - Ищет активные опросы с trigger_type='periodic'
# - Находит целевых клиентов, которым нужно отправить опрос
# - Отправляет им опрос через бота/1С
```

### 1.4. Telegram Bot — Опрос в диалоге

> [!IMPORTANT]
> Опрос клиента происходит **в диалоге** (inline callback buttons в Telegram), НЕ на сайте.

**Логика после закрытия обращения:**

В файле [telegram_bot.py](file:///c:/Users/Admin/MobileTelegramBot_clean/backend/telegram_bot.py), после `send_csat_request()`, добавить вызов `send_survey_dialog()`:

```python
def send_survey_dialog(chat_id: int, dialog_id: int, appeal_id: int | None):
    """Отправляет опрос по одному вопросу за раз через inline buttons."""
    # 1. Найти активный опрос с trigger_type='after_close'
    # 2. Создать survey_response
    # 3. Отправить первый вопрос с inline-кнопками:
    #    - scale → кнопки 1-5
    #    - single_choice → кнопки с вариантами
    #    - multi_choice → кнопки-чекбоксы + кнопка "Готово"
    #    - text → сообщение "Напишите ваш комментарий"
    #    - employee_select → кнопки с именами сотрудников
    # 4. Сохранить state: SURVEY_SESSIONS[chat_id] = {response_id, current_question_index}
```

**Callback handlers:**
```python
SURVEY_PREFIX = "survey_"

@bot.callback_query_handler(func=lambda call: call.data.startswith(SURVEY_PREFIX))
def survey_callback_handler(call):
    # Парсит ответ, сохраняет answer, отправляет следующий вопрос
    # Когда вопросы кончились → complete_survey_response()
    # Отправить "Спасибо за участие в опросе! 📋"
```

**Обработка текстовых ответов (для type='text'):**
```python
# В handle_updates(), перед обработкой обычных сообщений:
if chat_id in SURVEY_SESSIONS and SURVEY_SESSIONS[chat_id].get('awaiting_text'):
    save_text_answer_and_send_next_question(chat_id, text)
    return
```

### 1.5. 1С интеграция — Опрос В ЧАТЕ (аналогично Telegram)

> [!IMPORTANT]
> Опрос в 1С проходит **прямо в чате** (как inline-кнопки), по тому же принципу, что и существующая оценка `Rate_1..Rate_5`. НЕ через отдельную форму.

#### Как работает сейчас (оценка, паттерн для повторения):

1. `ЗавершитьОбращение()` → `ЗавершитьОбращениеНаСервере()` → `POST /integrations/1c/close` → возвращает `{rating_required: true}`
2. `ЗапроситьОценкуПослеЗакрытия()` → ставит `ОценкаЗапрошена = Истина`
3. `СформироватьHTMLЧатаНаСервере()` → рисует кнопки `Rate_1..Rate_5` как системное сообщение
4. Клик `Rate_N` → `ChatHTMLПриНажатии` → `НажатаОценка(N)` → `ОтправитьОценкуМobileBot()` → `POST /integrations/1c/rating`
5. `ОценкаЗапрошена = Ложь` → кнопки исчезают

#### Новый flow для опросов:

**Шаг 1.** После закрытия обращения (и после оценки CSAT), бэкенд возвращает `survey_pending`:

```json
// Response от POST /integrations/1c/close
{
  "status": "ok",
  "dialog_id": 123,
  "appeal_id": 456,
  "rating_required": true,
  "rating_target": "operator",
  "survey_pending": {                    // NEW
    "survey_id": 7,
    "title": "Оценка качества Q1 2026",
    "questions": [
      {
        "id": 1,
        "text": "Оцените качество консультации",
        "type": "scale",
        "scale_min": 1,
        "scale_max": 5
      },
      {
        "id": 2,
        "text": "Что вам понравилось больше всего?",
        "type": "single_choice",
        "options": ["Скорость", "Компетентность", "Вежливость", "Результат"]
      },
      {
        "id": 3,
        "text": "Какие аспекты нужно улучшить?",
        "type": "multi_choice",
        "options": ["Скорость ответа", "Полнота ответа", "Доступность", "Документация"]
      },
      {
        "id": 4,
        "text": "Ваш комментарий",
        "type": "text"
      },
      {
        "id": 5,
        "text": "С кем не хотели бы работать?",
        "type": "employee_select",
        "options": ["Иванов А.", "Петрова Б.", "Сидоров В."]
      }
    ]
  }
}
```

**Шаг 2.** 1С сохраняет опрос в state формы и начинает показывать вопросы поочерёдно:

#### [MODIFY] Форма обработки — Новые реквизиты

Добавить в `ПриСозданииНаСервере()` новые реквизиты:

```1c
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросАктивен",       Новый ОписаниеТипов("Булево")));
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросResponseId",    Новый ОписаниеТипов("Строка",,Новый КвалификаторыСтроки(200))));
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросSurveyId",      Новый ОписаниеТипов("Строка",,Новый КвалификаторыСтроки(200))));
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросВопросJSON",     Новый ОписаниеТипов("Строка")));
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросВопросыJSON",    Новый ОписаниеТипов("Строка")));
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросТекущийИндекс", Новый ОписаниеТипов("Число")));
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросМультиВыборJSON",Новый ОписаниеТипов("Строка")));
ДобавляемыеРеквизиты.Добавить(Новый РеквизитФормы("ОпросОжидаетТекст",  Новый ОписаниеТипов("Булево")));
```

#### [MODIFY] `ЗапроситьОценкуПослеЗакрытия()` — Инициализация опроса

```1c
&НаКлиенте
Процедура ЗапроситьОценкуПослеЗакрытия(РезультатЗакрытия)
    // ... существующая логика оценки CSAT ...
    
    // NEW: Проверяем наличие опроса
    ЛокОпрос = ПолучитьПолеJSON(РезультатЗакрытия, "survey_pending", Неопределено);
    Если ЛокОпрос <> Неопределено Тогда
        // Сначала покажем CSAT, потом опрос начнётся после ответа на CSAT
        // Или если CSAT не нужен — сразу начинаем опрос
        Если Не ЭтаФорма["ОценкаЗапрошена"] Тогда
            НачатьОпросВЧате(ЛокОпрос);
        Иначе
            // Сохраняем опрос, запустим после завершения CSAT
            ЭтаФорма["ОпросВопросыJSON"] = ВJSONНаКлиенте(ЛокОпрос);
        КонецЕсли;
    КонецЕсли;
КонецПроцедуры
```

#### [NEW] `НачатьОпросВЧате()` — Запуск опроса

```1c
&НаКлиенте
Процедура НачатьОпросВЧате(ДанныеОпроса)
    ЭтаФорма["ОпросАктивен"] = Истина;
    ЭтаФорма["ОпросSurveyId"] = Строка(ПолучитьПолеJSON(ДанныеОпроса, "survey_id", ""));
    
    Вопросы = ПолучитьПолеJSON(ДанныеОпроса, "questions", Новый Массив);
    ЭтаФорма["ОпросВопросыJSON"] = ВJSONНаКлиенте(Вопросы);
    ЭтаФорма["ОпросТекущийИндекс"] = 0;
    ЭтаФорма["ОпросМультиВыборJSON"] = "[]";
    ЭтаФорма["ОпросОжидаетТекст"] = Ложь;
    
    // Начать прохождение на сервере
    Попытка
        Результат = НачатьОпросНаСервере(ЭтаФорма["ОпросSurveyId"], ExternalChatId, DialogId);
        ЭтаФорма["ОпросResponseId"] = Строка(ПолучитьПолеJSON(Результат, "response_id", ""));
    Исключение
        ЭтаФорма["ОпросАктивен"] = Ложь;
        Возврат;
    КонецПопытки;
    
    // Показать первый вопрос
    ПоказатьСледующийВопросОпроса();
КонецПроцедуры
```

#### [NEW] `ПоказатьСледующийВопросОпроса()` — Переход к вопросу

```1c
&НаКлиенте
Процедура ПоказатьСледующийВопросОпроса()
    Вопросы = ИзJSONНаКлиенте(ЭтаФорма["ОпросВопросыJSON"]);
    Индекс = ЭтаФорма["ОпросТекущийИндекс"];
    
    Если Индекс >= Вопросы.Количество() Тогда
        // Опрос завершён
        ЗавершитьОпрос();
        Возврат;
    КонецЕсли;
    
    ТекВопрос = Вопросы[Индекс];
    ЭтаФорма["ОпросВопросJSON"] = ВJSONНаКлиенте(ТекВопрос);
    ЭтаФорма["ОпросМультиВыборJSON"] = "[]";
    ЭтаФорма["ОпросОжидаетТекст"] = Ложь;
    
    ТипВопроса = НРег(Строка(ПолучитьПолеJSON(ТекВопрос, "type", "")));
    Если ТипВопроса = "text" Или ТипВопроса = "employee_select" Тогда
        ЭтаФорма["ОпросОжидаетТекст"] = Истина;
    КонецЕсли;
    
    ОбновитьHTMLИстории(Истина);
КонецПроцедуры
```

#### [MODIFY] `СформироватьHTMLЧатаНаСервере()` — Отрисовка вопроса опроса

Добавить ПОСЛЕ блока оценки CSAT (`Если ЭтаФорма["ОценкаЗапрошена"]...`):

```1c
    // Опрос как сообщение в чате
    Если ЭтаФорма["ОпросАктивен"] Тогда
        ТекВопрос = РеквизитФормыВЗначение("Объект").FromJSON(ЭтаФорма["ОпросВопросJSON"]);
        ТекстВопроса = ЭкранироватьHTML(ПолучитьПолеJSON(ТекВопрос, "text", "Вопрос"));
        ТипВопроса = НРег(Строка(ПолучитьПолеJSON(ТекВопрос, "type", "")));
        Индекс = ЭтаФорма["ОпросТекущийИндекс"];
        Всего = 0;
        Попытка
            Вопросы = РеквизитФормыВЗначение("Объект").FromJSON(ЭтаФорма["ОпросВопросыJSON"]);
            Всего = Вопросы.Количество();
        Исключение
        КонецПопытки;
        
        КлассОпроса = ?(АнимироватьНовые, "msg msg-new left", "msg left");
        КнопкиHTML = "";
        
        Если ТипВопроса = "scale" Тогда
            МинШкала = ПолучитьПолеJSON(ТекВопрос, "scale_min", 1);
            МаксШкала = ПолучитьПолеJSON(ТекВопрос, "scale_max", 5);
            Для Н = Число(МинШкала) По Число(МаксШкала) Цикл
                КнопкиHTML = КнопкиHTML +
                    "<a href='#' class='qa-rate' data-button-id='Survey_Scale_" + Строка(Н) + "' onclick='return false;'>" + Строка(Н) + "</a>";
            КонецЦикла;
            
        ИначеЕсли ТипВопроса = "single_choice" Тогда
            Варианты = ПолучитьПолеJSON(ТекВопрос, "options", Новый Массив);
            Для Каждого Вариант Из Варианты Цикл
                КнопкиHTML = КнопкиHTML +
                    "<a href='#' class='qa-btn' data-button-id='Survey_Choice_" + ЭкранироватьHTML(Вариант) + "' onclick='return false;'>" + ЭкранироватьHTML(Вариант) + "</a>";
            КонецЦикла;
            
        ИначеЕсли ТипВопроса = "multi_choice" Тогда
            Варианты = ПолучитьПолеJSON(ТекВопрос, "options", Новый Массив);
            // Показываем чекбоксы + кнопку "Готово"
            ВыбранныеJSON = ЭтаФорма["ОпросМультиВыборJSON"];
            Для Каждого Вариант Из Варианты Цикл
                Выбран = СтрНайти(ВыбранныеJSON, '"' + Вариант + '"') > 0;
                Префикс = ?(Выбран, "✓ ", "○ ");
                КнопкиHTML = КнопкиHTML +
                    "<a href='#' class='qa-btn" + ?(Выбран, " qa-btn-selected", "") + "' data-button-id='Survey_Multi_" + ЭкранироватьHTML(Вариант) + "' onclick='return false;'>" + Префикс + ЭкранироватьHTML(Вариант) + "</a>";
            КонецЦикла;
            КнопкиHTML = КнопкиHTML +
                "<a href='#' class='qa-btn qa-btn-done' data-button-id='Survey_MultiDone' onclick='return false;'>Готово ✓</a>";
            
        ИначеЕсли ТипВопроса = "text" Тогда
            КнопкиHTML = "<div class='survey-text-hint'>Напишите ответ в поле ввода и нажмите Отправить</div>" +
                "<a href='#' class='qa-btn' data-button-id='Survey_Skip' onclick='return false;'>Пропустить</a>";
            
        ИначеЕсли ТипВопроса = "employee_select" Тогда
            Варианты = ПолучитьПолеJSON(ТекВопрос, "options", Новый Массив);
            Для Каждого Вариант Из Варианты Цикл
                КнопкиHTML = КнопкиHTML +
                    "<a href='#' class='qa-btn' data-button-id='Survey_Choice_" + ЭкранироватьHTML(Вариант) + "' onclick='return false;'>" + ЭкранироватьHTML(Вариант) + "</a>";
            КонецЦикла;
            КнопкиHTML = КнопкиHTML +
                "<a href='#' class='qa-btn' data-button-id='Survey_Skip' onclick='return false;'>Пропустить</a>";
        КонецЕсли;
        
        СообщенияHTML = СообщенияHTML +
            "<div class='" + КлассОпроса + "'>" +
            "<div class='author'>📋 Опрос</div>" +
            "<div>" + ТекстВопроса + "</div>" +
            "<div class='msg-buttons'>" + КнопкиHTML + "</div>" +
            "<div class='meta'>Вопрос " + Строка(Индекс + 1) + " из " + Строка(Всего) + "</div>" +
            "</div>";
    КонецЕсли;
```

#### [MODIFY] `ChatHTMLПриНажатии()` — Обработка кликов по кнопкам опроса

Добавить новые обработчики `data-button-id` начинающиеся с `Survey_`:

```1c
// В ChatHTMLПриНажатии, в блоке перебора атрибутов:
ИначеЕсли Атрибут.name = "data-button-id" И Найти(Атрибут.value, "Survey_Scale_") = 1 Тогда
    СтандартнаяОбработка = Ложь;
    ОценкаШкалы = Число(Сред(Строка(Атрибут.value), 14));
    ОтветитьНаВопросОпроса("scale", ОценкаШкалы, Неопределено);
    Прервать;

ИначеЕсли Атрибут.name = "data-button-id" И Найти(Атрибут.value, "Survey_Choice_") = 1 Тогда
    СтандартнаяОбработка = Ложь;
    ВыбранныйВариант = Сред(Строка(Атрибут.value), 15);
    ОтветитьНаВопросОпроса("choice", Неопределено, ВыбранныйВариант);
    Прервать;

ИначеЕсли Атрибут.name = "data-button-id" И Найти(Атрибут.value, "Survey_Multi_") = 1 Тогда
    СтандартнаяОбработка = Ложь;
    ВариантМульти = Сред(Строка(Атрибут.value), 14);
    ПереключитьМультиВыбор(ВариантМульти);
    Прервать;

ИначеЕсли Атрибут.name = "data-button-id" И Атрибут.value = "Survey_MultiDone" Тогда
    СтандартнаяОбработка = Ложь;
    ОтветитьМультиВыбором();
    Прервать;

ИначеЕсли Атрибут.name = "data-button-id" И Атрибут.value = "Survey_Skip" Тогда
    СтандартнаяОбработка = Ложь;
    ПропуститьВопросОпроса();
    Прервать;
```

#### [MODIFY] `ВыполнитьОтправкуИзHTML()` — Перехват текстового ввода

Если опрос ожидает текстовый ответ, перехватываем `Отправить`:

```1c
&НаКлиенте
Процедура ВыполнитьОтправкуИзHTML()
    // ... существующее чтение текста из HTML ...
    
    // NEW: Перехват для опроса (тип 'text')
    Если ЭтаФорма["ОпросАктивен"] И ЭтаФорма["ОпросОжидаетТекст"] Тогда
        Если Не ПустаяСтрока(Текст) Тогда
            ОтветитьНаВопросОпроса("text", Неопределено, Текст);
            // Очищаем поле ввода
            Попытка ДокументHTML.forms["dataInput"].textInput.value = ""; Исключение КонецПопытки;
        КонецЕсли;
        Возврат; // НЕ отправляем как обычное сообщение
    КонецЕсли;
    
    // ... существующая логика отправки ...
КонецПроцедуры
```

#### [NEW] Функции обработки ответов на опрос

```1c
&НаКлиенте
Процедура ОтветитьНаВопросОпроса(ТипОтвета, Оценка, ТекстОтвета)
    ТекВопрос = ИзJSONНаКлиенте(ЭтаФорма["ОпросВопросJSON"]);
    QuestionId = ПолучитьПолеJSON(ТекВопрос, "id", 0);
    
    Попытка
        ОтправитьОтветОпросаНаСервере(
            ЭтаФорма["ОпросResponseId"], 
            QuestionId,
            ТипОтвета, Оценка, ТекстОтвета
        );
    Исключение
        Сообщить("Ошибка отправки ответа: " + ОписаниеОшибки());
    КонецПопытки;
    
    // Переход к следующему вопросу
    ЭтаФорма["ОпросТекущийИндекс"] = ЭтаФорма["ОпросТекущийИндекс"] + 1;
    ПоказатьСледующийВопросОпроса();
КонецПроцедуры

&НаКлиенте
Процедура ПереключитьМультиВыбор(Вариант)
    Выбранные = ИзJSONНаКлиенте(ЭтаФорма["ОпросМультиВыборJSON"]);
    Если ТипЗнч(Выбранные) <> Тип("Массив") Тогда
        Выбранные = Новый Массив;
    КонецЕсли;
    
    НайденИндекс = -1;
    Для Н = 0 По Выбранные.Количество() - 1 Цикл
        Если Строка(Выбранные[Н]) = Вариант Тогда НайденИндекс = Н; Прервать; КонецЕсли;
    КонецЦикла;
    
    Если НайденИндекс >= 0 Тогда
        Выбранные.Удалить(НайденИндекс);
    Иначе
        Выбранные.Добавить(Вариант);
    КонецЕсли;
    
    ЭтаФорма["ОпросМультиВыборJSON"] = ВJSONНаКлиенте(Выбранные);
    ОбновитьHTMLИстории(); // перерисовать чекбоксы
КонецПроцедуры

&НаКлиенте
Процедура ОтветитьМультиВыбором()
    Выбранные = ИзJSONНаКлиенте(ЭтаФорма["ОпросМультиВыборJSON"]);
    ТекВопрос = ИзJSONНаКлиенте(ЭтаФорма["ОпросВопросJSON"]);
    QuestionId = ПолучитьПолеJSON(ТекВопрос, "id", 0);
    
    Попытка
        ОтправитьОтветОпросаНаСервере(
            ЭтаФорма["ОпросResponseId"],
            QuestionId,
            "multi_choice", Неопределено,
            ВJSONНаКлиенте(Выбранные)
        );
    Исключение
        Сообщить("Ошибка: " + ОписаниеОшибки());
    КонецПопытки;
    
    ЭтаФорма["ОпросТекущийИндекс"] = ЭтаФорма["ОпросТекущийИндекс"] + 1;
    ПоказатьСледующийВопросОпроса();
КонецПроцедуры

&НаКлиенте
Процедура ПропуститьВопросОпроса()
    ЭтаФорма["ОпросТекущийИндекс"] = ЭтаФорма["ОпросТекущийИндекс"] + 1;
    ПоказатьСледующийВопросОпроса();
КонецПроцедуры

&НаКлиенте
Процедура ЗавершитьОпрос()
    ЭтаФорма["ОпросАктивен"] = Ложь;
    ЭтаФорма["ОпросОжидаетТекст"] = Ложь;
    Сообщить("Спасибо за участие в опросе!");
    ОбновитьHTMLИстории();
КонецПроцедуры
```

#### [MODIFY] `НажатаОценка()` — Запуск опроса после CSAT

После подтверждения CSAT-оценки, если был отложенный опрос:

```1c
&НаКлиенте
Процедура НажатаОценка(Рейтинг, ...)
    // ... существующая логика ...
    ЭтаФорма["ОценкаЗапрошена"] = Ложь;
    
    // NEW: Запустить отложенный опрос
    Если Не ПустаяСтрока(ЭтаФорма["ОпросВопросыJSON"]) И Не ЭтаФорма["ОпросАктивен"] Тогда
        ОтложенныйОпрос = ИзJSONНаКлиенте(ЭтаФорма["ОпросВопросыJSON"]);
        Если ТипЗнч(ОтложенныйОпрос) <> Тип("Массив") Тогда
            НачатьОпросВЧате(ОтложенныйОпрос);
        КонецЕсли;
    КонецЕсли;
    
    ОбновитьHTMLИстории();
КонецПроцедуры
```

#### [NEW] Серверные вызовы (модуль формы)

```1c
&НаСервере
Функция НачатьОпросНаСервере(SurveyId, ExtChatId, ДиалогId)
    Возврат РеквизитФормыВЗначение("Объект").НачатьОпросMobileBot(SurveyId, ExtChatId, ДиалогId);
КонецФункции

&НаСервере
Процедура ОтправитьОтветОпросаНаСервере(ResponseId, QuestionId, ТипОтвета, Оценка, ТекстОтвета)
    РеквизитФормыВЗначение("Объект").ОтправитьОтветОпросаMobileBot(ResponseId, QuestionId, ТипОтвета, Оценка, ТекстОтвета);
КонецПроцедуры
```

#### [NEW] Модуль объекта — API-функции

```1c
Функция НачатьОпросMobileBot(SurveyId, ExternalChatId, DialogId) Экспорт
    Заголовки = Новый Соответствие;
    ВставитьЗаголовок(Заголовки, "Content-Type", "application/json");
    ВставитьЗаголовок(Заголовки, "X-Integration-Token", ТокенИнтеграцииMobileBot());
    
    Д = Новый Структура;
    Д.Вставить("survey_id", SurveyId);
    Д.Вставить("external_chat_id", ExternalChatId);
    Если ЗначениеЗаполнено(DialogId) Тогда Д.Вставить("dialog_id", DialogId); КонецЕсли;
    
    Ответ = ВыполнитьPOST("/integrations/1c/surveys/start", Заголовки, ToJSON(Д));
    Если Ответ.КодСостояния <> 200 Тогда
        ВызватьИсключение "Ошибка HTTP " + Ответ.КодСостояния;
    КонецЕсли;
    Возврат FromJSON(Ответ.ПолучитьТелоКакСтроку());
КонецФункции

Процедура ОтправитьОтветОпросаMobileBot(ResponseId, QuestionId, ТипОтвета, Оценка, ТекстОтвета) Экспорт
    Заголовки = Новый Соответствие;
    ВставитьЗаголовок(Заголовки, "Content-Type", "application/json");
    ВставитьЗаголовок(Заголовки, "X-Integration-Token", ТокенИнтеграцииMobileBot());
    
    Д = Новый Структура;
    Д.Вставить("response_id", ResponseId);
    Д.Вставить("question_id", QuestionId);
    Если ТипОтвета = "scale" И Оценка <> Неопределено Тогда
        Д.Вставить("answer_scale", Оценка);
    ИначеЕсли ТипОтвета = "multi_choice" Тогда
        Д.Вставить("answer_choice", FromJSON(ТекстОтвета));
    ИначеЕсли ТипОтвета = "choice" Тогда
        Выбор = Новый Массив;
        Выбор.Добавить(ТекстОтвета);
        Д.Вставить("answer_choice", Выбор);
    ИначеЕсли ТипОтвета = "text" Тогда
        Д.Вставить("answer_text", ТекстОтвета);
    КонецЕсли;
    
    Ответ = ВыполнитьPOST("/integrations/1c/surveys/answer", Заголовки, ToJSON(Д));
    Если Ответ.КодСостояния <> 200 Тогда
        ВызватьИсключение "Ошибка HTTP " + Ответ.КодСостояния;
    КонецЕсли;
КонецПроцедуры
```

#### Backend — Новые 1С API эндпоинты для опросов

```
GET  /integrations/1c/surveys/pending?external_chat_id=...&dialog_id=...
     → { survey_pending: { survey_id, title, questions: [...] } | null }

POST /integrations/1c/surveys/start
     Body: { survey_id, external_chat_id, dialog_id }
     → { response_id: 42 }

POST /integrations/1c/surveys/answer
     Body: { response_id, question_id, answer_scale?, answer_choice?, answer_text? }
     → { status: "ok", remaining: 3 }
```

#### CSS дополнения для HTML шаблона (ChatTemplate)

```css
/* Стили для опроса в чате */
.survey-text-hint {
  font-size: 12px;
  font-style: italic;
  margin-bottom: 6px;
}
body.theme-dark .survey-text-hint { color: #8696a0; }
body.theme-light .survey-text-hint { color: #667781; }

.qa-btn-selected {
  font-weight: 700;
}
body.theme-dark .qa-btn-selected {
  border-color: #00a884;
  background: #1a3a2f;
  color: #8eecc6;
}
body.theme-light .qa-btn-selected {
  border-color: #008069;
  background: #d9fdd3;
  color: #005c4b;
}

.qa-btn-done {
  margin-left: 8px;
}
body.theme-dark .qa-btn-done {
  border-color: #00a884;
  background: #00a884;
  color: #111b21;
}
body.theme-light .qa-btn-done {
  border-color: #008069;
  background: #008069;
  color: #ffffff;
}
```

---

## Фаза 2: Оценка клиента сотрудником (после закрытия обращения)

### 2.1. Новые таблицы БД

#### [NEW] Таблица `ratings`
**Универсальная таблица оценок** — хранит ВСЕ виды оценок (клиент→сотрудник, сотрудник→клиент, сотрудник→ИИ, клиент→ИИ).

```sql
CREATE TABLE IF NOT EXISTS ratings (
    id BIGSERIAL PRIMARY KEY,
    
    -- Привязка к обращению
    dialog_id BIGINT NOT NULL,
    appeal_id BIGINT,
    
    -- Кто оценил
    rater_type TEXT NOT NULL,           -- 'client' | 'employee' | 'manager' | 'system' | 'ai'
    rater_id BIGINT,                    -- user_id (для employee/manager) или chat_id (для client)
    rater_name TEXT,                    -- ФИО/наименование
    
    -- Кого оценили
    target_type TEXT NOT NULL,          -- 'employee' | 'client' | 'ai' | 'appeal' | 'department'
    target_id BIGINT,                   -- user_id (для employee) или chat_id (для client)
    target_name TEXT,
    
    -- Оценка
    overall_score INTEGER NOT NULL CHECK (overall_score BETWEEN 1 AND 5),
    
    -- Детализация по параметрам (JSONB)
    parameters JSONB DEFAULT '{}',      
    -- Для employee→client: {
    --   "question_quality": 4,      -- корректность постановки вопроса
    --   "data_completeness": 3,     -- полнота данных
    --   "response_speed": 5,        -- скорость обратной связи
    --   "communication": 4,         -- деловая коммуникация
    --   "cooperation": 4,           -- готовность к взаимодействию
    --   "repeated_issues": false     -- повторные обращения
    -- }
    -- Для client→employee: {
    --   "consultation_quality": 5,
    --   "response_speed": 4,
    --   "clarity": 5,
    --   "politeness": 5,
    --   "result": 4
    -- }
    
    -- Дополнительные поля
    comment TEXT,
    low_score_reason TEXT,              -- причина низкой оценки
    
    -- Статус взаимодействия (для employee→client)
    data_provision_status TEXT,         -- 'full' | 'partial' | 'none'
    interaction_status TEXT,            -- 'constructive' | 'needed_clarification' | 'hindered'
    has_repeated_appeal BOOLEAN DEFAULT FALSE,
    has_client_delay BOOLEAN DEFAULT FALSE,
    
    -- ИИ метаданные
    ai_involved BOOLEAN DEFAULT FALSE,
    
    -- Служебные
    channel TEXT DEFAULT 'web',         -- 'web' | 'telegram' | '1c' | 'mobile'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ratings_dialog ON ratings(dialog_id);
CREATE INDEX IF NOT EXISTS idx_ratings_appeal ON ratings(appeal_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rater ON ratings(rater_type, rater_id);
CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_ratings_created ON ratings(created_at);
```

### 2.2. Backend — Новый файл `backend/ratings.py`

```python
# --- Сохранение оценок ---
def save_rating(
    dialog_id, appeal_id, 
    rater_type, rater_id, rater_name,
    target_type, target_id, target_name,
    overall_score, parameters, comment, low_score_reason,
    data_provision_status, interaction_status,
    has_repeated_appeal, has_client_delay, ai_involved, channel
) -> dict

# --- Получение оценок для обращения ---
def get_ratings_for_appeal(appeal_id) -> list[dict]
def get_ratings_for_dialog(dialog_id) -> list[dict]

# --- Проверка наличия оценки ---
def has_rating(dialog_id, rater_type, rater_id, target_type) -> bool

# --- Рейтинг клиентов ---
def calculate_client_rating(chat_id=None, bin=None, date_from=None, date_to=None) -> dict
# Возвращает:
# {
#   "avg_score": 3.8,
#   "high_score_pct": 65,       -- % оценок 4-5
#   "low_score_pct": 10,        -- % оценок 1-2
#   "repeated_appeals_pct": 15, -- % повторных обращений
#   "avg_response_time": 4.2,   -- среднее время ответа клиента (часы)
#   "hindered_count": 2,        -- обращений, затруднённых клиентом
#   "no_clarification_count": 28, -- закрытых без допуточнений
#   "full_data_first_time_pct": 70, -- полный пакет данных с 1 раза
#   "interaction_quality_index": 72.5  -- сводный индекс (формула из ТЗ)
# }

# --- Рейтинг сотрудников ---
def calculate_employee_rating(user_id=None, date_from=None, date_to=None) -> dict

# --- Рейтинг ИИ ---
def calculate_ai_rating(date_from=None, date_to=None, section=None) -> dict
```

### 2.3. Backend — Новые API endpoint'ы

```
# Оценка клиента сотрудником (после закрытия обращения)
POST   /api/ratings                            — отправить оценку
GET    /api/ratings/check                      — проверить, есть ли уже оценка
GET    /api/dialogs/{dialog_id}/ratings        — получить все оценки по обращению

# 1С интеграция
POST   /api/integrations/1c/ratings/client     — 1С отправляет оценку клиента сотрудником

# Рейтинги (admin/moderator)
GET    /api/analytics/ratings/clients          — рейтинг клиентов
GET    /api/analytics/ratings/employees        — рейтинг сотрудников
GET    /api/analytics/ratings/ai               — рейтинг ИИ
GET    /api/analytics/ratings/summary          — сводная аналитика
GET    /api/analytics/ratings/cross            — "кто кому поставил оценку"
```

### 2.4. Webapp — Конструктор опросов и Карточка оценки

> [!IMPORTANT]
> **Управление опросами:** В разделе AdminPage будет создан визуальный интерфейс `SurveyManager.tsx`. Он позволит администратору:
> - Создавать и редактировать шаблоны опросов.
> - Добавлять вопросы, выбирать их тип (шкала, текст, выбор сотрудника и т.д.).
> - Настраивать правила запуска (после закрытия, периодически, вручную).

> [!IMPORTANT]
> **Ключевой UX:** После закрытия диалога в [InlineChatPanel](file:///c:/Users/Admin/MobileTelegramBot_clean/webapp/src/components/InlineChatPanel.tsx) карточка чата **заменяется** на карточку опроса-оценки.

#### [NEW] `webapp/src/components/RatingCard.tsx`
Компонент карточки оценки, который отображается ВМЕСТО InlineChatPanel после закрытия.

**Состояния карточки:**
1. `needs_rating` — показываем форму оценки
2. `submitted` — показываем "Спасибо" + itоговый балл
3. `already_rated` — показываем резюме оценки (readonly)

**UI элементы формы:**

```
┌──────────────────────────────────────────────┐
│ ⭐ Оценка клиента: [ИМЯ] (БИН: 123456789012)│
│ Обращение #42 закрыто 07.04.2026            │
├──────────────────────────────────────────────┤
│                                              │
│ Общая оценка взаимодействия:                │
│ [1] [2] [3] [4] [5]    ← кнопки-звёзды     │
│                                              │
│ Корректность постановки вопроса:            │
│ [1] [2] [3] [4] [5]                         │
│                                              │
│ Полнота предоставленных данных:             │
│ [1] [2] [3] [4] [5]                         │
│                                              │
│ Скорость обратной связи:                    │
│ [1] [2] [3] [4] [5]                         │
│                                              │
│ Соблюдение деловой коммуникации:            │
│ [1] [2] [3] [4] [5]                         │
│                                              │
│ Готовность к взаимодействию:                │
│ [1] [2] [3] [4] [5]                         │
│                                              │
│ ─────────────────────────────────────        │
│                                              │
│ Статус предоставления данных:               │
│ (•) Полный комплект  ( ) Частично  ( ) Нет  │
│                                              │
│ Характер обращения:                         │
│ (•) Конструктивное                          │
│ ( ) Потребовало уточнений                   │
│ ( ) Затруднено из-за клиента                │
│                                              │
│ [✓] Повторное однотипное обращение          │
│ [✓] Просрочка со стороны клиента            │
│                                              │
│ Причина низкой оценки (если ≤2):            │
│ [Выпадающий список причин]                  │
│                                              │
│ Комментарий:                                │
│ ┌──────────────────────────────────┐        │
│ │                                  │        │
│ └──────────────────────────────────┘        │
│                                              │
│       [Отправить оценку]  [Пропустить]      │
└──────────────────────────────────────────────┘
```

**Логика переключения в `DialogsPage.tsx`:**

```typescript
// В DialogsPage, при отображении правой панели:
const justClosed = selectedChat?.dialogClosedAt && !hasRating;
// hasRating проверяется через GET /api/ratings/check?dialog_id=...&rater_type=employee

if (justClosed && !hasRating) {
  return <RatingCard chat={selectedChat} onSubmit={handleRatingSubmit} onSkip={handleRatingSkip} />;
} else {
  return <InlineChatPanel ... />;
}
```

### 2.5. 1С — Карточка оценки

1С забирает информацию о необходимости оценки из существующего `POST /integrations/1c/close` — в ответе уже есть `rating_required: true`. Добавляем новые поля:

```json
{
  "status": "ok",
  "dialog_id": 123,
  "appeal_id": 456,
  "rating_required": true,
  "rating_target": "operator",
  "client_rating_required": true,      // NEW: нужна ли оценка клиента сотрудником
  "client_rating_form": {              // NEW: описание формы
    "parameters": ["question_quality", "data_completeness", "response_speed", "communication", "cooperation"],
    "statuses": ["full", "partial", "none"],
    "interaction_statuses": ["constructive", "needed_clarification", "hindered"]
  }
}
```

---

## Фаза 3: Оценка ИИ сотрудником

### 3.1. Расширение таблицы `ratings`

Таблица `ratings` уже поддерживает `target_type='ai'`. Для ИИ-оценки используются специальные `parameters`:

```json
{
  "was_used": true,
  "was_useful": true,
  "was_correct": false,
  "needed_correction": true,
  "accelerated_solution": true
}
```

### 3.2. Webapp — Блок оценки ИИ

В `RatingCard.tsx` добавляется секция `ai_rating` (показывается только если `ai_involved=true`):

```
┌─────────────────────────────────────────────┐
│ 🤖 Оценка ИИ-помощника                     │
├─────────────────────────────────────────────┤
│ Совет ИИ был использован?    [Да] [Нет]     │
│ Совет ИИ был полезен?        [Да] [Нет]     │
│ Совет ИИ был корректным?     [Да] [Нет]     │
│ Потребовалась корректировка? [Да] [Нет]     │
│ ИИ ускорил решение?          [Да] [Нет]     │
│                                             │
│ Общая оценка ИИ: [1] [2] [3] [4] [5]       │
│ Комментарий к ИИ: [____________]            │
└─────────────────────────────────────────────┘
```

### 3.3. Backend

Используются те же endpoint'ы `POST /api/ratings` с `target_type='ai'`.

---

## Фаза 4: Сводная аналитика рейтингов

### 4.1. Webapp — Новая страница аналитики

#### [NEW] `webapp/src/pages/RatingsAnalyticsPage.tsx`

Добавить в навигацию (sidebar в `App.tsx`) для admin/moderator:
```
🏆 Рейтинги → /ratings
```

**Вкладки страницы:**

1. **Сотрудники** — рейтинг сотрудников
2. **Клиенты** — рейтинг клиентов  
3. **ИИ** — рейтинг ИИ
4. **Взаимные оценки** — "кто кому поставил оценку"

### 4.2. Вкладка «Сотрудники»

**KPI-карточки (верх):**
- Средняя оценка сотрудников
- Количество оцененных обращений
- % высоких оценок (4-5)
- Количество жалоб

**Таблица рейтинга:**

| # | Сотрудник | Средн. оценка | Обращения | Высокие % | Низкие % | Ср. время | Без эскалации % | С использ. ИИ % |
|---|-----------|---------------|-----------|-----------|----------|-----------|-----------------|-----------------|
| 1 | Иванов    | 4.7           | 142       | 85%       | 2%       | 12 мин    | 95%             | 60%             |

**Графики (ECharts):**
- Динамика оценок по месяцам (Line chart)
- ТОП лучших сотрудников (Bar chart)
- Сотрудники с наибольшим кол-вом низких оценок (Bar chart)
- Зависимость оценки от использования ИИ (Grouped bar)

**Фильтры:**
- Период (пресеты + custom range)
- Конкретный сотрудник
- Регион / БИН
- Раздел (section)

### 4.3. Вкладка «Клиенты»

**KPI-карточки:**
- Средний индекс качества взаимодействия
- Кол-во оцененных клиентов
- % клиентов с полным пакетом данных
- % повторных обращений

**Таблица рейтинга:**

| # | Клиент (БИН) | Индекс | Средн. оценка | Обращения | Полн. данные % | Повтор. % | Затруднено |
|---|-------------|--------|---------------|-----------|----------------|-----------|------------|
| 1 | ТОО Ромашка (123456789012) | 85.2 | 4.3 | 28 | 80% | 5% | 0 |

**Формула индекса качества:**
```
IQI = 0.4 × avg_score_normalized +
      0.2 × full_data_pct / 100 +
      0.2 × (1 - repeated_pct / 100) +
      0.2 × response_speed_score
```

**Графики:**
- Клиенты, требующие обучения (список по критериям: индекс < 50, повторные > 30%)
- Распределение клиентов по категориям качества (Pie chart)

### 4.4. Вкладка «ИИ»

**KPI-карточки:**
- Средняя полезность ИИ
- % использования
- % ускорения решений
- % ручной корректировки

**Графики:**
- Полезность по категориям обращений (Radar chart)
- Сравнение сценариев: человек без ИИ / ИИ без человека / человек + ИИ (Grouped bars)
- Динамика ошибок ИИ по месяцам

### 4.5. Вкладка «Взаимные оценки»

**Таблица с полным перечнем оценок:**

| # | Обращение | Кто оценил | Тип | Кому | Тип | Дата | Балл | ИИ | Статус |
|---|-----------|-----------|-----|------|-----|------|------|-----|--------|
| 1 | #42 | Иванов (сотр.) | employee | ТОО Ромашка | client | 07.04 | 4 | ✓ | Закрыто |

**Фильтры:**
- Тип оценщика (client / employee / manager)
- Тип объекта (employee / client / ai)
- Период
- Конкретный сотрудник
- Конкретный клиент (БИН)
- Раздел
- Регион

**Детальная карточка оценки (модальное окно при клике на строку):**
- Номер обращения
- Кто → Кому
- Балл + детализация параметров (визуально — звёзды/прогресс-бары)
- Комментарий
- Участие ИИ
- Статус обращения

### 4.6. Backend — API аналитики

```
GET /api/analytics/ratings/employees
  ?date_from=2026-01-01&date_to=2026-03-31
  &user_id=5
  &section=finance
  &bin=123456789012
  → { employees: [...], kpi: {...}, charts: {...} }

GET /api/analytics/ratings/clients
  ?date_from=...&date_to=...
  &bin=...
  → { clients: [...], kpi: {...}, charts: {...} }

GET /api/analytics/ratings/ai
  ?date_from=...&date_to=...
  &section=...
  → { kpi: {...}, by_category: [...], comparison: {...} }

GET /api/analytics/ratings/cross
  ?rater_type=employee
  &target_type=client
  &date_from=...&date_to=...
  &user_id=...
  &bin=...
  &section=...
  &page=1&per_page=50
  → { items: [...], total: 150, page: 1 }
```

---

## Фаза 5: Разграничение доступа к оценкам

### 5.1. Новые роли/права

Добавить в систему ролей:

```python
ROLE_QUALITY_CONTROLLER = "quality_controller"
ROLE_ANALYST = "analyst"

# Обновить ALL_ROLES:
ALL_ROLES = (ROLE_ADMIN, ROLE_MODERATOR, ROLE_OPERATOR, ROLE_QUALITY_CONTROLLER, ROLE_ANALYST)
```

### 5.2. Middleware авторизации

#### [NEW] `backend/rating_access.py`

```python
def can_view_detailed_ratings(user: dict) -> bool:
    """Полный доступ: admin, moderator, quality_controller, analyst."""
    return user["role"] in ("admin", "moderator", "quality_controller", "analyst")

def can_view_own_aggregated(user: dict) -> bool:
    """Сотрудник видит только свой агрегированный показатель."""
    return True  # все сотрудники

def get_employee_self_rating(user_id: int, period_months: int = 3) -> dict:
    """Возвращает обезличенные агрегированные данные для сотрудника."""
    # Только: средний балл, % высоких оценок, обезличенные рекомендации
    # БЕЗ: имён клиентов, текстов комментариев, авторов отзывов
```

### 5.3. Аудит-лог

#### [NEW] Таблица `rating_audit_log`

```sql
CREATE TABLE IF NOT EXISTS rating_audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    user_role TEXT NOT NULL,
    action TEXT NOT NULL,             -- 'view_list' | 'view_detail' | 'export'
    target_entity TEXT,               -- 'rating' | 'survey_response' | 'analytics'
    target_id BIGINT,
    ip_address TEXT,
    user_agent TEXT,
    device_type TEXT,                 -- 'web' | 'mobile' | '1c'
    created_at TEXT NOT NULL
);
```

### 5.4. Правила доступа

| Роль | Свои агрег. оценки | Детальные оценки | Аналитика | Редакт./Удал. |
|------|---------------------|------------------|-----------|---------------|
| operator | ✅ (обезличенно) | ❌ | ❌ | ❌ |
| moderator | ✅ | ✅ | ✅ | ❌ |
| admin | ✅ | ✅ | ✅ | ✅ |
| quality_controller | ✅ | ✅ | ✅ | ❌ |
| analyst | ✅ | ✅ (readonly) | ✅ | ❌ |

### 5.5. Серверная проверка (НЕ только скрытие кнопок)

Каждый API endpoint проверяет роль на сервере:

```python
@router.get("/analytics/ratings/employees")
def get_employee_ratings(current_user = Depends(get_current_user)):
    if not can_view_detailed_ratings(current_user):
        raise HTTPException(403, "Нет доступа к аналитике оценок")
    ...
```

Для операторов — отдельный endpoint:

```python
@router.get("/profile/rating")
def get_my_rating(current_user = Depends(get_current_user)):
    """Сотрудник видит только свой агрегированный показатель."""
    return get_employee_self_rating(current_user["id"])
```

---

## Миграция существующих CSAT-оценок

> [!WARNING]
> В системе уже есть `csat_rating` и `ai_csat_rating` в `dialog_stats`. Нужно мигрировать.

```python
def migrate_existing_csat_to_ratings():
    """Перенос существующих csat_rating из dialog_stats в таблицу ratings."""
    rows = execute("""
        SELECT ds.dialog_id, ds.appeal_id, ds.csat_rating, ds.ai_csat_rating,
               ds.chat_id, ds.is_ai_closed, ds.created_at,
               resolved_operator.operator_name
        FROM dialog_stats ds
        LEFT JOIN LATERAL (...)  resolved_operator ON TRUE
        WHERE ds.csat_rating IS NOT NULL OR ds.ai_csat_rating IS NOT NULL
    """).fetchall()
    
    for row in rows:
        if row["csat_rating"]:
            save_rating(
                rater_type="client", target_type="employee",
                overall_score=row["csat_rating"], ...
            )
        if row["ai_csat_rating"]:
            save_rating(
                rater_type="client", target_type="ai",
                overall_score=row["ai_csat_rating"], ...
            )
```

---

## Структура новых файлов

```
backend/
├── surveys.py              [NEW] — CRUD + аналитика опросов (DB функции)
├── ratings.py              [NEW] — CRUD + аналитика оценок (DB функции)
├── rating_access.py        [NEW] — проверка прав доступа к оценкам
├── api.py                  [MODIFY] — onec_close_dialog() + подключение роутеров
├── api_surveys.py          [NEW] — APIRouter для опросов + 1С эндпоинты
├── api_ratings.py          [NEW] — APIRouter для оценок и аналитики
├── telegram_bot.py         [MODIFY] — опрос в диалоге, survey callback handlers
├── database.py             [MODIFY] — новые таблицы в _init_db()

1С внешняя обработка:
├── Форма обработки         [MODIFY] — новые реквизиты, обработчики опроса,
│                                       отрисовка в HTML, перехват текста
├── Модуль объекта           [MODIFY] — НачатьОпросMobileBot(),
│                                       ОтправитьОтветОпросаMobileBot()
├── Макет ChatTemplate       [MODIFY] — CSS стили для опроса

webapp/src/
├── components/
│   ├── RatingCard.tsx       [NEW] — карточка оценки клиента (вместо чата после закрытия)
│   ├── AiRatingBlock.tsx    [NEW] — блок оценки ИИ (внутри RatingCard)
│   ├── RatingDetailModal.tsx [NEW] — модальное окно детальной оценки
│   └── SurveyManager.tsx    [NEW] — конструктор опросов (для админки)
├── pages/
│   ├── DialogsPage.tsx      [MODIFY] — переключение чат→оценка после закрытия
│   ├── RatingsAnalyticsPage.tsx [NEW] — страница аналитики рейтингов
│   ├── ProfilePage.tsx      [MODIFY] — блок "Мой рейтинг" для сотрудника
│   └── AdminPage.tsx        [MODIFY] — раздел управления опросами
├── api/
│   └── ApiClient.ts         [MODIFY] — новые методы API
└── types.ts                 [MODIFY] — новые интерфейсы
```

---

## Порядок реализации (для Codex)

```
Шаг 1 (DB):     Добавить таблицы surveys, survey_questions, survey_responses, 
                 survey_answers, ratings, rating_audit_log в database.py → _init_db()

Шаг 2 (DB):     Написать backend/surveys.py — все CRUD функции

Шаг 3 (DB):     Написать backend/ratings.py — все CRUD + расчёт рейтингов

Шаг 4 (API):    Написать backend/api_surveys.py — APIRouter для опросов
                 (включая /integrations/1c/surveys/pending, /start, /answer)

Шаг 5 (API):    Написать backend/api_ratings.py — APIRouter для оценок

Шаг 6 (API):    Подключить роутеры в api.py: app.include_router(...)

Шаг 7 (API):    Расширить onec_close_dialog() — добавить survey_pending в ответ

Шаг 8 (Bot):    Добавить survey flow в telegram_bot.py

Шаг 9 (1C):     Добавить реквизиты ОпросАктивен, ОпросResponseId и т.д.
                 в ПриСозданииНаСервере()

Шаг 10 (1C):    Добавить НачатьОпросВЧате(), ПоказатьСледующийВопросОпроса(),
                 ОтветитьНаВопросОпроса(), ЗавершитьОпрос() в форму

Шаг 11 (1C):    Добавить отрисовку опроса в СформироватьHTMLЧатаНаСервере()

Шаг 12 (1C):    Добавить обработчики Survey_* в ChatHTMLПриНажатии()

Шаг 13 (1C):    Перехват текстового ввода в ВыполнитьОтправкуИзHTML()

Шаг 14 (1C):    Добавить НачатьОпросMobileBot() и ОтправитьОтветОпросаMobileBot()
                 в модуль объекта

Шаг 15 (1C):    Добавить CSS стили (.qa-btn-selected, .qa-btn-done, .survey-text-hint)
                 в ChatTemplate

Шаг 16 (Types): Добавить TypeScript интерфейсы в types.ts

Шаг 17 (API):   Добавить методы в ApiClient.ts

Шаг 18 (UI):    Создать RatingCard.tsx

Шаг 19 (UI):    Модифицировать DialogsPage.tsx — переключение чат/оценка

Шаг 20 (UI):    Создать RatingsAnalyticsPage.tsx — все 4 вкладки

Шаг 21 (UI):    Добавить маршрут /ratings в App.tsx

Шаг 22 (UI):    Добавить SurveyManager в AdminPage

Шаг 23 (ACL):   Реализовать rating_access.py + аудит-лог

Шаг 24 (ACL):   Добавить проверки ролей во все endpoints

Шаг 25 (Migr):  Миграция csat_rating → ratings

Шаг 26 (Prof):  Добавить "Мой рейтинг" в ProfilePage
```

---

## Verification Plan

### Автоматические тесты

```bash
# 1. Запустить backend
cd backend && python -m uvicorn backend.api:app --reload

# 2. Проверить создание таблиц (подключиться к PostgreSQL)
psql -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('surveys','survey_questions','survey_responses','survey_answers','ratings','rating_audit_log')"

# 3. Тест API опросов
curl -X POST /api/surveys -d '{"title":"Тест","trigger_type":"after_close"}' -H "Authorization: Bearer TOKEN"
curl -X GET /api/surveys

# 4. Тест API оценок
curl -X POST /api/ratings -d '{"dialog_id":1,"rater_type":"employee",...}'
curl -X GET /api/analytics/ratings/employees

# 5. Тест доступа (оператор не должен видеть детализацию)
curl -X GET /api/analytics/ratings/employees -H "Authorization: Bearer OPERATOR_TOKEN"
# → 403 Forbidden
```

### Ручная проверка

1. Закрыть обращение на вебе → убедиться, что карточка чата сменилась на карточку оценки
2. Заполнить оценку → убедиться, что карточка вернулась к чату
3. Закрыть обращение в Telegram → пройти опрос inline кнопками
4. **Закрыть обращение в 1С** → оценить CSAT → пройти опрос в чате по кнопкам
5. **В 1С опросе** → проверить все типы вопросов: шкала, выбор, мульти-выбор, текст, пропуск
6. **В 1С опросе** → проверить мульти-выбор: кнопки переключаются (✓/○), "Готово" отправляет
7. **В 1С опросе** → проверить текстовый вопрос: текст из поля ввода перехватывается, не уходит как сообщение
8. Зайти на /ratings → проверить все 4 вкладки
9. Зайти под оператором → убедиться, что /ratings недоступен
10. Проверить /profile → "Мой рейтинг" показывает агрегированные данные

---

**✅ План утвержден. Переходим к реализации (см. task.md)**
