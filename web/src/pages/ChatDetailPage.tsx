import { FormEvent, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { ApiError } from '@/api/client';
import { ChatSummary, Message } from '@/api/types';
import { useFeedback } from '@/context/FeedbackContext';
import { useSession } from '@/context/SessionContext';

const ChatDetailPage = () => {
  const { chatId } = useParams<{ chatId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { apiClient, session } = useSession();
  const { showFeedback } = useFeedback();

  const [chat, setChat] = useState<ChatSummary | null>(location.state?.chat ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [isFavorite, setIsFavorite] = useState(location.state?.chat?.isFavorite ?? false);
  const [updatingFavorite, setUpdatingFavorite] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const numericChatId = useMemo(() => Number(chatId), [chatId]);

  useEffect(() => {
    if (!chat && Number.isFinite(numericChatId)) {
      apiClient
        .fetchChats()
        .then((list) => {
          const found = list.find((item) => item.chatId === numericChatId);
          if (found) {
            setChat(found);
            setIsFavorite(found.isFavorite);
          }
        })
        .catch((error) => console.error('Failed to resolve chat', error));
    }
  }, [apiClient, chat, numericChatId]);

  const fetchMessages = useCallback(async () => {
    if (!Number.isFinite(numericChatId)) {
      return;
    }
    try {
      const data = await apiClient.fetchMessages(numericChatId);
      setMessages(data);
      setError(null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось загрузить сообщения';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, numericChatId]);

  useEffect(() => {
    fetchMessages();
    const interval = window.setInterval(fetchMessages, 3000);
    return () => window.clearInterval(interval);
  }, [fetchMessages]);

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!messageText.trim() || !Number.isFinite(numericChatId)) {
      return;
    }
    setSending(true);
      try {
        await apiClient.sendMessage(numericChatId, messageText.trim());
        setMessageText('');
        await fetchMessages();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось отправить сообщение';
      showFeedback(message, { variant: 'error' });
    } finally {
      setSending(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!chat || updatingFavorite) {
      return;
    }
    const nextValue = !isFavorite;
    setIsFavorite(nextValue);
    setUpdatingFavorite(true);
    try {
      await apiClient.setFavorite(chat.chatId, nextValue);
      showFeedback(
        nextValue ? 'Диалог добавлен в избранное' : 'Диалог удалён из избранного',
        { variant: 'success' },
      );
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить избранное';
      showFeedback(message, { variant: 'error' });
      setIsFavorite(!nextValue);
    } finally {
      setUpdatingFavorite(false);
    }
  };

  const handleDeleteChat = async () => {
    if (!chat) {
      return;
    }
    if (!window.confirm(`Переписка с "${chat.title}" будет удалена. Продолжить?`)) {
      return;
    }
    setDeleting(true);
    try {
      await apiClient.deleteChat(chat.chatId);
      showFeedback(`Диалог "${chat.title}" удалён.`, { variant: 'success' });
      navigate('/chats', { replace: true });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось удалить диалог';
      showFeedback(message, { variant: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  if (!Number.isFinite(numericChatId)) {
    return <p>Неверный идентификатор диалога.</p>;
  }

  const canDelete = apiClient.canUserDeleteChats(session?.user ?? null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{chat?.title ?? `Чат #${numericChatId}`}</h2>
            {chat?.bin && <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)' }}>БИН: {chat.bin}</p>}
          </div>
          <button
            type="button"
            onClick={handleToggleFavorite}
            disabled={updatingFavorite}
            title={isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
            style={iconButtonStyle(isFavorite)}
          >
            ★
          </button>
          {canDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={handleDeleteChat}
              title="Удалить диалог"
              style={iconButtonStyle(false)}
            >
              🗑
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chat?.sectionTitle && <span className="chip">Раздел: {chat.sectionTitle}</span>}
          {chat?.username && <span className="chip">@{chat.username}</span>}
        </div>
        {deleting && <p style={{ color: 'var(--color-on-surface-variant)' }}>Удаление диалога…</p>}
      </div>
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16 }}>
        {loading ? (
          <p>Загрузка сообщений…</p>
        ) : error ? (
          <div>
            <p style={{ color: 'var(--color-error)' }}>Ошибка: {error}</p>
            <button type="button" className="outline-button" onClick={fetchMessages} style={{ marginTop: 12 }}>
              Повторить попытку
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 8 }}>
            {messages.map((message) => {
              const outgoing = message.direction === 'outgoing';
              return (
                <div
                  key={message.id}
                  style={{
                    alignSelf: outgoing ? 'flex-end' : 'flex-start',
                    maxWidth: '60%',
                    background: outgoing ? 'var(--color-primary)' : 'var(--color-surface-variant)',
                    color: outgoing ? '#fff' : 'var(--color-on-surface)',
                    padding: '12px 16px',
                    borderRadius: outgoing ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                    boxShadow: '0 8px 24px rgba(31, 36, 50, 0.08)',
                  }}
                >
                  {message.author && (
                    <p style={{ margin: 0, fontWeight: 600, opacity: 0.8 }}>{message.author}</p>
                  )}
                  <p style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{message.text}</p>
                  <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.8 }}>
                    {message.sectionTitle ? `${message.sectionTitle} · ` : ''}
                    {dayjs(message.createdAt).format('DD.MM.YYYY HH:mm')}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        <form onSubmit={handleSend} style={{ marginTop: 12, display: 'flex', gap: 12 }}>
          <textarea
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder="Напишите ответ"
            rows={3}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 16,
              border: '1px solid var(--color-outline)',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            disabled={sending || messageText.trim().length === 0}
            style={{
              minWidth: 140,
              borderRadius: 16,
              border: 'none',
              background: 'var(--color-primary)',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '12px 16px',
              opacity: sending ? 0.7 : 1,
            }}
          >
            {sending ? 'Отправка…' : 'Отправить'}
          </button>
        </form>
      </div>
    </div>
  );
};

const iconButtonStyle = (active: boolean): CSSProperties => ({
  border: 'none',
  background: active ? 'var(--color-primary)' : 'rgba(62, 90, 168, 0.12)',
  color: active ? '#fff' : 'var(--color-primary)',
  width: 40,
  height: 40,
  borderRadius: '50%',
  cursor: 'pointer',
  fontSize: 18,
});

export default ChatDetailPage;
