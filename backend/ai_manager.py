# backend/ai_manager.py
import ollama
import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

class OllamaManager:
    def __init__(self):
        self.model = "mistral:7b"
        self.system_prompt = self._create_kazakhstan_prompt()
        self._check_ollama()
    
    def _check_ollama(self):
        """Проверяем доступность Ollama"""
        try:
            models = ollama.list()
            logger.info(f"✅ Ollama доступен. Модели: {[m['name'] for m in models['models']]}")
            
            # Проверяем что нужная модель есть
            model_names = [m['name'] for m in models['models']]
            if self.model not in model_names:
                logger.warning(f"Модель {self.model} не найдена. Доступные: {model_names}")
                # Пробуем использовать первую доступную модель
                if model_names:
                    self.model = model_names[0]
                    logger.info(f"Используем модель: {self.model}")
            
        except Exception as e:
            logger.error(f"❌ Ollama не доступен: {e}")
            raise Exception("Ollama не запущен. Запустите: ollama serve")
    
    def _create_kazakhstan_prompt(self) -> str:
        return """Ты - AI-ассистент бухгалтерской компании в Казахстане. 

Отвечай на вопросы по темам:
- Налоги РК: НДС, ИПН, корпоративный налог
- Бухгалтерская отчетность и учет
- Трудовое законодательство РК
- Финансовая отчетность

Правила:
1. Отвечай точно и профессионально
2. Если не уверен - предложи оператора
3. Не давай юридических консультаций
4. Сохраняй ответы краткими

Формат: Ответ + "Для деталей напишите 'оператор'"
"""
    
    def generate_response(self, user_message: str, chat_history: Optional[List[Dict]] = None) -> str:
        """Генерирует ответ на сообщение пользователя"""
        try:
            # Подготавливаем сообщения
            messages = [{"role": "system", "content": self.system_prompt}]
            
            # Добавляем историю чата если есть
            if chat_history:
                for msg in chat_history[-4:]:  # Берем последние 4 сообщения
                    role = "user" if msg.get("direction") == "incoming" else "assistant"
                    messages.append({"role": role, "content": msg.get("text", "")})
            
            # Добавляем текущее сообщение
            messages.append({"role": "user", "content": user_message})
            
            logger.info(f"Генерируем AI ответ для сообщения: {user_message[:50]}...")
            
            # Генерируем ответ
            response = ollama.chat(
                model=self.model,
                messages=messages,
                options={
                    "temperature": 0.3,
                    "top_p": 0.9,
                    "num_predict": 400
                }
            )
            
            ai_response = response['message']['content'].strip()
            logger.info(f"AI ответ сгенерирован: {ai_response[:100]}...")
            
            return ai_response
            
        except Exception as e:
            logger.error(f"Ошибка генерации AI ответа: {e}")
            return "Извините, AI помощник временно недоступен. Пожалуйста, напишите 'оператор' для связи с консультантом."

# Создаем глобальный экземпляр
try:
    ai_manager = OllamaManager()
    logger.info("✅ AI менеджер успешно инициализирован")
except Exception as e:
    logger.error(f"❌ Не удалось инициализировать AI менеджер: {e}")
    ai_manager = None