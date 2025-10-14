import {
  AuthSession,
  AuthSessionRaw,
  ChatSummary,
  ChatSummaryRaw,
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
    favoriteChatIds: raw.favorite_chat_ids ?? [],
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
    dialogId: raw.dialog_id,
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