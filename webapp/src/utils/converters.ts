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
} from '../types';

export function mapUserProfile(raw: UserProfileRaw): UserProfile {
  const role = raw.role || 'viewer';
  const isAdmin = role === 'admin';
  const canReply = role === 'admin' || role === 'moderator';
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
    bins: raw.bins ?? [],
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
  const safeNumber = (value: number | null | undefined, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

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
        .map((agent) => ({
          name: agent.name ?? '',
          dialogs: safeNumber(agent.dialogs),
          messages: safeNumber(agent.messages),
          avgMessagesPerDialog: safeNumber(agent.avg_messages_per_dialog),
          lastActivity: agent.last_activity ? new Date(agent.last_activity) : null,
        }))
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
    sectionBreakdown,
    topQuestions,
    questionsBySection,
    agentBreakdown,
    recentActivity,
    updatedAt: raw.updated_at ? new Date(raw.updated_at) : new Date(),
  };
}