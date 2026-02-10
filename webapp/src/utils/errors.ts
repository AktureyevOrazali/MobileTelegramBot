import { ApiError } from '../api/ApiClient';

/**
 * Извлекает человекочитаемое сообщение об ошибке из неизвестного `catch`-значения.
 *
 * Приоритет: ApiError.message → Error.message → fallback.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return fallback;
}
