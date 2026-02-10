# 🔍 Backend Code Audit

**Дата:** 2026-02-10  
**Область:** `backend/` — Python (FastAPI + psycopg2 + pyTelegramBotAPI)  
**Файлы:** `api.py`, `database.py`, `telegram_bot.py`, `ai_manager.py`, `contract_checker.py`, `main.py`, `__init__.py`

---

## 📊 Сводка

| Категория | Критические | Важные | Средние | Незначительные |
|---|---|---|---|---|
| 🔒 Безопасность | 3 | 2 | 1 | — |
| 🗄️ База данных | 1 | 3 | 2 | 1 |
| 📝 Логирование | — | 2 | 1 | — |
| 🏗️ Архитектура | — | 3 | 2 | 1 |
| 🔌 API дизайн | — | 1 | 2 | 2 |
| **Итого** | **4** | **11** | **8** | **4** |

---

## 🔒 Безопасность

### 🔴 CRIT-SEC-01: Хардкод API-токена в `contract_checker.py`

**Файл:** `contract_checker.py:13-14`

```python
GOSZAKUP_API_TOKEN = "79a212468fca40db901c9475cde94e1b"
SUPPLIER_BIN = "980540000496"
```

**Проблема:** API-токен внешнего сервиса (goszakup.gov.kz) и БИН поставщика захардкодены прямо в исходном коде. Это означает:
- Токен попадает в git-историю и доступен всем с доступом к репозиторию
- Невозможно ротировать токен без изменения кода
- БИН поставщика — бизнес-данные, не относятся к коду

**Исправление:**
```python
from . import require_env

GOSZAKUP_API_TOKEN = require_env("GOSZAKUP_API_TOKEN")
SUPPLIER_BIN = require_env("SUPPLIER_BIN")
```

---

### 🔴 CRIT-SEC-02: Хардкод секретов в `.env.example`

**Файл:** `.env.example:1-2`

```
TELEGRAM_BOT_TOKEN=8491779607:AAEa9e2ayqi-1S9o076GGgMXoauAx2xJOV8
MOBILE_API_TOKEN=MySecretTokenSayCheese
```

**Проблема:** `.env.example` содержит **реальные** токены вместо плейсхолдеров. Этот файл обычно коммитится в git и должен содержать только примеры.

**Исправление:**
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
MOBILE_API_TOKEN=your_api_token_here
```

---

### 🔴 CRIT-SEC-03: SHA-256 без соли для паролей

**Файл:** `api.py:415, 435, 489, 496, 598`

```python
password_hash = hashlib.sha256(request.password.encode("utf-8")).hexdigest()
```

**Проблема:** Пароли хешируются простым SHA-256 **без соли**. Это уязвимо к:
- Rainbow table атакам
- Атакам по словарю
- Одинаковые пароли дают одинаковый хеш

**Исправление:** Использовать `bcrypt` или `passlib`:
```python
from passlib.hash import bcrypt

# При регистрации
password_hash = bcrypt.hash(request.password)

# При проверке
if not bcrypt.verify(request.password, user["password_hash"]):
    raise HTTPException(status_code=401, detail="Invalid credentials")
```

> [!CAUTION]
> Миграция требует обновления хешей всех существующих пользователей. Можно реализовать постепенную миграцию: при логине с SHA-256 хешем — автоматически перехешировать bcrypt'ом.

---

### 🟡 HIGH-SEC-04: CORS `allow_origins=["*"]`

**Файл:** `api.py:32-37`

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)
```

**Проблема:** Все домены могут делать запросы к API. Для внутреннего приложения это избыточно.

**Исправление:** Ограничить список разрешённых доменов через env-переменную:
```python
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

### 🟡 HIGH-SEC-05: API-токен не обязателен если не задан

**Файл:** `api.py:344-346`

```python
def require_api_token(x_api_token: str | None = Header(default=None, alias="X-Api-Token")) -> None:
    if API_TOKEN and x_api_token != API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid API token")
```

**Проблема:** Если переменная `MOBILE_API_TOKEN` не задана (пустая строка или None), проверка токена **полностью пропускается**. API становится открытым без аутентификации.

**Исправление:**
```python
def require_api_token(x_api_token: str | None = Header(default=None, alias="X-Api-Token")) -> None:
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="API token is not configured")
    if x_api_token != API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid API token")
