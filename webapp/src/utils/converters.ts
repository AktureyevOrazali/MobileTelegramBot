import {
  Attachment,
  AttachmentRaw,
  AuthSession,
  AuthSessionRaw,
  ChatSummary,
  ChatSummaryRaw,
  DashboardSummary,
  DashboardSummaryRaw,
  DashboardActivityPointRaw,
  DashboardAgentStatRaw,
  DashboardSectionStatRaw,
  DashboardSectionTopQuestionsRaw,
  DashboardTopBinRaw,
  DashboardHeatmapPointRaw,
  Message,
  MessageNotification,
  MessageNotificationRaw,
  MessageRaw,
  UserProfile,
  UserProfileRaw,
  UserBinAssignment,
  UserBinAssignmentRaw,
} from '../types';
import { DEFAULT_EMPLOYEE_ORGANIZATION } from '../constants/hrOrganizations';
import { isAdminLikeRole, normalizeRole, roleCanReply } from './roles';
import { sanitizeUiText } from './text';

/**
 * Shape of a bin assignment entry as it may appear in localStorage
 * (could be camelCase or snake_case depending on how it was persisted).
 */
interface StoredBinEntry {
  bin?: unknown;
  assigned_at?: unknown;
  assignedAt?: unknown;
  expires_at?: unknown;
  expiresAt?: unknown;
  assigned_by?: unknown;
  assignedBy?: unknown;
}

export function mapUserProfile(raw: UserProfileRaw): UserProfile {
  const role = normalizeRole(raw.role);
  const isAdmin = isAdminLikeRole(role);
  const canReply = roleCanReply(role);
  const mapAssignments = (
    entries: (string | UserBinAssignmentRaw)[] | undefined,
  ): UserBinAssignment[] => {
    if (!Array.isArray(entries)) {
      return [];
    }
    const now = new Date();
    const assignments: UserBinAssignment[] = [];
    entries.forEach((entry) => {
      if (!entry) {
        return;
      }
      if (typeof entry === 'string') {
        const binLabel = entry.trim();
        if (!binLabel) {
          return;
        }
        assignments.push({
          bin: binLabel,
          assignedAt: now,
          expiresAt: null,
          assignedBy: undefined,
        });
        return;
      }
      const storedEntry = entry as StoredBinEntry;
      const binLabel = typeof storedEntry.bin === 'string' ? (storedEntry.bin as string).trim() : '';
      if (!binLabel) {
        return;
      }
      const assignedSource = entry.assigned_at ?? storedEntry.assignedAt;
      const expiresSource = entry.expires_at ?? storedEntry.expiresAt ?? null;
      const assignedAt = assignedSource ? new Date(assignedSource as string | number) : now;
      const expiresAt = expiresSource ? new Date(expiresSource as string | number) : null;
      assignments.push({
        bin: binLabel,
        assignedAt: Number.isNaN(assignedAt.getTime()) ? now : assignedAt,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        assignedBy:
          typeof entry.assigned_by === 'number'
            ? entry.assigned_by
            : typeof storedEntry.assignedBy === 'number'
              ? (storedEntry.assignedBy as number)
              : undefined,
      });
    });
    assignments.sort((a, b) => a.bin.localeCompare(b.bin));
    return assignments;
  };
  return {
    id: raw.id,
    email: sanitizeUiText(raw.email) ?? raw.email,
    login: sanitizeUiText(raw.login) ?? raw.login,
    name: sanitizeUiText(raw.name) ?? raw.name,
    createdAt: new Date(raw.created_at),
    jobTitle: sanitizeUiText(raw.job_title) ?? raw.job_title,
    organization: sanitizeUiText(raw.organization) ?? raw.organization ?? DEFAULT_EMPLOYEE_ORGANIZATION,
    phone: sanitizeUiText(raw.phone) ?? raw.phone,
    bio: sanitizeUiText(raw.bio) ?? raw.bio,
    role,
    isApproved: raw.is_approved ?? true,
    sections: raw.sections ?? [],
    bins: mapAssignments(raw.bins),
    favoriteDialogIds: raw.favorite_dialog_ids ?? [],
    isAdmin,
    canReply,
  };
}

/**
 * Normalizes bin assignment entries from localStorage (untyped JSON).
 * Handles both camelCase and snake_case field names.
 * Used by ApiContext to deserialize persisted session.
 */
