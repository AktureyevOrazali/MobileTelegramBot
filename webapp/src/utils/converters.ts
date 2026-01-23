import {
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
  Message,
  MessageNotification,
  MessageNotificationRaw,
  MessageRaw,
  UserProfile,
  UserProfileRaw,
  UserBinAssignment,
  UserBinAssignmentRaw,
} from '../types';

export function mapUserProfile(raw: UserProfileRaw): UserProfile {
  const role = raw.role || 'viewer';
  const isAdmin = role === 'admin';
  const canReply = role === 'admin' || role === 'moderator';
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
      const binLabel = typeof entry.bin === 'string' ? entry.bin.trim() : '';
      if (!binLabel) {
        return;
      }
      const assignedSource = (entry as UserBinAssignmentRaw).assigned_at ?? (entry as any).assignedAt;
      const expiresSource = entry.expires_at ?? (entry as any).expiresAt ?? null;
      const assignedAt = assignedSource ? new Date(assignedSource) : now;
      const expiresAt = expiresSource ? new Date(expiresSource) : null;
      assignments.push({
        bin: binLabel,
        assignedAt: Number.isNaN(assignedAt.getTime()) ? now : assignedAt,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        assignedBy:
          typeof entry.assigned_by === 'number'
            ? entry.assigned_by
            : typeof (entry as any).assignedBy === 'number'
            ? (entry as any).assignedBy
            : undefined,
      });
    });
    assignments.sort((a, b) => a.bin.localeCompare(b.bin));
    return assignments;
  };
  return {
    id: raw.id,
    email: raw.email,
    login: raw.login,
    name: raw.name,
    createdAt: new Date(raw.created_at),
    jobTitle: raw.job_title,
    phone: raw.phone,
    bio: raw.bio,
    role,
    sections: raw.sections ?? [],
    bins: mapAssignments(raw.bins),
    favoriteDialogIds: raw.favorite_dialog_ids ?? [],
    isAdmin,
    canReply,
  };
}


export function mapSession(raw: AuthSessionRaw): AuthSession {
  return {
    token: raw.token,
    user: mapUserProfile(raw.user),
  };
}

export function mapChatSummary(raw: ChatSummaryRaw): ChatSummary {
  const operatorMode = Boolean(raw.operator_mode);
  return {
    chatId: raw.chat_id,
    dialogId: raw.dialog_id ?? raw.chat_id,
    title: raw.title,
    username: raw.username ?? null,
    type: raw.type,
    updatedAt: new Date(raw.updated_at),
    dialogStartedAt: new Date(raw.dialog_started_at),
    dialogClosedAt: raw.dialog_closed_at ? new Date(raw.dialog_closed_at) : null,
    section: raw.section ?? null,
    sectionTitle: raw.section_title ?? null,
    bin: raw.bin ?? null,
    isFavorite: Boolean(raw.is_favorite),
    aiEnabled: !operatorMode,
    unreadCount: typeof raw.unread_count === 'number' ? raw.unread_count : 0,
  };
}

export function mapMessage(raw: MessageRaw): Message {
  return {
    id: raw.id,
    chatId: raw.chat_id,
    direction: raw.direction,
    text: raw.text,
    author: raw.author ?? null,
    createdAt: new Date(raw.created_at),
    section: raw.section ?? null,
    sectionTitle: raw.section_title ?? null,
    dialogId: raw.dialog_id ?? null,
  };
}

export function mapNotification(raw: MessageNotificationRaw): MessageNotification {
  return {
    type: raw.type,
    chatId: raw.chat_id ?? null,
    chatTitle: raw.chat_title ?? null,
    text: raw.text,
    createdAt: new Date(raw.created_at),
    section: raw.section ?? null,
    sectionTitle: raw.section_title ?? null,
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

          return {
            name: agent.name ?? '',
            dialogs,
            messages,
            avgMessagesPerDialog,
            avgResponseTimeMinutes,
            lastActivity: agent.last_activity ? new Date(agent.last_activity) : null,
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

  return {
    totalDialogs: safeNumber(raw.total_dialogs),
    openDialogs: safeNumber(raw.open_dialogs),
    closedDialogs: safeNumber(raw.closed_dialogs),
    totalChats: safeNumber(raw.total_chats),
    totalMessages: safeNumber(raw.total_messages),
    totalIncomingMessages: safeNumber(raw.total_incoming_messages),
    totalOutgoingMessages: safeNumber(raw.total_outgoing_messages),
    averageMessagesPerDialog: safeNumber(raw.average_messages_per_dialog),
    avgDialogDurationMinutes:
      typeof raw.avg_dialog_duration_minutes === 'number' && Number.isFinite(raw.avg_dialog_duration_minutes)
        ? raw.avg_dialog_duration_minutes
        : null,
    avgResponseTimeMinutes: parseResponseTimeMinutes(),
    sectionBreakdown,
    topQuestions,
    questionsBySection,
    agentBreakdown,
    recentActivity,
    updatedAt: raw.updated_at ? new Date(raw.updated_at) : new Date(),
  };
}