```

---

### 🟠 MED-SEC-06: Сессии без TTL

**Файлы:** `database.py:1954-1962`, `database.py:1965-1971`

**Проблема:** Сессии (таблица `sessions`) не имеют TTL / срока действия. Однажды созданная сессия действует **бесконечно**, пока пользователь не сменит пароль.

**Исправление:** Добавить столбец `expires_at` и проверять его при чтении сессии:
```python
def get_user_by_session(token: str) -> Optional[dict]:
    with _lock:
        row = execute(
            f"""SELECT {_user_columns('u')} FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = %s AND s.expires_at > %s""",
            (token, datetime.utcnow().isoformat()),
        ).fetchone()
    return _row_to_user(row)
```

---

## 🗄️ База данных

### 🔴 CRIT-DB-01: `cursor.lastrowid` не работает с psycopg2

**Файл:** `database.py:565, 3105`

```python
inserted_raw = cursor.lastrowid  # Всегда возвращает None в psycopg2!
if inserted_raw is None:
    raise RuntimeError("Failed to persist message")
```

**Проблема:** `cursor.lastrowid` — это атрибут SQLite-драйвера. В psycopg2 он **всегда возвращает None** (или OID, что не то же самое). Это значит:
- `save_message()` **всегда выбрасывает RuntimeError** если не используется `RETURNING`
- `outbox_enqueue_onec()` имеет ту же проблему

**Исправление:** Использовать `RETURNING id`:
```python
cursor = execute(
    """
    INSERT INTO messages (chat_id, direction, text, message_id, author, created_at, section, dialog_id)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    RETURNING id
    """,
    (chat_id, direction, text, message_id, author, now, section, resolved_dialog_id),
)
row = cursor.fetchone()
if row is None:
    raise RuntimeError("Failed to persist message")
inserted_id = int(row["id"])
```

> [!WARNING]
> Если этот код **работает** в продакшене, значит psycopg2 в данной версии возвращает OID через lastrowid, но это ненадёжное поведение. Лучше явно использовать `RETURNING`.

---

### 🟡 HIGH-DB-02: `get_cursor()` не возвращает курсор после реконнекта

**Файл:** `database.py:47-54`

```python
def get_cursor():
    global _connection
    try:
        return _connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    except psycopg2.OperationalError:
        _connection = _connect()
        _connection.autocommit = True
        # ← ОТСУТСТВУЕТ return!
```

**Проблема:** После переподключения к базе функция **не возвращает** новый курсор. `execute()` получает `None` и падает с `AttributeError`.

**Исправление:**
```python
def get_cursor():
    global _connection
    try:
        return _connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    except psycopg2.OperationalError:
        _connection = _connect()
        _connection.autocommit = True
        return _connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
```

---

### 🟡 HIGH-DB-03: Тип-hint `sqlite3.Row` при использовании psycopg2

**Файл:** `database.py:1805`

```python
def _row_to_user(row: sqlite3.Row | None) -> dict | None:
```

**Проблема:** Тип указан как `sqlite3.Row`, хотя модуль `sqlite3` **не импортирован** и БД — PostgreSQL. Это не вызывает ошибку (Python не проверяет type hints в рантайме), но вводит в заблуждение.

**Исправление:**
```python
def _row_to_user(row: Mapping[str, Any] | None) -> dict | None:
```

---

### 🟡 HIGH-DB-04: Единственное соединение + глобальный lock

**Файл:** `database.py:42-44`

```python
_connection = _connect()
_connection.autocommit = True
_lock = threading.Lock()
```

**Проблема:** Вся база работает через **один** psycopg2-коннект с `threading.Lock()`. При нагрузке это создаёт bottleneck — все запросы к БД выполняются последовательно, даже если есть несколько потоков.

**Исправление (рекомендация):** Использовать `psycopg2.pool.ThreadedConnectionPool`:
```python
from psycopg2.pool import ThreadedConnectionPool

