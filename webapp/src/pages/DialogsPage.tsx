import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { AuthSession, ChatSummary, Message, MessageNotification, Section } from '../types';
import { formatDateTime } from '../utils/date';
import SelectPill from "../components/SelectPill";
import StarButton from "../components/StarButton";
import Modal from "../components/Modal";
import ConfirmModal from "../components/ConfirmModal";

/* -------------------- Props -------------------- */
interface DialogsPageProps {
  apiClient: ApiClient;
  session: AuthSession;
}

interface ChatDetailModalProps {
  apiClient: ApiClient;
  chat: ChatSummary;
  onClose: () => void;
  onChatUpdated: (chat: ChatSummary) => void;
  canDeleteDialog: boolean;
  onDeleteRequest: (chat: ChatSummary) => void;
}

/* -------------------- Modal -------------------- */
const ChatDetailModal: React.FC<ChatDetailModalProps> = ({
  apiClient,
  chat,
  onClose,
  onChatUpdated,
  canDeleteDialog,
  onDeleteRequest,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // ВАЖНО: реф именно на прокручиваемый контейнер (modal__scroll), а не на внутренний список
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);
  const lastCountRef = useRef<number>(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const currentUser = apiClient.currentUser;
  const canReply = Boolean(currentUser?.canReply);

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
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Не удалось загрузить сообщения.');
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
    pollRef.current = window.setInterval(async () => {
      try {
        const data = await apiClient.fetchMessages(chat.chatId, 200, chat.dialogId);
        if (data.length !== lastCountRef.current) {
          setMessages(data);
          lastCountRef.current = data.length;
          // прокрутка произойдёт через useEffect([messages])
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [apiClient, chat.chatId, chat.dialogId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (taRef.current) autosize(taRef.current);
  }, [input, autosize]);

  const handleSend = async () => {
    if (!input.trim()) return;
    setSending(true);
    try {
      await apiClient.sendMessage(chat.chatId, input.trim(), chat.dialogId);
      setInput('');
      await loadMessages();           // загрузим актуальный список
      requestAnimationFrame(() => scrollToBottom(true)); // и прокрутим
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Не удалось отправить сообщение.');
    } finally {
      setSending(false);
    }
  };

  const toggleFavorite = async () => {
    const nextValue = !chat.isFavorite;
    try {
      await apiClient.setFavorite(chat.dialogId, nextValue);
      onChatUpdated({ ...chat, isFavorite: nextValue });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
    }
  };

  return (
    <Modal open onClose={onClose} className="modal--dialog">
      <div className="modal__content">
        <button className="modal__close" type="button" aria-label="Закрыть" onClick={onClose} title="Закрыть">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12l-4.9 4.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.41Z" fill="currentColor"/>
          </svg>
        </button>
        {/* Header */}
        <div className="modal__header-row">
          <div>
            <h2 className="heading" style={{ marginBottom: 6 }}>{chat.title}</h2>
            <div className="text-muted" style={{ fontSize: '0.9rem' }}>
              {chat.username ? `@${chat.username}` : chat.type}
            </div>
            <div className="dialog-meta" style={{ marginTop: 12 }}>
              {chat.sectionTitle && <span className="chip">Раздел: {chat.sectionTitle}</span>}
              {chat.bin && <span className="chip">БИН: {chat.bin}</span>}
              <span className="chip">Начат: {formatDateTime(chat.dialogStartedAt)}</span>
              <span className="chip">Обновлён: {formatDateTime(chat.updatedAt)}</span>
              {chat.dialogClosedAt && <span className="chip">Закрыт: {formatDateTime(chat.dialogClosedAt)}</span>}
            </div>
          </div>

          <div className="flex-gap" style={{ alignItems: 'center' }}>
            <StarButton
              active={Boolean(chat.isFavorite)}
              onToggle={toggleFavorite}
              title={chat.isFavorite ? "Убрать из избранного" : "В избранное"}
            />
          </div>
        </div>

        <div className="separator" />
        {error && <div className="alert">{error}</div>}

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
                  style={{ alignSelf: message.direction === 'incoming' ? 'flex-start' : 'flex-end' }}
                >
                  {message.author && <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.85 }}>{message.author}</div>}
                  <div>{message.text}</div>
                  <div style={{ marginTop: 6, fontSize: '0.75rem', opacity: 0.7 }}>{formatDateTime(message.createdAt)}</div>
                  {message.sectionTitle && (
                    <div style={{ marginTop: 6, fontSize: '0.75rem', opacity: 0.7 }}>Раздел: {message.sectionTitle}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="separator" />

        {/* Composer */}
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
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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

/* -------------------- Page -------------------- */
const DialogsPage: React.FC<DialogsPageProps> = ({ apiClient, session }) => {
  const [sections, setSections] = useState<Section[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [bins, setBins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [selectedBin, setSelectedBin] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const [banner, setBanner] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ChatSummary | null>(null);
  const [dialogToDelete, setDialogToDelete] = useState<ChatSummary | null>(null);
  const [dialogDeleteLoading, setDialogDeleteLoading] = useState(false);
  const [updatesCursor, setUpdatesCursor] = useState<Date | null>(null);

  const currentUser = session.user;
  const canDeleteDialog = currentUser.isAdmin;

  const loadSectionsAndChats = useCallback(
    async (withLoading = true, overrides?: { bin?: string | null; favoritesOnly?: boolean }) => {
      if (withLoading) {
        setLoading(true);
        setError(null);
      }
      try {
        const binFilter = overrides && 'bin' in overrides ? overrides.bin : selectedBin;
        const favoritesOnly =
          overrides && 'favoritesOnly' in overrides ? overrides.favoritesOnly ?? false : showFavoritesOnly;

        const [loadedSections, loadedChats] = await Promise.all([
          apiClient.fetchSections(),
          apiClient.fetchChats({ favoriteOnly: favoritesOnly, binQuery: binFilter ?? undefined }),
        ]);

        const visibleSections = currentUser.isAdmin
          ? loadedSections
          : loadedSections.filter((section) => currentUser.sections.includes(section.id));

        setSections(visibleSections);
        setChats(loadedChats);

        setLoading(false);
        setError(null);
        if (!updatesCursor) setUpdatesCursor(new Date());
      } catch (err) {
        if (err instanceof ApiError) setError(err.message);
        else if (err instanceof Error) setError(err.message);
        else setError('Не удалось загрузить данные.');
        setLoading(false);
      }
    },
    [apiClient, currentUser.isAdmin, currentUser.sections, selectedBin, showFavoritesOnly, updatesCursor],
  );

  const loadBins = useCallback(async () => {
    try {
      const data = await apiClient.fetchBins();
      setBins(data);
    } catch (err) {
      console.warn('Не удалось загрузить БИНы', err);
    }
  }, [apiClient]);

  useEffect(() => { loadSectionsAndChats(true); loadBins(); }, [loadSectionsAndChats, loadBins]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        if (!updatesCursor) {
          setUpdatesCursor(new Date());
          return;
        }
        const updates = await apiClient.fetchUpdates(updatesCursor);
        if (updates.length > 0) {
          handleUpdates(updates);
          const lastUpdate = updates[updates.length - 1].createdAt;
          setUpdatesCursor(lastUpdate);
        }
      } catch (err) {
        console.warn('Не удалось получить обновления', err);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [apiClient, updatesCursor, loadSectionsAndChats]);

  const handleUpdates = (updates: MessageNotification[]) => {
    const messages = updates
      .filter((update) => update.type === 'message' && update.chatTitle)
      .map((update) => `${update.chatTitle}: ${update.text}`);
    const assignments = updates
      .filter((update) => update.type === 'bin_assignment' && update.bin)
      .map((update) => `Вам назначен новый БИН ${update.bin}.`);
    const combined = [...assignments, ...messages];
    if (combined.length > 0) {
      setBanner(combined.join(' '));
      loadSectionsAndChats(false);
    }
  };

  const sectionOptions = useMemo(
    () => [{ value: "", label: "Все разделы" }, ...sections.map(s => ({ value: String(s.id), label: s.title }))],
    [sections]
  );
  const binOptions = useMemo(
    () => [{ value: "", label: "Все БИНы" }, ...bins.map(b => ({ value: b, label: b }))],
    [bins]
  );

  useEffect(() => {
    loadSectionsAndChats(true, { bin: selectedBin, favoritesOnly: showFavoritesOnly });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSection, selectedBin, showFavoritesOnly]);

  const filteredChats = useMemo(() => {
    let list = chats;
    if (selectedSection) list = list.filter((chat) => chat.section === selectedSection);
    if (showFavoritesOnly) {
      const favorites = new Set(apiClient.currentUser?.favoriteDialogIds ?? []);
      list = list.filter((chat) => favorites.has(chat.dialogId));
    }
    return list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }, [apiClient.currentUser?.favoriteDialogIds, chats, selectedSection, showFavoritesOnly]);

  useEffect(() => {
    if (!activeChat) return;
    const updated = chats.find((item) => item.dialogId === activeChat.dialogId);
    if (!updated) {
      setActiveChat(null);
      return;
    }
    if (updated !== activeChat) {
      setActiveChat(updated);
    }
  }, [activeChat, chats]);

  const handleDialogDelete = useCallback(async () => {
    if (!dialogToDelete) return;
    setDialogDeleteLoading(true);
    try {
      await apiClient.deleteDialog(dialogToDelete.dialogId);
      setChats((prev) => prev.filter((item) => item.dialogId !== dialogToDelete.dialogId));
      if (activeChat?.dialogId === dialogToDelete.dialogId) {
        setActiveChat(null);
      }
      setBanner('Диалог удалён');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : 'Не удалось удалить диалог.';
      setBanner(`Ошибка: ${message}`);
    } finally {
      setDialogDeleteLoading(false);
      setDialogToDelete(null);
    }
  }, [activeChat, apiClient, dialogToDelete]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 48 }}>
      {banner && (<div className="alert" onAnimationEnd={() => setBanner(null)}>{banner}</div>)}

      {/* фильтры */}
      <div className="card sticky-filters">
        <div className="controls-row">
          <SelectPill
            label=""
            showLabelInside={false}
            options={sectionOptions}
            value={selectedSection ?? ""}
            onChange={(v) => setSelectedSection(v || null)}
          />
          <SelectPill
            label=""
            showLabelInside={false}
            options={binOptions}
            value={selectedBin ?? ""}
            onChange={(v) => setSelectedBin(v || null)}
            searchable
          />
          <label className="check-pill">
            <input
              type="checkbox"
              checked={showFavoritesOnly}
              onChange={(e) => setShowFavoritesOnly(e.target.checked)}
            />
            <span>Только избранные</span>
          </label>
        </div>
      </div>

      {/* контент */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center' }}>Загружаем диалоги...</div>
      ) : error ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: 16 }}>Ошибка: {error}</p>
          <button className="button" type="button" onClick={() => loadSectionsAndChats(true)}>Повторить попытку</button>
        </div>
      ) : filteredChats.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ marginBottom: 8 }}>Нет активных диалогов</h3>
          <p className="text-muted">Сообщения из Telegram появятся здесь автоматически.</p>
        </div>
      ) : (
        filteredChats.map((chat) => (
          <div
            key={`${chat.chatId}-${chat.dialogId}`}
            className="card"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0 }}>{chat.title}</h3>
                  <StarButton
                    active={Boolean(chat.isFavorite)}
                    onToggle={() =>
                      apiClient.setFavorite(chat.dialogId, !chat.isFavorite).then(() => {
                        setChats((prev) =>
                          prev.map((item) => (item.chatId === chat.chatId ? { ...item, isFavorite: !item.isFavorite } : item)),
                        );
                      })
                    }
                    title={chat.isFavorite ? "Убрать из избранного" : "В избранное"}
                  />
                </div>
                <div className="text-muted" style={{ marginTop: 4 }}>
                  {chat.username ? `@${chat.username}` : chat.type}
                </div>
                <div className="flex-gap" style={{ marginTop: 8 }}>
                  {chat.sectionTitle && <span className="chip">{chat.sectionTitle}</span>}
                  {chat.bin && <span className="chip">БИН: {chat.bin}</span>}
                  <span className="chip">Обновлён {formatDateTime(chat.updatedAt)}</span>
                </div>
              </div>

              <div className="flex-gap" style={{ alignItems: 'center' }}>
                <button className="button" type="button" onClick={() => setActiveChat(chat)}>
                  Открыть диалог
                </button>
                {canDeleteDialog && (
                  <button className="button danger" type="button" onClick={() => setDialogToDelete(chat)}>
                    Удалить
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {activeChat && (
        <ChatDetailModal
          apiClient={apiClient}
          chat={activeChat}
          onClose={() => setActiveChat(null)}
          onChatUpdated={(updated) => {
            setChats((prev) =>
              prev.map((item) => (item.dialogId === updated.dialogId ? updated : item)),
            );
            setActiveChat((prev) => (prev && prev.dialogId === updated.dialogId ? updated : prev));
          }}
          canDeleteDialog={canDeleteDialog}
          onDeleteRequest={(chat) => setDialogToDelete(chat)}
        />
      )}

      <ConfirmModal
        open={Boolean(dialogToDelete)}
        title="Удалить диалог?"
        description={
          dialogToDelete
            ? (
              <>
                Диалог с <strong>{dialogToDelete.title}</strong> будет удалён навсегда.
                Это действие нельзя отменить.
              </>
            )
            : undefined
        }
        tone="danger"
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        loading={dialogDeleteLoading}
        onCancel={() => setDialogToDelete(null)}
        onConfirm={handleDialogDelete}
      />
    </div>
  );
};

export default DialogsPage;
