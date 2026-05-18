/**
 * Admin-specific helper functions.
 * Extracted from AdminPage to reduce file size and improve reusability.
 */

import { UserBinAssignment } from '../types';
import { ROLE_LABELS } from './roles';

/** Maps a role ID to a human-readable Russian label. */
export const roleLabels: Record<string, string> = ROLE_LABELS;

/**
 * Formats a Date for a `<input type="datetime-local">` value string.
 * Returns `YYYY-MM-DDTHH:MM` format.
 */
export const formatDateTimeLocalInput = (date: Date): string => {
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * Parses a `<input type="datetime-local">` value string back to a Date.
 * Returns null if the string is empty or invalid.
 */
export const parseDateTimeLocalInput = (value: string): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Russian pluralization for the word "диалог" (dialog).
 * E.g. 1 → диалог, 3 → диалога, 5 → диалогов.
 */
export const pluralizeDialogs = (count: number): string => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'диалог';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'диалога';
    return 'диалогов';
};

/**
 * Deep-clones a UserBinAssignment (copies Date objects by value).
 */
export const cloneAssignment = (assignment: UserBinAssignment): UserBinAssignment => ({
    bin: assignment.bin,
    assignedAt: new Date(assignment.assignedAt),
    expiresAt: assignment.expiresAt ? new Date(assignment.expiresAt) : null,
    assignedBy: assignment.assignedBy,
});