_pool = ThreadedConnectionPool(
    minconn=2,
    maxconn=10,
    dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
    host=DB_HOST, port=DB_PORT,
)
```

> [!NOTE]
> Для текущей нагрузки (вероятно, небольшое количество операторов) единственное соединение может быть достаточным. Пул стоит внедрять при масштабировании.

---

### 🟠 MED-DB-05: Даты хранятся как TEXT

**Файл:** `database.py:87-275` (все таблицы)

```sql
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
started_at TEXT,
ended_at TEXT,
```

**Проблема:** Все временные поля хранятся как `TEXT` вместо `TIMESTAMP`. Это:
- Не позволяет использовать СУБД-функции для работы с датами (интервалы, сравнения)
- Зависит от формата ISO-строки, парсится вручную
- Замедляет индексацию по дате

**Исправление (рекомендация):** При миграции заменить на `TIMESTAMP WITH TIME ZONE`. Для текущего проекта — низкий приоритет, требуется миграция данных.

---

### 🟠 MED-DB-06: `boolean` поля как `INTEGER`

**Файл:** `database.py:109, 297`

```sql
operator_mode INTEGER DEFAULT 0
is_approved INTEGER DEFAULT 1
```

**Проблема:** PostgreSQL поддерживает тип `BOOLEAN`, но используется `INTEGER`. Это остаток от SQLite.

---

### 🟢 LOW-DB-07: SQLAlchemy в requirements, но не используется

**Файл:** `requirements.txt:7`

```
SQLAlchemy==2.0.36
```

**Проблема:** SQLAlchemy установлен, но нигде в коде не импортируется. Лишняя зависимость увеличивает размер бандла.

**Исправление:** Удалить из `requirements.txt`.

---

## 📝 Логирование

### 🟡 HIGH-LOG-01: f-строки вместо lazy-форматирования

**Файлы:** `contract_checker.py`, `telegram_bot.py`, `api.py` — ~16 мест

```python
# ❌ Неправильно — строка формируется ВСЕГДА, даже если уровень логирования выше
logger.info(f"Checking contract for 1C customer BIN: {bin_value}")
logger.error(f"Error loading all contracts: {e}")

# ✅ Правильно — строка формируется только при фактическом выводе лога
logger.info("Checking contract for 1C customer BIN: %s", bin_value)
logger.error("Error loading all contracts: %s", e)
```

**Проблема:** f-строки всегда вычисляются, даже если уровень логирования отключает вывод. Это:
- Лишняя нагрузка (форматирование строк)
- Не позволяет системам агрегации логов группировать сообщения

**Затронутые файлы и строки:**
- `api.py`: 1394, 1397, 1407, 1442-1443, 1661-1662
- `contract_checker.py`: 82, 86, 147, 172, 180, 183
- `telegram_bot.py`: 143, 146, 185, 194, 214, 385, 478

---

### 🟡 HIGH-LOG-02: Отсутствие логирования операций в API-хендлерах

**Файл:** `api.py` — большинство хендлеров

**Проблема:** Основные операции (регистрация, логин, смена пароля, удаление пользователя, отправка сообщений и т.д.) **не логируются**. При инцидентах невозможно отследить, кто и когда выполнял действия.

Минимальные точки логирования по правилам:
1. Начало операции
2. Успешное завершение
3. Ошибка

**Пример исправления для `register_user`:**
```python
@router.post("/auth/register", response_model=RegisterResponse)
def register_user(request: RegisterRequest, _: None = Depends(require_api_token)):
    logger.info("Registration attempt: email=%s", request.email)
    existing = database.find_user_by_email(request.email)
    if existing:
        logger.warning("Registration failed: email already exists: %s", request.email)
        raise HTTPException(status_code=409, detail="User already exists")
    # ... (создание пользователя) ...
    logger.info("User registered: id=%s, email=%s", created_user.get("id"), request.email)
    return RegisterResponse()
```

---

### 🟠 MED-LOG-03: `datetime.utcnow()` — deprecated

**Файлы:** `database.py` (~30 мест), `api.py` (3 места)

**Проблема:** `datetime.utcnow()` deprecated в Python 3.12+. Рекомендуется `datetime.now(timezone.utc)`.

**Исправление:**
```python
from datetime import datetime, timezone

now = datetime.now(timezone.utc).isoformat()
```

---

## 🏗️ Архитектура

### 🟡 HIGH-ARCH-01: Монолитный `api.py` (1942 строки)

**Файл:** `api.py`

**Проблема:** Один файл содержит:
- 27+ Pydantic-моделей (запросы и ответы)
- 5 middleware/dependency-функций
- 35+ API-эндпоинтов
- Вспомогательные функции

**Исправление (рекомендация):** Разделить по доменам:
```
backend/
  api/
    __init__.py          # FastAPI app, middlewares
    models.py            # Все Pydantic-модели
    deps.py              # require_api_token, get_current_user и т.д.
    auth.py              # register, login, password
    users.py             # CRUD пользователей, роли
    chats.py             # чаты, сообщения, диалоги
    bins.py              # управление БИНами
    onec.py              # интеграция с 1С
    dashboard.py         # аналитика
