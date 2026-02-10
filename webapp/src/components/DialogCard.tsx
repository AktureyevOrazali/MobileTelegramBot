import React from 'react';
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
}) => (
    <div
        className="dialog-card"
        style={{ '--card-index': index } as React.CSSProperties}
    >
        <div className="dialog-card__header">
            <div className="dialog-card__info">
                <div className="dialog-card__title-row">
                    <h3>{chat.title}</h3>
                    {chat.unreadCount > 0 && (
                        <span className="unread-badge" title="Есть непрочитанные сообщения">
                            <span className="unread-badge__dot" />
                            {chat.unreadCount}
                        </span>
                    )}
                    <StarButton
                        active={Boolean(chat.isFavorite)}
                        onToggle={() => onToggleFavorite(chat.dialogId, chat.isFavorite)}
                        title={chat.isFavorite ? "Убрать из избранного" : "В избранное"}
                    />
                </div>
                <div className="dialog-status-row">
                    <span className="text-muted">
                        {chat.username ? `@${chat.username}` : chat.type}
                    </span>
                    {statusBadge.canClick ? (
                        <button
                            type="button"
                            className={`${statusBadge.className} status-badge-btn status-badge--clickable`}
                            onClick={statusBadge.onClick}
                            title={statusBadge.title}
                        >
                            {statusBadge.label}
                        </button>
                    ) : (
                        <span className={statusBadge.className}>{statusBadge.label}</span>
                    )}
                    <span className="dialog-card__date">{formatDateTime(chat.updatedAt)}</span>
                </div>
                <div className="dialog-card__chips">
                    {chat.sectionTitle && <span className="dialog-card__chip">{chat.sectionTitle}</span>}
                    {chat.bin && <span className="dialog-card__chip">БИН: {chat.bin}</span>}
                    <span className={`dialog-card__chip ${chat.aiEnabled ? 'dialog-card__chip--ai-on' : 'dialog-card__chip--ai-off'}`}>
                        AI: {chat.aiEnabled ? 'включён' : 'отключён'}
                    </span>
                </div>
            </div>

            <div className="dialog-card__actions">
                <button
                    className="button"
                    type="button"
                    onClick={() => onToggleAi(chat)}
                    disabled={aiToggleDialogId === chat.dialogId}
                >
                    {aiToggleDialogId === chat.dialogId
                        ? 'Сохраняем...'
                        : chat.aiEnabled
                            ? 'Отключить AI'
                            : 'Включить AI'}
                </button>
                <button
                    className="button"
                    type="button"
                    onClick={() => onOpenChat(chat)}
                >
                    Открыть диалог
                </button>
                {canDeleteDialog && (
                    <button className="button danger" type="button" onClick={() => onDeleteRequest(chat)}>
                        ✖
                    </button>
                )}
            </div>
        </div>
    </div>
);

export default DialogCard;
