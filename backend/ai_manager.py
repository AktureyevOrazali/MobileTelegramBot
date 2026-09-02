"""AI manager powered by Ollama."""
from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

FORBIDDEN_CLOSURE_PHRASES = (
    "request closed",
    "ticket closed",
    "issue resolved",
    "issue closed",
    "conversation closed",
    "dialog closed",
    "appeal closed",
    "request completed",
    "обращение закрыто",
    "обращение завершено",
    "диалог завершен",
    "диалог завершён",
    "вопрос решен",
    "вопрос решён",
)
OPERATOR_FOOTER_PREFIXES = (
    "For details, write",
    "If you want, I can connect an operator.",
    "If needed, I can connect an operator.",
    "Если хотите, могу подключить оператора.",
    "Если нужен оператор",
    "Можете обратиться к оператору.",
)


class OllamaAIManager:
    def __init__(self) -> None:
        self.provider = os.getenv("AI_PROVIDER", "ollama").strip().lower()
        if self.provider != "ollama":
            raise RuntimeError("AI_PROVIDER must be 'ollama'")
        self.model = os.getenv("AI_MODEL", "gemma3:12b")
        self.api_key = os.getenv("AI_API_KEY", "")
        self.base_url = os.getenv("AI_BASE_URL", "http://localhost:11434")
        self.timeout_seconds = float(os.getenv("AI_TIMEOUT_SECONDS", "60"))
        self.reference_year = os.getenv("AI_REFERENCE_YEAR", "2026")
        self.system_prompt = self._create_kazakhstan_prompt()
        logger.info(
            "Ollama AI manager initialized. provider=%s model=%s base_url=%s",
            self.provider,
            self.model,
            self.base_url,
        )

    def _create_kazakhstan_prompt(self) -> str:
        return f"""
Ты AI-ассистент бухгалтерской компании в Казахстане.
Отвечай только на русском языке.

Контекст:
- Считай {self.reference_year} годом по умолчанию для законов, отчетности, ставок, сроков и процедур.
- Если вопрос зависит от точных норм, сроков, ставок или форм {self.reference_year} года и ты не уверен, не выдумывай детали.
- Если запрос непонятный, сначала задай один короткий уточняющий вопрос.

Правила ответа:
1. Отвечай коротко, ясно и по делу.
2. Не используй Markdown, жирный текст, звездочки, заголовки, таблицы и декоративное оформление.
3. Не пиши фразы вроде «обращение закрыто», «вопрос решен», «диалог завершен» и похожие.
4. Не требуй от клиента выбора раздела перед ответом.
5. Пиши обычным текстом: 2-5 коротких предложений или очень короткий список без оформления Markdown.
6. Не проси клиента писать слово operator. Если нужен специалист, скажи нажать кнопку «Позвать оператора».
7. Если информации недостаточно или риск ошибки высокий, прямо скажи, что лучше уточнить вопрос или обратиться к оператору.
""".strip()

    def _fallback_response(self) -> str:
        return (
            "Мне нужно немного больше деталей, чтобы ответить точно. "
            "Уточните, пожалуйста, ваш вопрос."
        )

    def _build_operator_footer(self, operator_hint: str) -> str:
        return "Если нужна помощь специалиста, нажмите кнопку «Позвать оператора»."

    def _strip_formatting(self, response_text: str) -> str:
        response = (response_text or "").replace("**", "")
        response = response.replace("__", "")
        response = response.replace("```", "")
        cleaned_lines: List[str] = []
        for raw_line in response.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if any(line.startswith(prefix) for prefix in OPERATOR_FOOTER_PREFIXES):
                continue
            if line.startswith("#"):
                line = line.lstrip("#").strip()
            cleaned_lines.append(line)
        return "\n".join(cleaned_lines).strip()

    def _finalize_response(self, response_text: str, operator_hint: str) -> str:
        response = self._strip_formatting(response_text)
        lowered = response.lower()
        if not response or any(phrase in lowered for phrase in FORBIDDEN_CLOSURE_PHRASES):
            response = self._fallback_response()
        footer = self._build_operator_footer(operator_hint)
        if response.endswith(footer):
            return response
        return f"{response}\n\n{footer}".strip()

    def _build_ollama_prompt(self, user_message: str, chat_history: Optional[List[Dict]]) -> str:
        lines: List[str] = []
        if chat_history:
            for msg in chat_history[-4:]:
                text = str(msg.get("text", "")).strip()
                if not text:
                    continue
                speaker = "User" if msg.get("direction") == "incoming" else "Assistant"
                lines.append(f"{speaker}: {text}")
        lines.append(f"User: {user_message}")
        lines.append("Assistant:")
        return "\n".join(lines)

    def _ollama_generate_url(self) -> str:
        base_url = self.base_url.rstrip("/")
        if base_url.endswith("/api/generate"):
            return base_url
        if base_url.endswith("/api"):
            return f"{base_url}/generate"
        return f"{base_url}/api/generate"

    def _generate_ollama_response(
        self,
        user_message: str,
        chat_history: Optional[List[Dict]],
    ) -> str:
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "system": self.system_prompt,
            "prompt": self._build_ollama_prompt(user_message, chat_history),
            "stream": False,
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_predict": 400,
            },
        }
        response = requests.post(
            self._ollama_generate_url(),
            json=payload,
            headers=headers or None,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        return str(data.get("response", "")).strip()

    def generate_response(
        self,
        user_message: str,
        chat_history: Optional[List[Dict]] = None,
        *,
        operator_hint: str = "operator",
    ) -> str:
        """Generate an AI response for the user message."""
        try:
            logger.info("Generating AI response for message prefix=%s", user_message[:50])
            response_text = self._generate_ollama_response(user_message, chat_history)
            ai_response = self._finalize_response(
                response_text,
                operator_hint,
            )
            logger.info("AI response generated prefix=%s", ai_response[:100])
            return ai_response
        except Exception as exc:  # pragma: no cover - external service
            logger.error("AI generation failed: %s", exc)
            return self._finalize_response("", operator_hint)


def _init_ai_manager() -> OllamaAIManager:
    return OllamaAIManager()


ai_manager = _init_ai_manager()