```

---

### 🟡 HIGH-ARCH-02: Монолитный `database.py` (3318 строк)

**Файл:** `database.py`

**Проблема:** Аналогично `api.py` — один огромный файл содержит:
- DDL-схему (создание таблиц)
- Миграции (ensure_column)
- Dataclass-модели
- CRUD для ~15 таблиц
- Сложную бизнес-логику (dashboard, unassigned_bins и т.д.)

**Исправление (рекомендация):** Та же структура по доменам с общей конфигурацией подключения.

---

### 🟡 HIGH-ARCH-03: Бизнес-логика внутри API-хендлеров

**Файл:** `api.py:1363-1610` (`create_onec_message` — 248 строк)

**Проблема:** Функция `create_onec_message` — это 248 строк, содержащих:
- Валидацию входных данных
- Проверку контрактов
- Создание/обновление чатов
- Сохранение сообщений
- Логику FAQ + AI-ответов
- Отправку уведомлений
- Работу с outbox

Это нарушает **Single Responsibility Principle** и делает код нетестируемым.

**Исправление:** Выделить бизнес-логику в отдельный сервис-слой.

---

### 🟠 MED-ARCH-04: Код дублируется между Telegram и 1С ветками

**Файл:** `api.py` — `enable_ai_for_dialog`, `disable_ai_for_dialog`, `close_dialog`, `send_message`

**Проблема:** В каждом хендлере есть ветвление `if chat_type == "onec": ... else: ...` с почти одинаковой логикой (сохранение сообщения, отправка уведомления). Это нарушает DRY.

**Исправление:** Абстрагировать отправку сообщений через интерфейс:
```python
def send_notification_to_chat(chat: dict, text: str, *, dialog_id: int, author: str):
    """Отправляет уведомление в чат через правильный канал (Telegram / 1С outbox)."""
    if chat.get("type") == "onec":
        # 1С outbox логика
        ...
    else:
        # Telegram bot.send_message
        ...
```

---

### 🟠 MED-ARCH-05: Глобальное состояние AI сессий в `telegram_bot.py`

**Файл:** `telegram_bot.py:38`

```python
AI_SESSIONS = {}  # {chat_id: {'ai_enabled': True, ...}}
```

**Проблема:** AI-сессии хранятся в in-memory словаре. При перезапуске бэкенда все данные теряются. При нескольких процессах — не синхронизируются.

**Исправление:** Хранить состояние AI в `chat_dialogs.operator_mode` (что уже частично сделано).

---

### 🟢 LOW-ARCH-06: Мёртвые функции в `database.py`

**Файл:** `database.py:419-424`

```python
def _ensure_chat_dialog_records() -> None:
    return

def _ensure_favorites_schema() -> None:
    return
