import type { ChatSummary } from '../types';

const DEFAULT_CHAT_LABEL = 'Клиент';

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #f2a23a, #ef7c45)',
  'linear-gradient(135deg, #6366f1, #818cf8)',
  'linear-gradient(135deg, #10b981, #34d399)',
  'linear-gradient(135deg, #f43f5e, #fb7185)',
  'linear-gradient(135deg, #3b82f6, #60a5fa)',
  'linear-gradient(135deg, #8b5cf6, #a78bfa)',
  'linear-gradient(135deg, #f59e0b, #fbbf24)',
  'linear-gradient(135deg, #ec4899, #f472b6)',
  'linear-gradient(135deg, #14b8a6, #5eead4)',
  'linear-gradient(135deg, #ef4444, #f87171)',
];

export const sanitizeChatAuthorLabel = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.includes('\uFFFD')) return null;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return null;
  return normalized;
};

const getChatAvatarBase = (chat: Pick<ChatSummary, 'title' | 'username'>): string => {
  return sanitizeChatAuthorLabel(chat.title) ?? sanitizeChatAuthorLabel(chat.username) ?? DEFAULT_CHAT_LABEL;
};

export const getChatAvatarLabel = (chat: Pick<ChatSummary, 'title' | 'username'>): string => {
  const base = getChatAvatarBase(chat);
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
};

export const getChatAvatarGradient = (chat: Pick<ChatSummary, 'title' | 'username'>): string => {
  const seed = getChatAvatarBase(chat);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
};
