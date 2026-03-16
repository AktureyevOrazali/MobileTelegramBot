import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { Attachment, ChatSummary, Message, ReplyTemplate, UploadMediaResponse } from '../types';
import { extractErrorMessage } from '../utils/errors';
import { sanitizeMessageText, sanitizeUiText } from '../utils/text';

interface InlineChatPanelProps {
  apiClient: ApiClient;
  chat: ChatSummary | null;
  onToggleAi: (chat: ChatSummary) => void;
  onToggleStatus: (chat: ChatSummary) => void;
}

const getAvatarLabel = (chat: ChatSummary): string => {
  const base = chat.title?.trim() || chat.username?.trim() || 'Клиент';
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

const formatMessageTime = (value: Date): string => value.toLocaleTimeString('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

const hasVisibleText = (value: string): boolean => value.trim().length > 0;

const formatMessageDay = (value: Date): string => {
  const now = new Date();
  const sameDay =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate();

  if (sameDay) {
    return 'Сегодня';
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === value.getFullYear() &&
    yesterday.getMonth() === value.getMonth() &&
    yesterday.getDate() === value.getDate();

  if (isYesterday) {
    return 'Вчера';
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
          Открыть видео
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

const InlineChatPanel: React.FC<InlineChatPanelProps> = ({ apiClient, chat, onToggleAi, onToggleStatus }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const [pendingUploads, setPendingUploads] = useState<UploadMediaResponse[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canReply = Boolean(apiClient.currentUser?.canReply);
  const isClosed = Boolean(chat?.dialogClosedAt);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollHeight;
    if (smooth) {
      el.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollTop = top;
    }
  }, []);

  const autosize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  const loadMessages = useCallback(async () => {
    if (!chat) {
      setMessages([]);
      return;
    }
    try {
      setLoading(true);
      const data = await apiClient.fetchMessages(chat.chatId, 200, chat.dialogId);
      setMessages(data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось загрузить сообщения.'));
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }, [apiClient, chat, scrollToBottom]);

  useEffect(() => {
    setInput('');
    setTemplates([]);
    setPendingUploads([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!chat || !canReply) return;
    apiClient.fetchReplyTemplates(chat.section).then(setTemplates).catch(() => setTemplates([]));
  }, [apiClient, chat, canReply]);

  useEffect(() => {
    const id = requestAnimationFrame(() => scrollToBottom(true));
    return () => cancelAnimationFrame(id);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (taRef.current) autosize(taRef.current);
  }, [autosize, input]);

  useEffect(() => {
    if (!chat) {
      return undefined;
    }
    const cleanup = apiClient.connectToStream({
      onMessage: (messageRaw) => {
        if (messageRaw.chat_id !== chat.chatId) {
          return;
        }
        if (typeof messageRaw.dialog_id === 'number' && messageRaw.dialog_id !== chat.dialogId) {
          return;
        }
        void loadMessages();
      },
    });
    return cleanup;
  }, [apiClient, chat, loadMessages]);

  const handlePresetClick = useCallback((text: string) => {
    setInput(text);
    if (taRef.current) {
      taRef.current.focus();
      requestAnimationFrame(() => autosize(taRef.current!));
    }
  }, [autosize]);

  const handleRemoveUpload = useCallback((mediaId: number) => {
    setPendingUploads((current) => current.filter((item) => item.mediaId !== mediaId));
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
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
      setError(extractErrorMessage(err, 'Не удалось загрузить файл.'));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }, [apiClient]);

  const handleSend = useCallback(async () => {
    if (!chat) return;
    const trimmed = input.trim();
    const attachmentIds = pendingUploads.map((item) => item.mediaId);
    if (!trimmed && attachmentIds.length === 0) return;
    setSending(true);
    try {
      await apiClient.sendMessage(chat.chatId, trimmed, chat.dialogId, attachmentIds);
      setInput('');
      setPendingUploads([]);
      await loadMessages();
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось отправить сообщение.'));
    } finally {
      setSending(false);
    }
  }, [apiClient, chat, input, loadMessages, pendingUploads, scrollToBottom]);

  const chatMeta = useMemo(() => {
    if (!chat) return '';
    const parts = [
      chat.username ? `@${chat.username}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
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
            <span className="chat-inline__empty-label">Диалоги</span>
            <h3>Выберите диалог</h3>
            <p>Откройте чат слева, чтобы здесь появилась переписка и поле ответа.</p>
          </div>
        </div>
      </section>
    );
  }

  const canSubmit = canReply && !sending && !uploading && (input.trim().length > 0 || pendingUploads.length > 0);

  return (
    <section className="dialogs-side-card chat-inline chat-inline--minimal" style={{ '--avatar-bg': getAvatarColor(chat.title || chat.username || 'Клиент') } as React.CSSProperties}>
      <header className="chat-inline__minimal-header">
        <div className="chat-inline__minimal-main">
          <div className="chat-inline__minimal-avatar">{getAvatarLabel(chat)}</div>
          <div className="chat-inline__minimal-copy">
            <h3 className="chat-inline__minimal-title">{chat.title}</h3>
            <p className="chat-inline__minimal-meta">{chatMeta}</p>
            <div className="chat-inline__status-chips">
              <span className={`chat-inline__status-chip ${isClosed ? 'chat-inline__status-chip--closed' : 'chat-inline__status-chip--open'}`}>
                {isClosed ? 'Закрыт' : 'Открыт'}
              </span>
              {chat.sectionTitle && <span className="chat-inline__status-chip chat-inline__status-chip--neutral">{chat.sectionTitle}</span>}
              {chat.bin && <span className="chat-inline__status-chip chat-inline__status-chip--neutral">БИН {chat.bin}</span>}
            </div>
          </div>
        </div>

        <div className="chat-inline__minimal-actions">
          <button type="button" className={`chat-inline__minimal-button ${chat.aiEnabled ? 'chat-inline__minimal-button--ai-on' : 'chat-inline__minimal-button--ai-off'}`} onClick={() => onToggleAi(chat)}>
            {chat.aiEnabled ? 'AI: вкл' : 'AI: выкл'}
          </button>
          {canReply ? (
            <button type="button" className={`chat-inline__minimal-button ${isClosed ? 'chat-inline__minimal-button--primary' : 'chat-inline__minimal-button--danger'}`} onClick={() => onToggleStatus(chat)}>
              {isClosed ? 'Открыть' : 'Закрыть'}
            </button>
          ) : null}
        </div>
      </header>

      {error && <div className="alert chat-inline__alert">{error}</div>}

      <div className="chat-inline__scroll chat-inline__scroll--minimal" ref={scrollRef}>
        {loading ? (
          <div className="chat-inline__loading">Загружаем сообщения...</div>
        ) : messages.length === 0 ? (
          <div className="chat-inline__placeholder">В этом диалоге пока нет сообщений.</div>
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
                ? (authorName || 'Клиент')
                : authorName && authorName !== currentUserName
                  ? authorName
                  : 'Вы';

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
          {templates.slice(0, 3).map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="preset-reply"
              onClick={() => handlePresetClick(tpl.text)}
              title={tpl.text}
            >
              {tpl.title}
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
                ×
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
          ref={taRef}
          className="textarea chat-inline__textarea"
          placeholder={canReply ? 'Введите сообщение' : 'У вашей роли нет прав для ответа.'}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (taRef.current) autosize(taRef.current);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
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
            title="Прикрепить файл"
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
    if (!url) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div className="image-full-modal" onClick={onClose}>
      <div className="image-full-modal__content" onClick={(e) => e.stopPropagation()}>
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




