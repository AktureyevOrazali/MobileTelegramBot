import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClient } from '../api/ApiClient';
import { Attachment, ChatSummary, EmployeeClientAssessmentSubmitPayload, Message, UploadMediaResponse } from '../types';
import { useChatConversation } from '../hooks/useChatConversation';
import { extractErrorMessage } from '../utils/errors';
import { getChatAvatarGradient, getChatAvatarLabel } from '../utils/chatParticipantAvatar';
import { sanitizeMessageText, sanitizeUiText } from '../utils/text';
import EmployeeClientAssessmentCard from './EmployeeClientAssessmentCard';

interface InlineChatPanelProps {
  apiClient: ApiClient;
  chat: ChatSummary | null;
  onToggleAi: (chat: ChatSummary) => void;
  onToggleStatus: (chat: ChatSummary) => void;
  assessmentSubmittingId: number | null;
  onAssessmentSubmit: (assessmentId: number, payload: EmployeeClientAssessmentSubmitPayload) => Promise<void>;
}

const TEXT = {
  aiOff: 'AI: выкл',
  aiOn: 'AI: вкл',
  attachTitle: 'Прикрепить файл',
  binShort: 'БИН',
  chooseDialog: 'Выберите диалог',
  client: 'Клиент',
  closed: 'Закрыт',
  close: 'Закрыть',
  dialogs: 'Диалоги',
  emptyDescription: 'Откройте чат слева, чтобы здесь появилась переписка и поле ответа.',
  emptyMessages: 'В этом диалоге пока нет сообщений.',
  inputPlaceholder: 'Введите сообщение',
  loading: 'Загружаем сообщения...',
  metaSeparator: ' · ',
  noReplyRights: 'У вашей роли нет прав для ответа.',
  open: 'Открыт',
  openButton: 'Открыть',
  openVideo: 'Открыть видео',
  removeSymbol: '×',
  today: 'Сегодня',
  uploadError: 'Не удалось загрузить файл.',
  yesterday: 'Вчера',
  you: 'Вы',
};

