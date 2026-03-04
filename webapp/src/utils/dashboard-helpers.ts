import { DashboardSummary } from '../types';

/** Regex to strip "[FAQ]" prefix from question text. */
export const FAQ_PREFIX_REGEX = /^\[(faq)\]\s*/i;

/** Regex to detect "[…команда…]" tags in question text. */
export const COMMAND_TAG_REGEX = /^\[[^\]]*команда[^\]]*\]/i;

/** Thresholds (minutes) for classifying operator response speed. */
export const RESPONSE_SPEED_THRESHOLDS = {
    fast: 2,
    medium: 7,
} as const;

/** Blank dashboard summary used as a fallback before data loads. */
export const EMPTY_SUMMARY: DashboardSummary = {
    totalDialogs: 0,
    openDialogs: 0,
    closedDialogs: 0,
    totalChats: 0,
    totalMessages: 0,
    totalIncomingMessages: 0,
    totalOutgoingMessages: 0,
    averageMessagesPerDialog: 0,
    avgDialogDurationMinutes: null,
    avgResponseTimeMinutes: null,
    aiClosedDialogs: 0,
    transferredToOperatorDialogs: 0,
    avgMessagesBeforeTransfer: null,
    aiMessagesCount: 0,
    requestsWithContract: 0,
    requestsWithoutContract: 0,
    recurringRequestsCount: 0,
    recurringRequestsPercentage: null,
    slaViolationsCount: 0,
    slaCompliancePercentage: null,
    averageFirstMessageLength: null,
    responseTimeDialogs: [],
    sectionBreakdown: [],
    topQuestions: [],
    questionsBySection: [],
    agentBreakdown: [],
    recentActivity: [],
    topBinsWithoutContract: [],
    topBinsWithContract: [],
    peakLoadHeatmap: [],
    dialogMetrics: [],
    updatedAt: new Date(0),
    csatAverage: null as number | null,
    csatCount: 0,
    csatDistribution: [] as any[],
    aiCsatAverage: null as number | null,
    aiCsatCount: 0,
    aiCsatDistribution: [] as any[],
};

// ── Derived types ──

export type QuestionSection = DashboardSummary['questionsBySection'][number] & { totalCount: number };
export type QuestionSectionEntry = { key: string; title: string; section: QuestionSection };

// ── Pure helper functions ──

/** Convert a Date to a yyyy-MM-dd string in local timezone. */
export function toInputDate(date: Date): string {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Parse a yyyy-MM-dd input string to a Date (midnight, local). Returns null on invalid. */
export function parseInputDate(value: string): Date | null {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

/** Shift a Date by the given number of days. */
export function shiftDate(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Format a duration in minutes to a human-readable "Xм Yс" string. */
export function formatMinutes(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    const totalSeconds = Math.round(value * 60);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}м${seconds > 0 ? ` ${seconds}с` : ''}`;
    return `${seconds}с`;
}

/** Classify a response time (minutes) into fast / medium / slow bucket. */
export function classifyResponseSpeed(minutes: number | null): 'fast' | 'medium' | 'slow' | null {
    if (minutes === null) return null;
    if (minutes < RESPONSE_SPEED_THRESHOLDS.fast) return 'fast';
    if (minutes <= RESPONSE_SPEED_THRESHOLDS.medium) return 'medium';
    return 'slow';
}

/** Extract up to 2-character initials from a name string. */
export function getInitials(name: string): string {
    const tokens = name.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 'NA';
    return tokens
        .slice(0, 2)
        .map((token) => token[0]?.toUpperCase())
        .join('');
}

/** Parse a question string into display text + optional FAQ badge. */
export function parseQuestion(raw: string): { text: string; badge: string | null } {
    const trimmed = raw.trim();
    const match = trimmed.match(FAQ_PREFIX_REGEX);
    return { text: match ? trimmed.slice(match[0].length) : trimmed, badge: match ? match[1].toUpperCase() : null };
}

/** Normalize question text for deduplication (lowercase, strip FAQ prefix). */
export function normalizeQuestionText(raw: string): string {
    const trimmed = raw.trim();
    const withoutFaq = trimmed.replace(FAQ_PREFIX_REGEX, '');
    return withoutFaq.trim().toLowerCase();
}

/** Speed bucket label (Russian). */
export function speedLabel(key: 'fast' | 'medium' | 'slow'): string {
    if (key === 'fast') return 'Быстрые';
    if (key === 'medium') return 'Средние';
    return 'Медленные';
}
