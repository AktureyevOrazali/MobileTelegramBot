"""AI manager powered by DeepSeek chat completions."""
from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional

from openai import OpenAI

from . import require_env

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


class DeepSeekAIManager:
    def __init__(self) -> None:
        self.model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        api_key = require_env("DEEPSEEK_API_KEY")
        base_url = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com")
        self.reference_year = os.getenv("AI_REFERENCE_YEAR", "2026")
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.system_prompt = self._create_kazakhstan_prompt()
        logger.info("DeepSeek AI manager initialized. model=%s base_url=%s", self.model, base_url)

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
6. В конце каждого ответа добавляй короткую фразу о возможности обратиться к оператору.
7. Если информации недостаточно или риск ошибки высокий, прямо скажи, что лучше уточнить вопрос или обратиться к оператору.
""".strip()

    def _fallback_response(self) -> str:
        return (
            "Мне нужно немного больше деталей, чтобы ответить точно. "
            "Уточните, пожалуйста, ваш вопрос."
        )

    def _build_operator_footer(self, operator_hint: str) -> str:
        hint = (operator_hint or "operator").strip() or "operator"
        return f"Можете обратиться к оператору. Напишите: {hint}."

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

    def generate_response(
        self,
        user_message: str,
        chat_history: Optional[List[Dict]] = None,
        *,
        operator_hint: str = "operator",
    ) -> str:
        """Generate an AI response for the user message."""
        try:
            messages = [{"role": "system", "content": self.system_prompt}]
            if chat_history:
                for msg in chat_history[-4:]:
                    role = "user" if msg.get("direction") == "incoming" else "assistant"
                    messages.append({"role": role, "content": msg.get("text", "")})
            messages.append({"role": "user", "content": user_message})

            logger.info("Generating AI response for message prefix=%s", user_message[:50])
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.3,
                top_p=0.9,
                max_tokens=400,
            )
            choice = response.choices[0]
            ai_response = self._finalize_response(
                (choice.message.content or "").strip(),
                operator_hint,
            )
            logger.info("AI response generated prefix=%s", ai_response[:100])
            return ai_response
        except Exception as exc:  # pragma: no cover - external service
            logger.error("AI generation failed: %s", exc)
            return self._finalize_response("", operator_hint)


def _init_ai_manager() -> DeepSeekAIManager:
    return DeepSeekAIManager()


ai_manager = _init_ai_manager()
