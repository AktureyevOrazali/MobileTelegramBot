import {
  AuthSession,
  AuthSessionRaw,
  ChatSummary,
  ChatSummaryRaw,
  DashboardSummary,
  DashboardSummaryRaw,
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
  return {
    totalDialogs: raw.total_dialogs,
    openDialogs: raw.open_dialogs,
    closedDialogs: raw.closed_dialogs,
    totalChats: raw.total_chats,
    totalMessages: raw.total_messages,
    totalIncomingMessages: raw.total_incoming_messages,
    totalOutgoingMessages: raw.total_outgoing_messages,
    averageMessagesPerDialog: raw.average_messages_per_dialog,
    avgDialogDurationMinutes: raw.avg_dialog_duration_minutes,
    sectionBreakdown: raw.section_breakdown.map((item) => ({
      section: item.section,
      title: item.title,
      dialogs: item.dialogs,
      percentage: item.percentage,
    })),
    topQuestions: raw.top_questions.map((item) => ({
      question: item.question,
      count: item.count,
    })),
    recentActivity: raw.recent_activity.map((item) => ({
      date: item.date,
      dialogs: item.dialogs,
      incomingMessages: item.incoming_messages,
    })),
    updatedAt: new Date(raw.updated_at),
  };
}