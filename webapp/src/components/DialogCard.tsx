import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatSummary } from '../types';

interface StatusBadgeInfo {
  canClick: boolean;
  onClick: () => void;
}

interface DialogCardProps {
  chat: ChatSummary;
  index: number;
  isActive: boolean;
  aiToggleDialogId: number | null;
  canDeleteDialog: boolean;
  statusBadge: StatusBadgeInfo;
  onOpenChat: (chat: ChatSummary) => void;
  onToggleAi: (chat: ChatSummary) => void;
  onToggleFavorite: (dialogId: number, currentIsFavorite: boolean) => void;
  onDeleteRequest: (chat: ChatSummary) => void;
}

const sanitizeAuthorLabel = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.includes('\uFFFD')) return null;
  if (!/[\p{L}\p{N}]/u.test(normalized)) return null;
  return normalized;
};

const getAvatarLabel = (chat: ChatSummary): string => {
  const base = sanitizeAuthorLabel(chat.title) ?? chat.username ?? '\u041a\u043b\u0438\u0435\u043d\u0442';
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
};

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

const getAvatarColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
};

const formatDialogTimestamp = (value: Date): string => {
  const now = new Date();
  const sameDay =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate();

  if (sameDay) {
    return value.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  return value.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

const DialogCard: React.FC<DialogCardProps> = ({
  chat,
  index,
  isActive,
  aiToggleDialogId,
  canDeleteDialog,
  statusBadge,
  onOpenChat,
  onToggleAi,
  onToggleFavorite,
  onDeleteRequest,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.dialog-card__kebab') || target.closest('.dialog-card__menu') || target.closest('button')) {
      return;
    }
    onOpenChat(chat);
  }, [chat, onOpenChat]);

  const handleToggleMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!menuOpen && kebabRef.current) {
      const rect = kebabRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setFlipUp(spaceBelow < 160);
    }
    setMenuOpen((prev) => !prev);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const isAiToggling = aiToggleDialogId === chat.dialogId;
  const previewPrefix = (() => {
    if (!chat.lastMessageText) return null;
    if (chat.lastMessageDirection === 'outgoing') return sanitizeAuthorLabel(chat.lastMessageAuthor) ?? '\u0412\u044b';
    return sanitizeAuthorLabel(chat.lastMessageAuthor) ?? '\u041a\u043b\u0438\u0435\u043d\u0442';
  })();
  const previewText = chat.lastMessageText ? `${previewPrefix ? `${previewPrefix}: ` : ''}${chat.lastMessageText}` : '\u041d\u0435\u0442 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439';

  const isClosed = Boolean(chat.dialogClosedAt);
  const avatarBg = getAvatarColor(chat.title || chat.username || '\u041a\u043b\u0438\u0435\u043d\u0442');
  const contextTags = [
    chat.sectionTitle ? { label: chat.sectionTitle, className: 'dialog-card__tag dialog-card__tag--neutral' } : null,
    chat.bin ? { label: `BIN ${chat.bin}`, className: 'dialog-card__tag dialog-card__tag--neutral' } : null,
  ].filter(Boolean) as Array<{ label: string; className: string }>;

  return (
    <div
      className={`dialog-card dialog-card--clickable dialog-card--minimal ${isActive ? 'dialog-card--active' : ''} ${menuOpen ? 'dialog-card--menu-open' : ''}`}
      style={{ '--card-index': index, '--avatar-bg': avatarBg } as React.CSSProperties}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenChat(chat);
        }
      }}
    >
      <div className="dialog-card__minimal-shell">
        <div className="dialog-card__minimal-avatar">{getAvatarLabel(chat)}</div>

        <div className="dialog-card__minimal-body">
          <div className="dialog-card__minimal-top">
            <div className="dialog-card__minimal-heading">
              <h3 className="dialog-card__minimal-title">{chat.title}</h3>
            </div>

            <div className="dialog-card__minimal-actions">
              <button
                type="button"
                className={`dialog-card__favorite-btn ${chat.isFavorite ? 'dialog-card__favorite-btn--active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(chat.dialogId, chat.isFavorite);
                }}
                aria-label={chat.isFavorite ? '\u0423\u0431\u0440\u0430\u0442\u044c \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e' : '\u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'}
                title={chat.isFavorite ? '\u0423\u0431\u0440\u0430\u0442\u044c \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e' : '\u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'}
              >
                <svg viewBox="0 0 24 24" fill={chat.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}>
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              <span className="dialog-card__minimal-time">{formatDialogTimestamp(chat.updatedAt)}</span>
              {chat.unreadCount > 0 && <span className="dialog-card__minimal-unread">{chat.unreadCount}</span>}
              <div className="dialog-card__kebab-wrap" ref={menuRef}>
                <button
                  type="button"
                  className="dialog-card__kebab"
                  ref={kebabRef}
                  onClick={handleToggleMenu}
                  aria-label="\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f"
                  title="\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="8" cy="3" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="8" cy="13" r="1.5" />
                  </svg>
                </button>

                {menuOpen && (
                  <div className={`dialog-card__menu ${flipUp ? 'dialog-card__menu--up' : ''}`}>
                    <button
                      type="button"
                      className="dialog-card__menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(chat.dialogId, chat.isFavorite);
                        setMenuOpen(false);
                      }}
                    >
                      <span className="dialog-card__menu-icon">{chat.isFavorite ? '\u2605' : '\u2606'}</span>
                      {chat.isFavorite ? '\u0423\u0431\u0440\u0430\u0442\u044c \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e' : '\u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'}
                    </button>
                    <button
                      type="button"
                      className="dialog-card__menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleAi(chat);
                        setMenuOpen(false);
                      }}
                      disabled={isAiToggling}
                    >
                      <span className="dialog-card__menu-icon">\uD83E\uDD16</span>
                      {isAiToggling ? '\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c...' : chat.aiEnabled ? '\u041e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c AI' : '\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c AI'}
                    </button>
                    <button
                      type="button"
                      className="dialog-card__menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        statusBadge.onClick();
                        setMenuOpen(false);
                      }}
                      disabled={!statusBadge.canClick}
                    >
                      <span className="dialog-card__menu-icon">{chat.dialogClosedAt ? '\uD83D\uDD13' : '\uD83D\uDD12'}</span>
                      {chat.dialogClosedAt ? '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433' : '\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433'}
                    </button>
                    {canDeleteDialog && (
                      <button
                        type="button"
                        className="dialog-card__menu-item dialog-card__menu-item--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteRequest(chat);
                          setMenuOpen(false);
                        }}
                      >
                        <span className="dialog-card__menu-icon">\uD83D\uDDD1\uFE0F</span>
                        \u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="dialog-card__minimal-preview" title={chat.lastMessageText ?? undefined}>{previewText}</p>
          <div className="dialog-card__tags">
            <span className={`dialog-card__tag ${isClosed ? 'dialog-card__tag--closed' : 'dialog-card__tag--open'}`}>
              {isClosed ? '\u0417\u0430\u043a\u0440\u044b\u0442' : '\u041e\u0442\u043a\u0440\u044b\u0442'}
            </span>
            <span className={`dialog-card__tag ${chat.aiEnabled ? 'dialog-card__tag--ai-on' : 'dialog-card__tag--ai-off'}`}>
              AI
            </span>
            {contextTags.map((tag) => (
              <span key={tag.label} className={tag.className}>{tag.label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DialogCard;
