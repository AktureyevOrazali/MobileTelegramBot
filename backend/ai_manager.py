"""AI manager powered by Groq chat completions."""
from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional

from groq import Groq

from . import require_env

logger = logging.getLogger(__name__)

class GroqAIManager:
    def __init__(self) -> None:
        self.model = os.getenv("GROQ_MODEL", "llama3-70b-8192")
        api_key = require_env("GROQ_API_KEY")
        self.client = Groq(api_key=api_key)
        self.system_prompt = self._create_kazakhstan_prompt()
        logger.info("✅ Groq AI менеджер инициализирован. Модель: %s", self.model)


    def _create_kazakhstan_prompt(self) -> str:
        return """Ты — профессиональный AI-ассистент бухгалтерской компании, работающей в Казахстане.  
Твоя задача — помогать пользователям с бухгалтерскими и налоговыми вопросами, отвечая кратко, точно и понятным языком.

Контекст и актуальность:
- Используй нормы законодательства и практики Казахстана, актуальные на сегодняшний день.
- Если законы менялись недавно, учитывай последние обновления и сообщай о сроках действия требований.
- При отсутствии уверенности уточни вопрос и предложи связаться с оператором.

Контекст и актуальность:
- Используй нормы законодательства и практики Казахстана, актуальные на сегодняшний день.
- Если законы менялись недавно, учитывай последние обновления и сообщай о сроках действия требований.
- При отсутствии уверенности уточни вопрос и предложи связаться с оператором.

Правила общения:
1. Отвечай по существу, без лишней воды, понятным и профессиональным языком.
2. Если вопрос выходит за рамки бухгалтерии или ты не уверен — вежливо предложи обратиться к оператору.
3. Не давай юридических прогнозов — только факты и нормативную информацию.
4. Формат ответа: 2–4 предложения.
5. В конце каждого ответа добавляй фразу: **"Для деталей напишите 'оператор'."**
6. Поддерживай дружелюбный и уверенный тон.

"""
    
    def generate_response(
        self, user_message: str, chat_history: Optional[List[Dict]] = None
    ) -> str:
        """Генерирует ответ на сообщение пользователя"""
        try:
            messages = [{"role": "system", "content": self.system_prompt}]
            
            if chat_history:
                for msg in chat_history[-4:]:

                    role = "user" if msg.get("direction") == "incoming" else "assistant"

                    messages.append({"role": role, "content": msg.get("text", "")})
            

            messages.append({"role": "user", "content": user_message})
            
            logger.info("Генерируем AI ответ для сообщения: %s...", user_message[:50])

            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.3,
                top_p=0.9,
                max_tokens=400,
            )
            
            choice = response.choices[0]
            ai_response = (choice.message.content or "").strip()
            logger.info("AI ответ сгенерирован: %s...", ai_response[:100])
            
            return ai_response
            
        except Exception as e:  # pragma: no cover - внешние сервисы
            logger.error("Ошибка генерации AI ответа: %s", e)
            return (
                "Извините, AI помощник временно недоступен. Пожалуйста, напишите 'оператор' "
                "для связи с консультантом."
            )

def _init_ai_manager() -> GroqAIManager:
    manager = GroqAIManager()
    return manager


ai_manager = _init_ai_manager()