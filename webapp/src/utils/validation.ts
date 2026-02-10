/**
 * Shared validation constants and functions.
 * Centralizes all validation rules to ensure consistency across the app.
 */

export const MIN_PASSWORD_LENGTH = 4;
export const MIN_NAME_LENGTH = 2;

/**
 * Validates a password and returns a user-facing error message, or null if valid.
 */
export function validatePassword(password: string): string | null {
    if (password.trim().length < MIN_PASSWORD_LENGTH) {
        return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов.`;
    }
    return null;
}

/**
 * Validates a display name and returns a user-facing error message, or null if valid.
 */
export function validateName(name: string): string | null {
    if (name.trim().length < MIN_NAME_LENGTH) {
        return `Имя должно содержать минимум ${MIN_NAME_LENGTH} символа.`;
    }
    return null;
}

/**
 * Validates that two passwords match. Returns error message or null.
 */
export function validatePasswordMatch(password: string, confirm: string): string | null {
    if (password !== confirm) {
        return 'Пароли не совпадают.';
    }
    return null;
}
