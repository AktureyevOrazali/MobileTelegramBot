import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { ChatSummary, Message } from '../types';
import { formatDateTime } from '../utils/date';
import { extractErrorMessage } from '../utils/errors';
import Modal from './Modal';

const PRESET_MESSAGES = [
    'Здравствуйте! Чем я могу вам помочь?',
    'Спасибо за обращение! Готовы помочь в любое время!',
];

interface ChatDetailModalProps {
    apiClient: ApiClient;
    chat: ChatSummary;
    onToggleStatus: (chat: ChatSummary) => void;
    onClose: () => void;
}

const ChatDetailModal: React.FC<ChatDetailModalProps> = ({
    apiClient,
    chat,
    onToggleStatus,
    onClose,
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);

    // ВАЖНО: реф именно на прокручиваемый контейнер (modal__scroll), а не на внутренний список
    const scrollRef = useRef<HTMLDivElement>(null);
    const lastCountRef = useRef<number>(0);
    const taRef = useRef<HTMLTextAreaElement | null>(null);

    const currentUser = apiClient.currentUser;
    const canReply = Boolean(currentUser?.canReply);
    const isClosed = Boolean(chat.dialogClosedAt);
    const statusLabel = isClosed ? 'Закрыт' : 'Открыт';
    const statusClassName = `status-badge ${isClosed ? 'status-badge--closed' : 'status-badge--open'}`;
    const statusBadge = canReply ? (
        <button
            type="button"
            className={`${statusClassName} status-badge-btn status-badge--clickable`}
            onClick={() => onToggleStatus(chat)}
            title={isClosed ? 'Открыть диалог' : 'Закрыть диалог'}
        >
            {statusLabel}
        </button>
    ) : (
        <span className={statusClassName}>{statusLabel}</span>
    );

    const scrollToBottom = useCallback((smooth = false) => {
        const el = scrollRef.current;
        if (!el) return;
        const top = el.scrollHeight;
        if (smooth) el.scrollTo({ top, behavior: 'smooth' });
        else el.scrollTop = top;
    }, []);

    const autosize = useCallback((el: HTMLTextAreaElement) => {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 176) + 'px';
    }, []);

    const loadMessages = useCallback(async () => {
        try {
            setLoading(true);
            const data = await apiClient.fetchMessages(chat.chatId, 200, chat.dialogId);
            setMessages(data);
            lastCountRef.current = data.length;
            setError(null);
        } catch (err) {
            setError(extractErrorMessage(err, 'Не удалось загрузить сообщения.'));
        } finally {
            setLoading(false);
            // после первой подгрузки — сразу в самый низ
            requestAnimationFrame(() => scrollToBottom(false));
        }
    }, [apiClient, chat.chatId, chat.dialogId, scrollToBottom]);

    useEffect(() => { loadMessages(); }, [loadMessages]);

    // каждый раз при изменении массива сообщений — опускаем вниз (плавно)
    useEffect(() => {
        // небольшой кадр для корректной высоты после рендера
        const id = requestAnimationFrame(() => scrollToBottom(true));
        return () => cancelAnimationFrame(id);
    }, [messages, scrollToBottom]);

    // фоновая подтяжка новых сообщений
    useEffect(() => {
        let cancelled = false;
        const id = window.setInterval(async () => {
            try {
                const data = await apiClient.fetchMessages(chat.chatId, 200, chat.dialogId);
                if (!cancelled && data.length !== lastCountRef.current) {
                    setMessages(data);
                    lastCountRef.current = data.length;
                    // прокрутка произойдёт через useEffect([messages])
                }
            } catch { /* ignore */ }
        }, 1500);
        return () => { cancelled = true; window.clearInterval(id); };
    }, [apiClient, chat.chatId, chat.dialogId]);

    useEffect(() => {
        if (taRef.current) autosize(taRef.current);
    }, [input, autosize]);

    const handlePresetClick = useCallback(
        (text: string) => {
            setInput(text);
            if (taRef.current) {
                taRef.current.focus();
                requestAnimationFrame(() => autosize(taRef.current!));
            }
        },
        [autosize],
    );

    const handleSend = async () => {
        if (!input.trim()) return;
        setSending(true);
        try {
            await apiClient.sendMessage(chat.chatId, input.trim(), chat.dialogId);
            setInput('');
            await loadMessages();           // загрузим актуальный список
            requestAnimationFrame(() => scrollToBottom(true)); // и прокрутим
        } catch (err) {
            setError(extractErrorMessage(err, 'Не удалось отправить сообщение.'));
        } finally {
            setSending(false);
        }
    };

    return (
        <Modal open onClose={onClose} className="modal--dialog">
            <div className="modal__content">
                <button className="modal__close" type="button" aria-label="Закрыть" onClick={onClose} title="Закрыть">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.41Z" fill="currentColor" />
                    </svg>
                </button>
                {/* Header */}
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
                            {chat.sectionTitle && <span className="dialog-card__chip">Раздел: {chat.sectionTitle}</span>}
                            {chat.bin && <span className="dialog-card__chip">БИН: {chat.bin}</span>}
                            <span className="dialog-card__chip">Начат: {formatDateTime(chat.dialogStartedAt)}</span>
                            <span className="dialog-card__chip">Обновлён: {formatDateTime(chat.updatedAt)}</span>
                        </div>
                    </div>
                </div>

                {error && <div className="alert" style={{ marginTop: 8 }}>{error}</div>}

                {/* ПРОКРУЧИВАЕМЫЙ контейнер */}
                <div className="modal__scroll" ref={scrollRef}>
                    {loading ? (
                        <div style={{ padding: '24px 0', textAlign: 'center' }}>Загружаем сообщения...</div>
                    ) : (
                        <div className="message-list">
                            {messages.length === 0 && <div className="text-muted">Нет сообщений в этом диалоге.</div>}
                            {messages.map((message) => (
                                <div
                                    key={message.id}
                                    className={`message-bubble ${message.direction}`}
                                >
                                    {message.author && <div className="message-bubble__author">{message.author}</div>}
                                    <div className="message-bubble__text">{message.text}</div>
                                    <div className="message-bubble__time">{formatDateTime(message.createdAt)}</div>
                                    {message.sectionTitle && (
                                        <div className="message-bubble__section">Раздел: {message.sectionTitle}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="separator" />

                {/* Composer */}
                {canReply && (
                    <div className="preset-replies">
                        {PRESET_MESSAGES.map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                className="preset-reply"
                                onClick={() => handlePresetClick(preset)}
                            >
                                {preset}
                            </button>
                        ))}
                    </div>
                )}
                <div className="dialog-composer">
                    <textarea
                        ref={taRef}
                        className="textarea"
                        placeholder={canReply ? 'Ваш ответ клиенту…' : 'У вашей роли нет прав для ответа.'}
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            if (taRef.current) autosize(taRef.current);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        disabled={!canReply || sending}
                        rows={1}
                    />
                    <div className="dialog-composer__actions">
                        <button className="button" type="button" onClick={handleSend} disabled={!canReply || sending || !input.trim()}>
                            {sending ? 'Отправляем…' : 'Отправить'}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default ChatDetailModal;