const formatMessageTime = (value: Date): string => value.toLocaleTimeString('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

const formatMessageDay = (value: Date): string => {
  const now = new Date();
  const sameDay =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate();

  if (sameDay) {
    return TEXT.today;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === value.getFullYear() &&
    yesterday.getMonth() === value.getMonth() &&
    yesterday.getDate() === value.getDate();

  if (isYesterday) {
    return TEXT.yesterday;
  }

  return value.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
};

const MessageAttachmentView: React.FC<{ attachment: Attachment; onImageClick: (url: string) => void; onLoad: () => void }> = ({ attachment, onImageClick, onLoad }) => {
  const [failed, setFailed] = useState(false);

  if (attachment.kind === 'image' && !failed) {
    return (
      <div className="message-attachment message-attachment--image" onClick={() => onImageClick(attachment.url)}>
        <img
          className="message-attachment__image"
          src={attachment.previewUrl || attachment.url}
          alt={attachment.originalName}
          loading="lazy"
          onLoad={onLoad}
          onError={() => setFailed(true)}
          style={{ cursor: 'pointer' }}
        />
      </div>
    );
  }

  if (attachment.kind === 'video' && !failed) {
    return (
      <div className="message-attachment message-attachment--video">
        <video className="message-attachment__video" controls preload="metadata" onError={() => setFailed(true)}>
          <source src={attachment.url} type={attachment.mimeType} />
        </video>
        <a className="message-attachment__link" href={attachment.url} target="_blank" rel="noreferrer">
          {TEXT.openVideo}
        </a>
      </div>
    );
  }

  return (
    <a className="message-attachment__link" href={attachment.url} target="_blank" rel="noreferrer">
      {attachment.originalName}
    </a>
  );
};

const InlineChatPanel: React.FC<InlineChatPanelProps> = ({ apiClient, chat, onToggleAi, onToggleStatus, assessmentSubmittingId, onAssessmentSubmit }) => {
  const {
    autosizeTextarea,
    canReply,
    error,
    handlePresetClick,
    input,
    loading,
    messages,
    scrollRef,
    scrollToBottom,
    sendMessage,
    sending,
    setError,
    setInput,
    templates,
    textareaRef,
  } = useChatConversation({
    apiClient,
    chat,
    maxTextareaHeight: 140,
  });

  const [uploading, setUploading] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<UploadMediaResponse[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isClosed = Boolean(chat?.dialogClosedAt);

  useEffect(() => {
    setPendingUploads([]);
    setPreviewImageUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [chat?.chatId, chat?.dialogId]);

  const handleRemoveUpload = useCallback((mediaId: number) => {
    setPendingUploads((current) => current.filter((item) => item.mediaId !== mediaId));
  }, []);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    setUploading(true);
    try {
      const uploaded: UploadMediaResponse[] = [];
      for (const file of files) {
        uploaded.push(await apiClient.uploadMedia(file));
      }
      setPendingUploads((current) => [...current, ...uploaded]);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, TEXT.uploadError));
    } finally {
      setUploading(false);
    }
  }, [apiClient, setError]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    await uploadFiles(files);
    event.target.value = '';
  }, [uploadFiles]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const items = Array.from(event.clipboardData.items);
    const imageFiles: File[] = [];

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      void uploadFiles(imageFiles);
    }
  }, [uploadFiles]);

  const handleSend = useCallback(async () => {
    const attachmentIds = pendingUploads.map((item) => item.mediaId);
    await sendMessage({
      attachmentIds,
      onSent: () => setPendingUploads([]),
    });
  }, [pendingUploads, sendMessage]);

  const chatMeta = useMemo(() => {
    if (!chat) {
      return '';
    }
    const parts = [chat.username ? `@${chat.username}` : null].filter(Boolean);
    return parts.join(TEXT.metaSeparator);
  }, [chat]);

  if (!chat) {
    return (
      <section className="dialogs-side-card chat-inline chat-inline--empty chat-inline--minimal-empty">
        <div className="chat-inline__empty-layout">
          <div className="chat-inline__empty-visual" aria-hidden="true">
            <div className="chat-inline__empty-bubble chat-inline__empty-bubble--large" />
            <div className="chat-inline__empty-bubble chat-inline__empty-bubble--small" />
          </div>
          <div className="chat-inline__empty chat-inline__empty--minimal">
            <span className="chat-inline__empty-label">{TEXT.dialogs}</span>
            <h3>{TEXT.chooseDialog}</h3>
            <p>{TEXT.emptyDescription}</p>
          </div>
        </div>
      </section>
    );
  }

  const showEmployeeAssessment = Boolean(chat?.dialogClosedAt && chat?.employeeAssessmentPending && chat?.employeeAssessmentId);
  const canSubmit = !showEmployeeAssessment && canReply && !sending && !uploading && (input.trim().length > 0 || pendingUploads.length > 0);

  if (showEmployeeAssessment) {
    return (
      <section className="dialogs-side-card chat-inline chat-inline--minimal chat-inline--assessment-screen" style={{ '--avatar-bg': getChatAvatarGradient(chat) } as React.CSSProperties}>
        <EmployeeClientAssessmentCard
          chat={chat}
          isSubmitting={assessmentSubmittingId === chat.employeeAssessmentId}
          onSubmit={onAssessmentSubmit}
        />
      </section>
    );
  }

  return (
    <section className="dialogs-side-card chat-inline chat-inline--minimal" style={{ '--avatar-bg': getChatAvatarGradient(chat) } as React.CSSProperties}>
      <header className="chat-inline__minimal-header">
        <div className="chat-inline__minimal-main">
          <div className="chat-inline__minimal-avatar">{getChatAvatarLabel(chat)}</div>
          <div className="chat-inline__minimal-copy">
            <h3 className="chat-inline__minimal-title">{chat.title}</h3>
            <p className="chat-inline__minimal-meta">{chatMeta}</p>
            <div className="chat-inline__status-chips">
              <span className={`chat-inline__status-chip ${isClosed ? 'chat-inline__status-chip--closed' : 'chat-inline__status-chip--open'}`}>
                {isClosed ? TEXT.closed : TEXT.open}
              </span>
              {chat.sectionTitle && <span className="chat-inline__status-chip chat-inline__status-chip--neutral">{chat.sectionTitle}</span>}
              {chat.bin && <span className="chat-inline__status-chip chat-inline__status-chip--neutral">{TEXT.binShort} {chat.bin}</span>}
            </div>
          </div>
        </div>

        <div className="chat-inline__minimal-actions">
          <button type="button" className={`chat-inline__minimal-button ${chat.aiEnabled ? 'chat-inline__minimal-button--ai-on' : 'chat-inline__minimal-button--ai-off'}`} onClick={() => onToggleAi(chat)}>
            {chat.aiEnabled ? TEXT.aiOn : TEXT.aiOff}
          </button>
          {canReply ? (
            <button type="button" className={`chat-inline__minimal-button ${isClosed ? 'chat-inline__minimal-button--primary' : 'chat-inline__minimal-button--danger'}`} onClick={() => onToggleStatus(chat)}>
              {isClosed ? TEXT.openButton : TEXT.close}
            </button>
          ) : null}
        </div>
      </header>

      {error && <div className="alert chat-inline__alert">{error}</div>}

      <div className="chat-inline__scroll chat-inline__scroll--minimal" ref={scrollRef}>
        {loading ? (
          <div className="chat-inline__loading">{TEXT.loading}</div>
        ) : messages.length === 0 ? (
          <div className="chat-inline__placeholder">{TEXT.emptyMessages}</div>
        ) : (
          <div className="message-list chat-inline__message-list chat-inline__message-list--minimal">
            {messages.map((message, index) => {
              const previous = index > 0 ? messages[index - 1] : null;
              const currentDay = formatMessageDay(message.createdAt);
              const previousDay = previous ? formatMessageDay(previous.createdAt) : null;
              const showDayDivider = currentDay !== previousDay;
              const authorName = sanitizeUiText(message.author) || null;
              const currentUserName = sanitizeUiText(apiClient.currentUser?.name) || null;
              const visibleMessageText = sanitizeMessageText(message.text)
                ?? (message.attachments.length === 0 ? sanitizeUiText(message.text) : null);
              const hasRenderableText = Boolean(visibleMessageText);
              const authorLabel = message.direction === 'incoming'
                ? (authorName || TEXT.client)
                : authorName && authorName !== currentUserName
                  ? authorName
                  : TEXT.you;

              return (
                <React.Fragment key={message.id}>
                  {showDayDivider && <div className="chat-inline__day-divider"><span>{currentDay}</span></div>}
                  <div className={`chat-inline__bubble-wrap chat-inline__bubble-wrap--${message.direction}`}>
                    <div className="chat-inline__bubble-container">
                      <div className={`message-bubble__head message-bubble__head--${message.direction}`}>
                        <span className="message-bubble__author">{authorLabel}</span>
                      </div>
                      <div className={`message-bubble ${message.direction} ${hasRenderableText ? '' : 'message-bubble--media-only'}`}>
                        {message.attachments.length > 0 && (
                          <div className="message-bubble__attachments">
                            {message.attachments.map((attachment) => (
                              <MessageAttachmentView
                                key={attachment.id}
                                attachment={attachment}
                                onImageClick={(url) => setPreviewImageUrl(url)}
                                onLoad={() => scrollToBottom(true)}
                              />
                            ))}
                          </div>
                        )}
                        {hasRenderableText ? (
                          <div className="message-bubble__body">
                            <div className="message-bubble__text">{visibleMessageText}</div>
                            <span className="message-bubble__time message-bubble__time--inline">{formatMessageTime(message.createdAt)}</span>
                          </div>
                        ) : (
                          <div className="message-bubble__footer">
                            <span className="message-bubble__time message-bubble__time--inline">{formatMessageTime(message.createdAt)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {canReply && templates.length > 0 && (
            <div className="preset-replies chat-inline__presets chat-inline__presets--minimal">
              {templates.slice(0, 3).map((template) => (
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

          {pendingUploads.length > 0 && (
            <div className="chat-inline__pending-list">
              {pendingUploads.map((item) => (
                <div key={item.mediaId} className="chat-inline__pending-item">
                  <span className="chat-inline__pending-name">{item.originalName}</span>
                  <button type="button" className="chat-inline__pending-remove" onClick={() => handleRemoveUpload(item.mediaId)}>
                    {TEXT.removeSymbol}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="dialog-composer chat-inline__composer chat-inline__composer--minimal">
            <input
              ref={fileInputRef}
              className="chat-inline__file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              multiple
              onChange={handleFileChange}
              hidden
            />
            <textarea
              ref={textareaRef}
              className="textarea chat-inline__textarea"
              placeholder={canReply ? TEXT.inputPlaceholder : TEXT.noReplyRights}
              value={input}
              onPaste={handlePaste}
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
              disabled={!canReply || sending || uploading}
              rows={1}
            />
            <div className="dialog-composer__actions chat-inline__composer-actions">
              <button
                type="button"
                className="chat-inline__attach-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canReply || sending || uploading}
                title={TEXT.attachTitle}
              >
                {uploading ? (
                  <span className="chat-inline__uploading-dots">...</span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
              </button>
              <button className="button chat-inline__send chat-inline__send--minimal chat-inline__send--icon" type="button" onClick={() => void handleSend()} disabled={!canSubmit}>
                {sending ? '...' : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m22 2-7 20-4-9-9-4z" />
                    <path d="M22 2 11 13" />
                  </svg>
                )}
              </button>
            </div>
          </div>
      <ImagePreviewModal
        url={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </section>
  );
};

const ImagePreviewModal: React.FC<{ url: string | null; onClose: () => void }> = ({ url, onClose }) => {
  useEffect(() => {
    if (!url) {
      return;
    }
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [url, onClose]);

  if (!url) {
    return null;
  }

  return (
    <div className="image-full-modal" onClick={onClose}>
      <div className="image-full-modal__content" onClick={(event) => event.stopPropagation()}>
        <img src={url} alt="Full screen preview" className="image-full-modal__image" />
        <button type="button" className="image-full-modal__close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default InlineChatPanel;
