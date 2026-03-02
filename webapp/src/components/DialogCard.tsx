import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatSummary } from '../types';
import { formatDateTime } from '../utils/date';
import StarButton from './StarButton';

interface StatusBadgeInfo {
    className: string;
    label: string;
    canClick: boolean;
    onClick: () => void;
    title: string;
}

interface DialogCardProps {
    chat: ChatSummary;
    index: number;
    aiToggleDialogId: number | null;
    canDeleteDialog: boolean;
    statusBadge: StatusBadgeInfo;
    onOpenChat: (chat: ChatSummary) => void;
    onToggleAi: (chat: ChatSummary) => void;
    onToggleFavorite: (dialogId: number, currentIsFavorite: boolean) => void;
    onDeleteRequest: (chat: ChatSummary) => void;
}

const DialogCard: React.FC<DialogCardProps> = ({
    chat,
    index,
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
        // Don't open chat if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (target.closest('.dialog-card__kebab') || target.closest('.dialog-card__menu') || target.closest('.star') || target.closest('button')) {
            return;
        }
        onOpenChat(chat);
    }, [chat, onOpenChat]);

    const handleToggleMenu = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!menuOpen && kebabRef.current) {
            const rect = kebabRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            // Menu is roughly 140px tall (3 items ~46px each + padding)
            setFlipUp(spaceBelow < 160);
        }
        setMenuOpen(prev => !prev);
    }, [menuOpen]);

    // Close menu on outside click
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

    return (
        <div
            className={`dialog-card dialog-card--clickable ${menuOpen ? 'dialog-card--menu-open' : ''}`}
            style={{ '--card-index': index } as React.CSSProperties}
            onClick={handleCardClick}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') onOpenChat(chat); }}
        >
            {/* Row 1: Name + status badges + star + kebab */}
            <div className="dialog-card__top">
                <div className="dialog-card__identity">
                    <h3 className="dialog-card__name">{chat.title}</h3>
                    {chat.unreadCount > 0 && (
                        <span className="unread-badge" title="Есть непрочитанные сообщения">
                            <span className="unread-badge__dot" />
                            {chat.unreadCount}
                        </span>
                    )}
                    <span className={statusBadge.className}>{statusBadge.label}</span>
                    <span className={`dialog-card__chip--inline ${chat.aiEnabled ? 'dialog-card__chip--ai-on' : 'dialog-card__chip--ai-off'}`}>
                        AI: {chat.aiEnabled ? 'вкл' : 'откл'}
                    </span>
                </div>

                <div className="dialog-card__controls">
                    <StarButton
                        active={Boolean(chat.isFavorite)}
                        onToggle={() => onToggleFavorite(chat.dialogId, chat.isFavorite)}
                        title={chat.isFavorite ? "Убрать из избранного" : "В избранное"}
                    />
                    <div className="dialog-card__kebab-wrap" ref={menuRef}>
                        <button
                            type="button"
                            className="dialog-card__kebab"
                            ref={kebabRef}
                            onClick={handleToggleMenu}
                            aria-label="Действия"
                            title="Действия"
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
                                        onToggleAi(chat);
                                        setMenuOpen(false);
                                    }}
                                    disabled={isAiToggling}
                                >
                                    <span className="dialog-card__menu-icon">🤖</span>
                                    {isAiToggling
                                        ? 'Сохраняем...'
                                        : chat.aiEnabled
                                            ? 'Отключить AI'
                                            : 'Включить AI'}
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
                                    <span className="dialog-card__menu-icon">
                                        {chat.dialogClosedAt ? '🔓' : '🔒'}
                                    </span>
                                    {chat.dialogClosedAt ? 'Открыть диалог' : 'Закрыть диалог'}
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
                                        <span className="dialog-card__menu-icon">🗑️</span>
                                        Удалить диалог
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Row 2: Section / BIN chips */}
            <div className="dialog-card__chips">
                {chat.sectionTitle && <span className="dialog-card__chip">{chat.sectionTitle}</span>}
                {chat.bin && <span className="dialog-card__chip">БИН: {chat.bin}</span>}
            </div>
        </div>
    );
};

export default DialogCard;
