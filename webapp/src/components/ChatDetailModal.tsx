import React, { useCallback } from 'react';

import { ApiClient } from '../api/ApiClient';
import { ChatSummary } from '../types';
import { useChatConversation } from '../hooks/useChatConversation';
import { formatDateTime } from '../utils/date';
import DataLoadingState from './DataLoadingState';
import Modal from './Modal';

interface ChatDetailModalProps {
  apiClient: ApiClient;
  chat: ChatSummary;
  onToggleStatus: (chat: ChatSummary) => void;
  onClose: () => void;
}

const TEXT = {
  binPrefix: 'БИН:',
  close: 'Закрыть',
  closed: 'Закрыт',
  empty: 'Нет сообщений в этом диалоге.',
  loading: 'Загружаем сообщения...',
  noReplyRights: 'У вашей роли нет прав для ответа.',
  open: 'Открыт',
  openDialog: 'Открыть диалог',
  replyPlaceholder: 'Ваш ответ клиенту…',
  sectionPrefix: 'Раздел:',
  send: 'Отправить',
  sending: 'Отправляем…',
  started: 'Начат:',
  updated: 'Обновлён:',
};

const ChatDetailModal: React.FC<ChatDetailModalProps> = ({
  apiClient,
  chat,
  onToggleStatus,
  onClose,
}) => {
  const {
    autosizeTextarea,
    canReply,
    error,
    handlePresetClick,
    input,
    loading,
    messages,
    scrollRef,
    sendMessage,
    sending,
    setInput,
    templates,
    textareaRef,
  } = useChatConversation({ apiClient, chat });

  const isClosed = Boolean(chat.dialogClosedAt);
  const statusLabel = isClosed ? TEXT.closed : TEXT.open;
  const statusClassName = `status-badge ${isClosed ? 'status-badge--closed' : 'status-badge--open'}`;
  const statusBadge = canReply ? (
    <button
      type="button"
      className={`${statusClassName} status-badge-btn status-badge--clickable`}
      onClick={() => onToggleStatus(chat)}
      title={isClosed ? TEXT.openDialog : TEXT.close}
    >
      {statusLabel}
    </button>
  ) : (
    <span className={statusClassName}>{statusLabel}</span>
  );

  const handleSend = useCallback(async () => {
    await sendMessage();
  }, [sendMessage]);

  return (
    <Modal open onClose={onClose} className="modal--dialog">
      <div className="modal__content">
        <button className="modal__close" type="button" aria-label={TEXT.close} onClick={onClose} title={TEXT.close}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.41Z" fill="currentColor" />
          </svg>
        </button>
        <div className="modal__header-row">
          <div>
            <h2 className="heading">{chat.title}</h2>
            <div className="dialog-status-row" style={{ marginTop: 4 }}>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                {chat.username ? `@${chat.username}` : chat.type}
              </span>
              {statusBadge}
            </div>
            <div className="dialog-meta" style={{ marginTop: 8 }}>
              {chat.sectionTitle && <span className="dialog-card__chip">{TEXT.sectionPrefix} {chat.sectionTitle}</span>}
              {chat.bin && <span className="dialog-card__chip">{TEXT.binPrefix} {chat.bin}</span>}
              <span className="dialog-card__chip">{TEXT.started} {formatDateTime(chat.dialogStartedAt)}</span>
              <span className="dialog-card__chip">{TEXT.updated} {formatDateTime(chat.updatedAt)}</span>
            </div>
          </div>
        </div>

        {error && <div className="alert" style={{ marginTop: 8 }}>{error}</div>}

        <div className="modal__scroll" ref={scrollRef}>
          {loading ? (
            <DataLoadingState
              className="chat-modal-loading-state"
              title={TEXT.loading}
              skeletonRows={7}
              variant="chat"
            />
          ) : (
            <div className="message-list">
              {messages.length === 0 && <div className="text-muted">{TEXT.empty}</div>}
              {messages.map((message) => (
                <div key={message.id} className={`message-bubble ${message.direction}`}>
                  {message.author && <div className="message-bubble__author">{message.author}</div>}
                  <div className="message-bubble__text">{message.text}</div>
                  <div className="message-bubble__time">{formatDateTime(message.createdAt)}</div>
                  {message.sectionTitle && (
                    <div className="message-bubble__section">{TEXT.sectionPrefix} {message.sectionTitle}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="separator" />

        {canReply && templates.length > 0 && (
          <div className="preset-replies">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="preset-reply"
                onClick={() => handlePresetClick(template.text)}
                title={template.text}
              >
                {template.title}
              </button>
            ))}
          </div>
        )}
        <div className="dialog-composer">
          <textarea
            ref={textareaRef}
            className="textarea"
            placeholder={canReply ? TEXT.replyPlaceholder : TEXT.noReplyRights}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (textareaRef.current) {
                autosizeTextarea(textareaRef.current);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            disabled={!canReply || sending}
            rows={1}
          />
          <div className="dialog-composer__actions">
            <button className="button" type="button" onClick={() => void handleSend()} disabled={!canReply || sending || !input.trim()}>
              {sending ? TEXT.sending : TEXT.send}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default ChatDetailModal;