export function normalizeAssignmentsFromStorage(entries: unknown): UserBinAssignment[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const now = new Date();
  const assignments: UserBinAssignment[] = [];
  (entries as unknown[]).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const entry = item as StoredBinEntry;
    if (typeof entry.bin !== 'string') return;
    const bin = (entry.bin as string).trim();
    if (!bin) return;
    const assignedAtRaw = entry.assignedAt ?? entry.assigned_at;
    const expiresAtRaw = entry.expiresAt ?? entry.expires_at;
    const assignedAt = assignedAtRaw ? new Date(assignedAtRaw as string | number) : now;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw as string | number) : null;
    assignments.push({
      bin,
      assignedAt: Number.isNaN(assignedAt.getTime()) ? now : assignedAt,
      expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
      assignedBy:
        typeof entry.assignedBy === 'number'
          ? (entry.assignedBy as number)
          : typeof entry.assigned_by === 'number'
            ? (entry.assigned_by as number)
            : undefined,
    });
  });
  return assignments;
}


export function mapSession(raw: AuthSessionRaw): AuthSession {
  return {
    token: raw.token,
    user: mapUserProfile(raw.user),
  };
}

export function mapAttachment(raw: AttachmentRaw): Attachment {
  return {
    id: raw.id,
    mediaId: raw.media_id,
    kind: raw.kind,
    url: raw.url,
    previewUrl: raw.preview_url ?? null,
    mimeType: raw.mime_type,
    sizeBytes: raw.size_bytes,
    originalName: raw.original_name,
    width: raw.width ?? null,
    height: raw.height ?? null,
    durationSec: raw.duration_sec ?? null,
    caption: raw.caption ?? null,
  };
}

export function mapChatSummary(raw: ChatSummaryRaw): ChatSummary {
  const operatorMode = Boolean(raw.operator_mode);
  return {
    chatId: raw.chat_id,
    dialogId: raw.dialog_id ?? raw.chat_id,
    title: sanitizeUiText(raw.title) ?? raw.title,
    username: sanitizeUiText(raw.username) ?? null,
    type: raw.type,
    updatedAt: new Date(raw.updated_at),
    dialogStartedAt: new Date(raw.dialog_started_at),
    dialogClosedAt: raw.dialog_closed_at ? new Date(raw.dialog_closed_at) : null,
    dialogPurgeAt: raw.dialog_purge_at ? new Date(raw.dialog_purge_at) : null,
    section: raw.section ?? null,
    sectionTitle: sanitizeUiText(raw.section_title) ?? null,
    bin: raw.bin ?? null,
    isFavorite: Boolean(raw.is_favorite),
    aiEnabled: !operatorMode,
    unreadCount: typeof raw.unread_count === 'number' ? raw.unread_count : 0,
    lastMessageText: typeof raw.last_message_text === 'string' ? sanitizeUiText(raw.last_message_text) : null,
    lastMessageDirection: raw.last_message_direction === 'incoming' || raw.last_message_direction === 'outgoing' ? raw.last_message_direction : null,
    lastMessageAuthor: typeof raw.last_message_author === 'string' ? sanitizeUiText(raw.last_message_author) : null,
    lastMessageHasAttachments: Boolean(raw.last_message_has_attachments),
    lastMessageAttachmentKind: typeof raw.last_message_attachment_kind === 'string' ? raw.last_message_attachment_kind : null,
    employeeAssessmentId: typeof raw.employee_assessment_id === 'number' ? raw.employee_assessment_id : null,
    employeeAssessmentPending: Boolean(raw.employee_assessment_pending),
    employeeAssessmentCreatedAt: raw.employee_assessment_created_at ? new Date(raw.employee_assessment_created_at) : null,
  };
}

export function mapMessage(raw: MessageRaw): Message {
  return {
    id: raw.id,
    chatId: raw.chat_id,
    direction: raw.direction,
    text: sanitizeUiText(raw.text) ?? raw.text,
    author: sanitizeUiText(raw.author) ?? null,
    createdAt: new Date(raw.created_at),
    section: raw.section ?? null,
    sectionTitle: sanitizeUiText(raw.section_title) ?? null,
    dialogId: raw.dialog_id ?? null,
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(mapAttachment) : [],
  };
}

export function mapNotification(raw: MessageNotificationRaw): MessageNotification {
  return {
    type: raw.type,
    chatId: raw.chat_id ?? null,
    chatTitle: sanitizeUiText(raw.chat_title) ?? null,
    text: sanitizeUiText(raw.text) ?? raw.text,
    createdAt: new Date(raw.created_at),
    section: raw.section ?? null,
    sectionTitle: sanitizeUiText(raw.section_title) ?? null,
    bin: raw.bin ?? null,
    dialogId: raw.dialog_id ?? null,
  };
}

