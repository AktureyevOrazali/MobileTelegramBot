import { ApiError } from '../api/ApiClient';
import { sanitizeUiText } from './text';

/**
 * Извлекает человекочитаемое сообщение об ошибке из неизвестного `catch`-значения.
 *
 * Приоритет: ApiError.message → Error.message → fallback.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return sanitizeUiText(err.message) ?? fallback;
  if (err instanceof Error) return sanitizeUiText(err.message) ?? fallback;
  return sanitizeUiText(fallback) ?? fallback;
}