```

**Проблема:** Пустые функции, оставшиеся после рефакторинга. Не вызываются или ничего не делают.

**Исправление:** Удалить.

---

## 🔌 API дизайн

### 🟡 HIGH-API-01: Двойная регистрация роутера

**Файл:** `api.py:1941-1942`

```python
app.include_router(router)
app.include_router(router, prefix="/api")
```

**Проблема:** Каждый эндпоинт доступен по **двум URL**:
- `/auth/login` и `/api/auth/login`
- `/users` и `/api/users`
- и т.д.

Это удваивает attack surface и создаёт путаницу в документации.

**Исправление:** Оставить только один вариант (например, с `/api` префиксом):
```python
app.include_router(router, prefix="/api")
```

---

### 🟠 MED-API-02: Legacy endpoint `/bins/pending`

**Файл:** `api.py:795-800`

```python
@router.get("/bins/pending", response_model=List[UnassignedBinResponse])
def list_pending_bins_endpoint(
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Legacy alias for clients expecting the previous endpoint path."""
    return list_unassigned_bins_endpoint()
```

**Проблема:** Legacy-эндпоинт, дублирующий `/bins/unassigned`. Если фронтенд уже мигрирован — стоит удалить.

**Исправление:** Проверить, использует ли фронтенд `/bins/pending`. Если нет — удалить.

---

### 🟠 MED-API-03: Эндпоинт `/faq` без пагинации

**Файл:** `api.py:811-813`

```python
@router.get("/faq")
def list_faq(_: Dict[str, object] = Depends(get_current_user)):
    return database.list_faq()
```

**Проблема:** Возвращает **все** FAQ-записи без пагинации. При росте данных это может стать проблемой.

---

### 🟢 LOW-API-04: Неконсистентные ответы

**Файл:** `api.py` — разные хендлеры

**Проблема:** Одни эндпоинты возвращают `{"status": "ok"}`, другие — Pydantic-модели. Нет единого формата ошибок.

---

### 🟢 LOW-API-05: `_parse_int_from_string` — неверный type hint

**Файл:** `api.py:962-973`

```python
def _parse_int_from_string(value: str) -> int:
    if value is None:
        return None  # ← Возвращает None, хотя type hint говорит int
```

**Исправление:**
```python
def _parse_int_from_string(value: str | None) -> int | None:
```

---

## 🔄 Прочие проблемы

### MED-MISC-01: `httpx` не в requirements.txt

**Файл:** `contract_checker.py:8`, `requirements.txt`

```python
import httpx  # Используется, но...
```
`httpx` **не указан** в `requirements.txt`. Работает случайно (как транзитивная зависимость).

**Исправление:** Добавить `httpx` в `requirements.txt`.

---

### MED-MISC-02: Дублированный блок в AI-промпте

**Файл:** `ai_manager.py:28-50`

```python
def _create_kazakhstan_prompt(self) -> str:
    return """...
Контекст и актуальность:
- Используй нормы законодательства...
- Если законы менялись недавно...

Контекст и актуальность:        ← ДУБЛИРУЕТСЯ!
- Используй нормы законодательства...
- Если законы менялись недавно...
..."""
```

**Проблема:** Секция «Контекст и актуальность» дублируется дважды в промпте. Это тратит лишние токены при каждом запросе к AI.

---

### LOW-MISC-03: `start_backend.py` — Windows-only

**Файл:** `start_backend.py:33`

```python
ctypes.windll.user32.MessageBoxW(...)
```

**Проблема:** Используется Windows-специфичный API. На Linux/Mac это вызовет ошибку.

---

## 📋 Приоритеты исправлений

### 🔴 Критические (исправить немедленно)

1. **CRIT-SEC-01** — Убрать хардкод API-токена из `contract_checker.py`
2. **CRIT-SEC-02** — Заменить реальные токены в `.env.example` на плейсхолдеры
3. **CRIT-SEC-03** — Мигрировать на bcrypt для паролей
4. **CRIT-DB-01** — Исправить `lastrowid` → `RETURNING id`

### 🟡 Важные (исправить в ближайшем спринте)

5. **HIGH-SEC-04** — Ограничить CORS origins
6. **HIGH-SEC-05** — Сделать API-токен обязательным
7. **HIGH-DB-02** — Исправить `get_cursor()` — добавить return
8. **HIGH-DB-03** — Исправить type hint `sqlite3.Row`
9. **HIGH-LOG-01** — Заменить f-строки на lazy-форматирование в логах
10. **HIGH-LOG-02** — Добавить логирование операций
11. **HIGH-API-01** — Убрать двойную регистрацию роутера
12. **MED-MISC-01** — Добавить `httpx` в requirements.txt

### 🟠 Средние (запланировать)

13. **MED-SEC-06** — Добавить TTL для сессий
14. **MED-DB-05** — Мигрировать даты из TEXT в TIMESTAMP (при возможности)
15. **MED-DB-06** — Заменить INTEGER на BOOLEAN
16. **MED-LOG-03** — Заменить `datetime.utcnow()` на `datetime.now(timezone.utc)`
17. **MED-ARCH-04** — Убрать дублирование Telegram/1С веток
18. **MED-ARCH-05** — Убрать in-memory AI_SESSIONS
19. **MED-API-02** — Удалить legacy `/bins/pending`
20. **MED-MISC-02** — Убрать дубль в AI-промпте

### 🟢 Незначительные (при рефакторинге)

21. **HIGH-ARCH-01/02/03** — Разбить монолитные файлы (крупный рефакторинг)
22. **HIGH-DB-04** — Пул соединений (при масштабировании)
23. **LOW-DB-07** — Удалить неиспользуемый SQLAlchemy
24. **LOW-ARCH-06** — Удалить мёртвые функции
25. **LOW-API-04** — Унифицировать формат ответов
26. **LOW-API-05** — Исправить type hint `_parse_int_from_string`