export function mapDashboardSummary(raw: DashboardSummaryRaw): DashboardSummary {
  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().replace(',', '.');
      if (!normalized) {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return null;
  };

  const safeNumber = (value: unknown, fallback = 0): number => {
    const parsed = toNumber(value);
    return parsed === null ? fallback : parsed;
  };

  const parseIsoDurationMinutes = (value: string): number | null => {
    const match = value.trim().match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[.,]\d+)?)S)?$/i);
    if (!match) {
      return null;
    }
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = match[2] ? Number(match[2]) : 0;
    const seconds = match[3] ? Number(match[3].replace(',', '.')) : 0;
    return hours * 60 + minutes + seconds / 60;
  };

  const parseResponseTimeMinutes = (): number | null => {
    const minutes = toNumber(raw.avg_response_time_minutes);
    if (minutes !== null) {
      return minutes;
    }
    if (typeof raw.avg_response_time_minutes === 'string') {
      const duration = parseIsoDurationMinutes(raw.avg_response_time_minutes);
      if (duration !== null) {
        return duration;
      }
    }
    const seconds = toNumber(raw.avg_response_time_seconds);
    if (seconds !== null) {
      return seconds / 60;
    }
    if (typeof raw.avg_response_time_seconds === 'string') {
      const duration = parseIsoDurationMinutes(raw.avg_response_time_seconds);
      if (duration !== null) {
        return duration;
      }
    }
    return null;
  };

  const sectionBreakdown = Array.isArray(raw.section_breakdown)
    ? raw.section_breakdown
      .filter((item): item is DashboardSectionStatRaw => Boolean(item))
      .map((item) => ({
        section: item.section ?? null,
        title: item.title ?? '',
        dialogs: safeNumber(item.dialogs),
        percentage: safeNumber(item.percentage),
      }))
    : [];

  const topQuestions = Array.isArray(raw.top_questions)
    ? raw.top_questions
      .filter((item) => Boolean(item) && typeof item.question === 'string')
      .map((item) => ({
        question: item.question,
        count: safeNumber(item.count),
      }))
    : [];

  const questionsBySection = Array.isArray(raw.questions_by_section)
    ? raw.questions_by_section
      .filter((section): section is DashboardSectionTopQuestionsRaw => Boolean(section))
      .map((section) => ({
        section: section.section ?? null,
        title: section.title ?? '',
        questions: Array.isArray(section.questions)
          ? section.questions
            .filter((item) => Boolean(item) && typeof item.question === 'string')
            .map((item) => ({
              question: item.question,
              count: safeNumber(item.count),
            }))
          : [],
      }))
    : [];

  const agentBreakdown = Array.isArray(raw.agent_breakdown)
    ? raw.agent_breakdown
      .filter((agent): agent is DashboardAgentStatRaw => Boolean(agent))
      .map((agent) => {
        const dialogs = safeNumber(agent.dialogs);
        const rawMessages = safeNumber(agent.messages);
        const messages = dialogs > 0 ? rawMessages : 0;
        const avgFromApi =
          typeof agent.avg_messages_per_dialog === 'number' && Number.isFinite(agent.avg_messages_per_dialog)
            ? agent.avg_messages_per_dialog
            : null;
        const avgMessagesPerDialog = dialogs > 0
          ? (avgFromApi ?? (messages / dialogs))
          : 0;
        const avgResponseTimeMinutes =
          typeof agent.avg_response_time_minutes === 'number' && Number.isFinite(agent.avg_response_time_minutes)
            ? agent.avg_response_time_minutes
            : null;
        const avgCsat =
          typeof agent.avg_csat === 'number' && Number.isFinite(agent.avg_csat)
            ? agent.avg_csat
            : null;

        return {
          name: agent.name ?? '',
          dialogs,
          messages,
          avgMessagesPerDialog,
          avgResponseTimeMinutes,
          lastActivity: agent.last_activity ? new Date(agent.last_activity) : null,
          avgCsat,
        };
      })
    : [];

  const recentActivity = Array.isArray(raw.recent_activity)
    ? raw.recent_activity
      .filter((item): item is DashboardActivityPointRaw => Boolean(item))
      .map((item) => ({
        date: item.date,
        dialogs: safeNumber(item.dialogs),
        incomingMessages: safeNumber(item.incoming_messages),
      }))
    : [];

  const responseTimeDialogs = Array.isArray(raw.response_time_dialogs)
    ? raw.response_time_dialogs
      .filter((item) => Boolean(item) && typeof item.author === 'string')
      .map((item) => ({
        chatId: typeof item.chat_id === 'number' ? item.chat_id : null,
        dialogId: typeof item.dialog_id === 'number' ? item.dialog_id : null,
        author: item.author,
        responseTimeMinutes: safeNumber(item.response_time_minutes),
      }))
    : [];

  const topBinsWithoutContract = Array.isArray(raw.top_bins_without_contract)
    ? raw.top_bins_without_contract
      .filter((item): item is DashboardTopBinRaw => Boolean(item))
      .map((item) => ({
        bin: item.bin ?? '',
        requests: safeNumber(item.requests),
      }))
    : [];

  const topBinsWithContract = Array.isArray(raw.top_bins_with_contract)
    ? raw.top_bins_with_contract
      .filter((item): item is DashboardTopBinRaw => Boolean(item))
      .map((item) => ({
        bin: item.bin ?? '',
        requests: safeNumber(item.requests),
      }))
    : [];

  const peakLoadHeatmap = Array.isArray(raw.peak_load_heatmap)
    ? raw.peak_load_heatmap
      .filter((item): item is DashboardHeatmapPointRaw => Boolean(item))
      .map((item) => ({
        dayOfWeek: safeNumber(item.day_of_week),
        hour: safeNumber(item.hour),
        count: safeNumber(item.count),
      }))
    : [];

  const dialogMetrics = Array.isArray(raw.dialog_metrics)
    ? raw.dialog_metrics
      .filter((item) => Boolean(item))
      .map((item) => ({
        dialogId: typeof item.dialog_id === 'number' ? item.dialog_id : 0,
        bin: typeof item.bin === 'string' ? item.bin : null,
        isOpen: Boolean(item.is_open),
        isAiClosed: Boolean(item.is_ai_closed),
        responseTimeMinutes: typeof item.response_time_minutes === 'number' ? item.response_time_minutes : null,
        csatRating: typeof item.csat_rating === 'number' ? item.csat_rating : null,
        aiCsatRating: typeof item.ai_csat_rating === 'number' ? item.ai_csat_rating : null,
        ratedBy: typeof item.rated_by === 'string' ? item.rated_by : null,
        operatorName: typeof item.operator_name === 'string' ? item.operator_name : null,
      }))
    : [];

  return {
    totalDialogs: safeNumber(raw.total_dialogs),
    openDialogs: safeNumber(raw.open_dialogs),
    closedDialogs: safeNumber(raw.closed_dialogs),
    totalChats: safeNumber(raw.total_chats),
    totalMessages: safeNumber(raw.total_messages),
    totalIncomingMessages: safeNumber(raw.total_incoming_messages),
    totalOutgoingMessages: safeNumber(raw.total_outgoing_messages),
    aiClosedDialogs: safeNumber(raw.ai_closed_dialogs),
    transferredToOperatorDialogs: safeNumber(raw.transferred_to_operator_dialogs),
    avgMessagesBeforeTransfer: typeof raw.avg_messages_before_transfer === 'number' ? raw.avg_messages_before_transfer : null,
    aiMessagesCount: safeNumber(raw.ai_messages_count),
    requestsWithContract: safeNumber(raw.requests_with_contract),
    requestsWithoutContract: safeNumber(raw.requests_without_contract),
    recurringRequestsCount: safeNumber(raw.recurring_requests_count),
    recurringRequestsPercentage: typeof raw.recurring_requests_percentage === 'number' ? raw.recurring_requests_percentage : null,
    slaViolationsCount: safeNumber(raw.sla_violations_count),
    slaCompliancePercentage: typeof raw.sla_compliance_percentage === 'number' ? raw.sla_compliance_percentage : null,
    averageFirstMessageLength: typeof raw.average_first_message_length === 'number' ? raw.average_first_message_length : null,
    averageMessagesPerDialog: safeNumber(raw.average_messages_per_dialog),
    avgDialogDurationMinutes:
      typeof raw.avg_dialog_duration_minutes === 'number' && Number.isFinite(raw.avg_dialog_duration_minutes)
        ? raw.avg_dialog_duration_minutes
        : null,
    avgResponseTimeMinutes: parseResponseTimeMinutes(),
    responseTimeDialogs,
    sectionBreakdown,
    topQuestions,
    questionsBySection,
    agentBreakdown,
    recentActivity,
    topBinsWithoutContract,
    topBinsWithContract,
    peakLoadHeatmap,
    dialogMetrics,
    csatAverage: typeof raw.csat_average === 'number' ? raw.csat_average : null,
    csatCount: safeNumber(raw.csat_count),
    csatDistribution: Array.isArray(raw.csat_distribution)
      ? raw.csat_distribution.map((item: { rating: number; count: number }) => ({
        rating: safeNumber(item.rating),
        count: safeNumber(item.count),
      }))
      : [],
    aiCsatAverage: typeof raw.ai_csat_average === 'number' ? raw.ai_csat_average : null,
    aiCsatCount: safeNumber(raw.ai_csat_count),
    aiCsatDistribution: Array.isArray(raw.ai_csat_distribution)
      ? raw.ai_csat_distribution.map((item: { rating: number; count: number }) => ({
        rating: safeNumber(item.rating),
        count: safeNumber(item.count),
      }))
      : [],
    updatedAt: raw.updated_at ? new Date(raw.updated_at) : new Date(),
  };
}








