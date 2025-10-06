import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { ChatSummary, MessageNotification, Section } from '@/api/types';
import { useFeedback } from '@/context/FeedbackContext';
import { useSession } from '@/context/SessionContext';
import dayjs from 'dayjs';

const DashboardHome = () => {
  const { apiClient, session } = useSession();
  const navigate = useNavigate();
  const { showFeedback } = useFeedback();

  const [sections, setSections] = useState<Section[]>([]);
  const [bins, setBins] = useState<string[]>([]);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [lastUpdateCursor, setLastUpdateCursor] = useState<Date | null>(null);

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [sectionsResponse, binsResponse] = await Promise.all([
          apiClient.fetchSections(),
          apiClient.fetchBins(),
        ]);
        setSections(sectionsResponse);
        setBins(binsResponse);
      } catch (error) {
        console.error('Не удалось загрузить справочники', error);
      }
    };
    loadInitial();
  }, [apiClient]);

  const loadChats = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await apiClient.fetchChats({
        favoritesOnly,
        binQuery: selectedBin ?? undefined,
        section: selectedSection ?? undefined,
      });
      setChats(data);
      setError(null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось загрузить диалоги.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, favoritesOnly, selectedBin, selectedSection]);

  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      loadChats(true);
    } else {
      loadChats(false);
    }
  }, [loadChats]);

  useEffect(() => {
    const poll = async () => {
      try {
        const notifications = await apiClient.fetchUpdates(lastUpdateCursor ?? undefined);
        if (notifications.length > 0) {
          const last = notifications[notifications.length - 1];
          setLastUpdateCursor(new Date(last.createdAt));
          notifyUpdates(notifications);
          loadChats(false);
        }
        setPollingError(null);
      } catch (error) {
        console.error('Polling failed', error);
        setPollingError('Не удалось получить обновления.');
      }
    };
    const interval = window.setInterval(poll, 5000);
    poll();
    return () => window.clearInterval(interval);
  }, [apiClient, favoritesOnly, selectedBin, selectedSection, lastUpdateCursor, loadChats]);

  if (!session) {
    return null;
  }

  const notifyUpdates = (updates: MessageNotification[]) => {
    if (updates.length === 1) {
      showFeedback(`Новое сообщение: ${updates[0].chatTitle}`, { variant: 'info' });
    } else if (updates.length > 1) {
      showFeedback(`Новых сообщений: ${updates.length}`, { variant: 'info' });
    }
  };

  const handleToggleFavorite = async (chat: ChatSummary) => {
    const newValue = !chat.isFavorite;
    setChats((prev) => prev.map((item) => (item.chatId === chat.chatId ? { ...item, isFavorite: newValue } : item)));
    try {
      await apiClient.setFavorite(chat.chatId, newValue);
      showFeedback(
        newValue ? 'Диалог добавлен в избранное' : 'Диалог удалён из избранного',
        { variant: 'success' },
      );
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить избранное';
      setChats((prev) => prev.map((item) => (item.chatId === chat.chatId ? { ...item, isFavorite: !newValue } : item)));
      showFeedback(message, { variant: 'error' });
    }
  };

  const handleDeleteChat = async (chat: ChatSummary) => {
    if (!window.confirm(`Переписка с "${chat.title}" будет удалена. Продолжить?`)) {
      return;
    }
    try {
      await apiClient.deleteChat(chat.chatId);
      setChats((prev) => prev.filter((item) => item.chatId !== chat.chatId));
      showFeedback(`Диалог "${chat.title}" удалён.`, { variant: 'success' });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось удалить диалог';
      showFeedback(message, { variant: 'error' });
    }
  };

  const currentUser = session.user;
  const canDeleteChats = apiClient.canUserDeleteChats(currentUser);

  const filteredChats = useMemo(() => {
    let result = [...chats];
    if (selectedSection) {
      result = result.filter((chat) => chat.section === selectedSection);
    }
    if (favoritesOnly) {
      result = result.filter((chat) => chat.isFavorite);
    }
    return result;
  }, [chats, favoritesOnly, selectedSection]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ minWidth: 220, flex: '1 1 220px' }}>
            <label style={labelStyle}>
              <span>Раздел</span>
              <select
                value={selectedSection ?? ''}
                onChange={(event) => setSelectedSection(event.target.value || null)}
                style={inputStyle}
              >
                <option value="">Все разделы</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ minWidth: 220, flex: '1 1 220px' }}>
            <label style={labelStyle}>
              <span>БИН</span>
              <select
                value={selectedBin ?? ''}
                onChange={(event) => setSelectedBin(event.target.value || null)}
                style={inputStyle}
              >
                <option value="">Все БИНы</option>
                {bins.map((bin) => (
                  <option key={bin} value={bin}>
                    {bin}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(event) => setFavoritesOnly(event.target.checked)}
              />
              Только избранные
            </label>
            <button type="button" className="outline-button" onClick={() => loadChats()}>
              Обновить
            </button>
          </div>
        </div>
        {pollingError && (
          <p style={{ marginTop: 12, color: 'var(--color-error)' }}>{pollingError}</p>
        )}
      </div>
      {loading ? (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p>Загрузка диалогов…</p>
        </div>
      ) : error ? (
        <div className="card" style={{ padding: 32 }}>
          <p style={{ color: 'var(--color-error)' }}>Ошибка: {error}</p>
          <button type="button" className="outline-button" onClick={() => loadChats()} style={{ marginTop: 12 }}>
            Повторить попытку
          </button>
        </div>
      ) : filteredChats.length === 0 ? (
        <div className="card" style={{ padding: 32 }}>
          <p>Нет диалогов, удовлетворяющих условиям фильтра.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {filteredChats.map((chat) => (
            <article key={chat.chatId} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: 18 }}>{chat.title}</h3>
                  <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: 14 }}>
                    {chat.username ? `@${chat.username}` : `Тип: ${chat.type}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleFavorite(chat)}
                  title={chat.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                  style={iconButtonStyle(chat.isFavorite)}
                >
                  ★
                </button>
                {canDeleteChats && (
                  <button
                    type="button"
                    onClick={() => handleDeleteChat(chat)}
                    title="Удалить диалог"
                    style={iconButtonStyle(false)}
                  >
                    🗑
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {chat.sectionTitle && (
                  <span className="chip">{chat.sectionTitle}</span>
                )}
                {chat.bin && chat.bin.length > 0 && <span className="chip">БИН: {chat.bin}</span>}
              </div>
              <p style={{ margin: 0, color: 'var(--color-on-surface-variant)', fontSize: 13 }}>
                Обновлён: {dayjs(chat.updatedAt).format('DD.MM.YYYY HH:mm')}
              </p>
              <button
                type="button"
                onClick={() => navigate(`/chats/${chat.chatId}`, { state: { chat } })}
                style={{
                  marginTop: 'auto',
                  borderRadius: 14,
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: '#fff',
                  padding: '12px 16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Открыть диалог
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontWeight: 500,
};

const inputStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 14,
  border: '1px solid var(--color-outline)',
  background: '#fff',
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

export default DashboardHome;
