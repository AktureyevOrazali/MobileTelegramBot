import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, scaleLinear } from 'd3';
import type { FeatureCollection, Geometry } from 'geojson';
import { ApiClient, ApiError } from '../api/ApiClient';
import { AuthSession, BinDetailed, ChatSummary, Message, MessageNotification, Section } from '../types';
import { formatDateTime } from '../utils/date';
import SelectPill from "../components/SelectPill";
import StarButton from "../components/StarButton";
import Modal from "../components/Modal";
import ConfirmModal from "../components/ConfirmModal";
import kzMap from '../../kz.json';

const PRESET_MESSAGES = [
  'Здравствуйте! Чем я могу вам помочь?',
  'Спасибо за обращение! Готовы помочь в любое время!',
];


/* -------------------- Props -------------------- */
interface DialogsPageProps {
  apiClient: ApiClient;
  session: AuthSession;
}

interface ChatDetailModalProps {
  apiClient: ApiClient;
  chat: ChatSummary;
  onToggleStatus: (chat: ChatSummary) => void;
  onClose: () => void;
}

/* -------------------- Modal -------------------- */
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
  const pollRef = useRef<number | null>(null);
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
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Не удалось отправить сообщение.');
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
            <h2 className="heading" style={{ marginBottom: 6 }}>{chat.title}</h2>
            <div className="dialog-status-row">
              <span className="text-muted" style={{ fontSize: '0.9rem' }}>
                {chat.username ? `@${chat.username}` : chat.type}
              </span>
              {statusBadge}
            </div>
            <div className="dialog-meta" style={{ marginTop: 12 }}>
              {chat.sectionTitle && <span className="chip">Раздел: {chat.sectionTitle}</span>}
              {chat.bin && <span className="chip">БИН: {chat.bin}</span>}
              <span className="chip">Начат: {formatDateTime(chat.dialogStartedAt)}</span>
              <span className="chip">Обновлён: {formatDateTime(chat.updatedAt)}</span>
            </div>
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

const GEOJSON_FEATURES = kzMap as FeatureCollection<Geometry, { name: string }>;

const REGION_LABELS: Record<string, string> = {
  Abai: 'Абайская область',
  Akmola: 'Акмолинская область',
  Aktobe: 'Актюбинская область',
  Almaty: 'Алматинская область',
  'Almaty (city)': 'г. Алматы',
  Astana: 'г. Астана',
  Atyrau: 'Атырауская область',
  'East Kazakhstan': 'Восточно-Казахстанская область',
  Jambyl: 'Жамбылская область',
  Jetisu: 'Жетысуская область',
  Karaganda: 'Карагандинская область',
  Kostanay: 'Костанайская область',
  Kyzylorda: 'Кызылординская область',
  Mangystau: 'Мангистауская область',
  'North Kazakhstan': 'Северо-Казахстанская область',
  Pavlodar: 'Павлодарская область',
  'Shymkent (city)': 'г. Шымкент',
  Turkestan: 'Туркестанская область',
  Ulytau: 'Улытауская область',
  'West Kazakhstan': 'Западно-Казахстанская область',
};

const REGION_MATCHERS: { key: string; patterns: string[] }[] = [
  { key: 'Almaty (city)', patterns: ['г. алматы', 'город алматы', 'алматы қ', 'almaty city'] },
  { key: 'Astana', patterns: ['г. астана', 'астана', 'нур-султан', 'нурсултан', 'nur-sultan'] },
  { key: 'Shymkent (city)', patterns: ['г. шымкент', 'шымкент', 'shymkent'] },
  { key: 'Almaty', patterns: ['алматин', 'almaty oblast'] },
  { key: 'Akmola', patterns: ['акмол', 'akmola'] },
  { key: 'Aktobe', patterns: ['актоб', 'aktobe'] },
  { key: 'Atyrau', patterns: ['атырау', 'atyrau'] },
  { key: 'East Kazakhstan', patterns: ['восточно-казахстан', 'east kazakhstan'] },
  { key: 'West Kazakhstan', patterns: ['западно-казахстан', 'west kazakhstan'] },
  { key: 'North Kazakhstan', patterns: ['северо-казахстан', 'north kazakhstan'] },
  { key: 'Jambyl', patterns: ['жамбыл', 'jambyl', 'zhambyl'] },
  { key: 'Jetisu', patterns: ['жетысу', 'jetisu', 'zhetisu', 'жетісу'] },
  { key: 'Karaganda', patterns: ['караган', 'karaganda'] },
  { key: 'Kostanay', patterns: ['костанай', 'kostanay'] },
  { key: 'Kyzylorda', patterns: ['кызылорд', 'kyzylorda'] },
  { key: 'Mangystau', patterns: ['мангист', 'mangystau'] },
  { key: 'Pavlodar', patterns: ['павлодар', 'pavlodar'] },
  { key: 'Turkestan', patterns: ['туркестан', 'turkestan'] },
  { key: 'Ulytau', patterns: ['улытау', 'ulytau'] },
  { key: 'Abai', patterns: ['абай', 'abai'] },
];

const detectRegionFromAddress = (address: string | null | undefined) => {
  if (!address) return null;
  const normalized = address.toLowerCase().replace(/ё/g, 'е');
  const match = REGION_MATCHERS.find((entry) =>
    entry.patterns.some((pattern) => normalized.includes(pattern)),
  );
  return match?.key ?? null;
};

const RegionActivityMap: React.FC<{
  features: FeatureCollection<Geometry, { name: string }>;
  counts: Record<string, number>;
}> = ({ features, counts }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<{ key: string; x: number; y: number } | null>(null);

  const width = 760;
  const height = 420;
  const projection = useMemo(() => geoMercator().fitSize([width, height], features), [features]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const maxValue = Math.max(1, ...Object.values(counts));
  const colorScale = useMemo(
    () => scaleLinear<string>().domain([0, maxValue]).range(['#93c5fd', '#1e3a8a']),
    [maxValue],
  );

  const handleMove = (event: React.MouseEvent<SVGPathElement>, key: string) => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setHovered({ key, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <div className="kz-map" ref={wrapperRef}>
      <svg className="kz-map__svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Карта Казахстана по регионам">
        {features.features.map((feature) => {
          const key = feature.properties?.name;
          const value = counts[key] ?? 0;
          const isActive = hovered?.key === key;
          return (
            <path
              key={key}
              d={path(feature) ?? undefined}
              fill={colorScale(value)}
              className={`kz-map__region ${isActive ? 'is-active' : ''}`}
              onMouseEnter={(event) => handleMove(event, key)}
              onMouseMove={(event) => handleMove(event, key)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </svg>
      {hovered && (
        <div
          className="kz-map__tooltip"
          style={{ left: hovered.x + 12, top: hovered.y + 12 }}
        >
          <div className="kz-map__tooltip-title">{REGION_LABELS[hovered.key] ?? hovered.key}</div>
          <div className="kz-map__tooltip-value">{counts[hovered.key] ?? 0} БИН</div>
        </div>
      )}
    </div>
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
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  const [banner, setBanner] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ChatSummary | null>(null);
  const [dialogToDelete, setDialogToDelete] = useState<ChatSummary | null>(null);
  const [dialogDeleteLoading, setDialogDeleteLoading] = useState(false);
  const [updatesCursor, setUpdatesCursor] = useState<Date | null>(null);
  const [aiToggleDialogId, setAiToggleDialogId] = useState<number | null>(null);
  const [aiManuallyDisabled, setAiManuallyDisabled] = useState<Set<number>>(new Set());
  const [dialogStatusTarget, setDialogStatusTarget] = useState<{ chat: ChatSummary; action: 'open' | 'close' } | null>(null);
  const [dialogStatusLoading, setDialogStatusLoading] = useState(false);
  const [binDetails, setBinDetails] = useState<BinDetailed[]>([]);

  const currentUser = session.user;
  const canDeleteDialog = currentUser.isAdmin;

  const applyAiOverrides = useCallback(
    (list: ChatSummary[]) =>
      list.map((chat) =>
        aiManuallyDisabled.has(chat.dialogId) ? { ...chat, aiEnabled: false } : chat,
      ),
    [aiManuallyDisabled],
  );

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
        setChats(applyAiOverrides(loadedChats));

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
    [
      apiClient,
      applyAiOverrides,
      currentUser.isAdmin,
      currentUser.sections,
      selectedBin,
      showFavoritesOnly,
      updatesCursor,
    ],
  );

  const loadBins = useCallback(async () => {
    try {
      const data = await apiClient.fetchBins();
      if (currentUser.isAdmin) {
        setBins(data);
        return;
      }

      const assignedValues = (currentUser.bins ?? []).map((assignment) => assignment.bin);
      const allowed = new Set(assignedValues);
      const filtered = data.filter((bin) => allowed.has(bin));
      const merged = Array.from(new Set([...filtered, ...assignedValues]));
      setBins(merged);
    } catch (err) {
      console.warn('Не удалось загрузить БИНы', err);
    }
  }, [apiClient, currentUser.bins, currentUser.isAdmin]);

  const loadBinDetails = useCallback(async () => {
    if (!currentUser.isAdmin && bins.length === 0) return;
    try {
      const data = await apiClient.getBinsDetailed();
      const filtered = currentUser.isAdmin ? data : data.filter((item) => bins.includes(item.bin));
      setBinDetails(filtered);
    } catch (err) {
      console.warn('Не удалось загрузить детали БИНов', err);
    }
  }, [apiClient, bins, currentUser.isAdmin]);

  useEffect(() => { loadSectionsAndChats(true); loadBins(); }, [loadSectionsAndChats, loadBins]);

  useEffect(() => {
    if (!selectedBin) return;
    if (!bins.includes(selectedBin)) {
      setSelectedBin(null);
    }
  }, [bins, selectedBin]);

  useEffect(() => {
    loadBinDetails();
  }, [loadBinDetails]);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  useEffect(() => {
    setChats((prev) => applyAiOverrides(prev));
    setActiveChat((prev) => (prev ? applyAiOverrides([prev])[0] : prev));
  }, [applyAiOverrides]);

  const handleUpdates = useCallback(
    (updates: MessageNotification[]) => {
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
        if (assignments.length > 0) {
          loadBins();
        }
      }
    },
    [loadBins, loadSectionsAndChats],
  );

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
  }, [apiClient, updatesCursor, handleUpdates, loadSectionsAndChats]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      loadSectionsAndChats(false);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [loadSectionsAndChats]);


  const sectionOptions = useMemo(
    () => [{ value: "", label: "Все разделы" }, ...sections.map(s => ({ value: String(s.id), label: s.title }))],
    [sections]
  );
  const binOptions = useMemo(
    () => [{ value: "", label: "Все БИНы" }, ...bins.map(b => ({ value: b, label: b }))],
    [bins]
  );
  const sortOptions = useMemo(
    () => [
      { value: 'desc', label: 'Сначала новые' },
      { value: 'asc', label: 'Сначала старые' },
    ],
    [],
  );
  const statusOptions = useMemo(
    () => [
      { value: 'all', label: 'Все диалоги' },
      { value: 'open', label: 'Только открытые' },
      { value: 'closed', label: 'Только закрытые' },
    ],
    [],
  );

  useEffect(() => {
    loadSectionsAndChats(true, { bin: selectedBin, favoritesOnly: showFavoritesOnly });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSection, selectedBin, showFavoritesOnly]);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    GEOJSON_FEATURES.features.forEach((feature) => {
      if (feature.properties?.name) {
        counts[feature.properties.name] = 0;
      }
    });
    binDetails.forEach((detail) => {
      const regionKey = detectRegionFromAddress(detail.customerLegalAddress);
      if (regionKey && regionKey in counts) {
        counts[regionKey] += 1;
      }
    });
    return counts;
  }, [binDetails]);

  const maxRegionCount = useMemo(
    () => Math.max(1, ...Object.values(regionCounts)),
    [regionCounts],
  );

  const filteredChats = useMemo(() => {
    let list = chats;
    if (selectedSection) {
      list = list.filter((chat) => chat.section === selectedSection);
    }
    if (showFavoritesOnly) {
      const favorites = new Set(apiClient.currentUser?.favoriteDialogIds ?? []);
      list = list.filter((chat) => favorites.has(chat.dialogId));
    }
    if (statusFilter === 'open') {
      list = list.filter((chat) => !chat.dialogClosedAt);
    } else if (statusFilter === 'closed') {
      list = list.filter((chat) => Boolean(chat.dialogClosedAt));
    }
    const sorted = [...list].sort((a, b) => {
      const diff = a.updatedAt.getTime() - b.updatedAt.getTime();
      return sortOrder === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [
    apiClient.currentUser?.favoriteDialogIds,
    chats,
    selectedSection,
    showFavoritesOnly,
    sortOrder,
    statusFilter,
  ]);

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

  const requestStatusChange = useCallback((chat: ChatSummary) => {
    setDialogStatusTarget({ chat, action: chat.dialogClosedAt ? 'open' : 'close' });
  }, []);

  const handleDialogStatusChange = useCallback(async () => {
    if (!dialogStatusTarget) return;
    setDialogStatusLoading(true);
    try {
      const { chat, action } = dialogStatusTarget;
      const response =
        action === 'close'
          ? await apiClient.closeDialog(chat.dialogId)
          : await apiClient.openDialog(chat.dialogId);
      const closedAt = response.dialogClosedAt ?? null;
      const aiEnabled = response.aiEnabled;

      setChats((prev) =>
        prev.map((item) =>
          item.dialogId === chat.dialogId
            ? { ...item, dialogClosedAt: closedAt, aiEnabled }
            : item,
        ),
      );
      setActiveChat((prev) =>
        prev && prev.dialogId === chat.dialogId
          ? { ...prev, dialogClosedAt: closedAt, aiEnabled }
          : prev,
      );
      setAiManuallyDisabled((prev) => {
        if (!aiEnabled && prev.has(chat.dialogId)) return prev;
        const next = new Set(prev);
        if (aiEnabled) next.delete(chat.dialogId);
        return next;
      });

      setBanner(
        action === 'close'
          ? 'Диалог закрыт. Клиент уведомлён и AI снова включён.'
          : 'Диалог открыт снова и готов к сообщениям.',
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Не удалось обновить статус диалога.';
      setBanner(`Ошибка: ${message}`);
    } finally {
      setDialogStatusLoading(false);
      setDialogStatusTarget(null);
    }
  }, [apiClient, dialogStatusTarget]);

  const renderStatusBadge = useCallback(
    (chat: ChatSummary) => {
      const className = `status-badge ${chat.dialogClosedAt ? 'status-badge--closed' : 'status-badge--open'}`;
      const label = chat.dialogClosedAt ? 'Закрыт' : 'Открыт';
      if (!currentUser.canReply) {
        return <span className={className}>{label}</span>;
      }
      return (
        <button
          type="button"
          className={`${className} status-badge-btn status-badge--clickable`}
          onClick={() => requestStatusChange(chat)}
          title={chat.dialogClosedAt ? 'Открыть диалог' : 'Закрыть диалог'}
        >
          {label}
        </button>
      );
    },
    [currentUser.canReply, requestStatusChange],
  );

  const updateChatAiStatus = useCallback((dialogId: number, aiEnabled: boolean) => {
    setChats((prev) => prev.map((item) => (item.dialogId === dialogId ? { ...item, aiEnabled } : item)));
    setActiveChat((prev) => (prev && prev.dialogId === dialogId ? { ...prev, aiEnabled } : prev));
  }, []);

  const handleToggleAi = useCallback(
    async (chat: ChatSummary) => {
      setAiToggleDialogId(chat.dialogId);
      try {
        if (chat.aiEnabled) {
          await apiClient.disableDialogAI(chat.dialogId);
          setAiManuallyDisabled((prev) => {
            const next = new Set(prev);
            next.add(chat.dialogId);
            return next;
          });
          updateChatAiStatus(chat.dialogId, false);
          setBanner('AI помощник отключён. Клиенту отправлено уведомление.');
        } else {
          await apiClient.enableDialogAI(chat.dialogId);
          setAiManuallyDisabled((prev) => {
            if (!prev.has(chat.dialogId)) return prev;
            const next = new Set(prev);
            next.delete(chat.dialogId);
            return next;
          });
          updateChatAiStatus(chat.dialogId, true);
          setBanner('AI помощник включён для этого диалога.');
        }
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Не удалось обновить режим AI.';
        setBanner(`Ошибка: ${message}`);
      } finally {
        setAiToggleDialogId(null);
      }
    },
    [apiClient, updateChatAiStatus],
  );


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 48 }}>
      {banner && (<div className="alert" onAnimationEnd={() => setBanner(null)}>{banner}</div>)}

      <div className="analytics-banner">
        <div className="analytics-banner__header">
          <div>
            <div className="analytics-banner__eyebrow">Карта БИН</div>
            <h2 className="analytics-banner__title">Активность по регионам Казахстана</h2>
          </div>
          <div className="kz-map__legend">
            <span>Светлее</span>
            <span className="kz-map__legend-gradient" aria-hidden="true" />
            <span>Темнее</span>
            <span className="kz-map__legend-value">макс: {maxRegionCount}</span>
          </div>
        </div>
        <div className="analytics-banner__body">
          <RegionActivityMap features={GEOJSON_FEATURES} counts={regionCounts} />
        </div>
      </div>

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
          <SelectPill
            label=""
            showLabelInside={false}
            options={sortOptions}
            value={sortOrder}
            onChange={(v) => setSortOrder((v as 'asc' | 'desc') || 'desc')}
          />
          <SelectPill
            label=""
            showLabelInside={false}
            options={statusOptions}
            value={statusFilter}
            onChange={(v) => setStatusFilter((v as 'all' | 'open' | 'closed') || 'all')}
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
          <p className="text-muted">Сообщения из MobileBot появятся здесь автоматически.</p>
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
                  {chat.unreadCount > 0 && (
                    <span className="unread-badge" title="Есть непрочитанные сообщения">
                      <span className="unread-badge__dot" />
                      {chat.unreadCount}
                    </span>
                  )}
                  <StarButton
                    active={Boolean(chat.isFavorite)}
                    onToggle={async () => {
                      const next = !chat.isFavorite;
                      try {
                        await apiClient.setFavorite(chat.dialogId, next);
                        setChats((prev) =>
                          prev.map((item) =>
                            item.dialogId === chat.dialogId ? { ...item, isFavorite: next } : item,
                          ),
                        );
                        setActiveChat((prev) =>
                          prev && prev.dialogId === chat.dialogId ? { ...prev, isFavorite: next } : prev,
                        );
                      } catch (err) {
                        const message =
                          err instanceof ApiError
                            ? err.message
                            : err instanceof Error
                              ? err.message
                              : 'Не удалось обновить избранное.';
                        setBanner(`Ошибка: ${message}`);
                      }
                    }}
                    title={chat.isFavorite ? "Убрать из избранного" : "В избранное"}
                  />
                </div>
                <div className="dialog-status-row" style={{ marginTop: 4 }}>
                  <span className="text-muted">
                    {chat.username ? `@${chat.username}` : chat.type}
                  </span>
                  {renderStatusBadge(chat)}
                </div>
                <div className="flex-gap" style={{ marginTop: 8 }}>
                  {chat.sectionTitle && <span className="chip">{chat.sectionTitle}</span>}
                  {chat.bin && <span className="chip">БИН: {chat.bin}</span>}
                  <span className="chip">AI: {chat.aiEnabled ? 'включён' : 'отключён'}</span>
                </div>
              </div>

              <div className="flex-gap" style={{ alignItems: 'center' }}>
                <button
                  className="button"
                  type="button"
                  onClick={() => handleToggleAi(chat)}
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
                  onClick={() => {
                    if (chat.unreadCount > 0) {
                      setChats((prev) =>
                        prev.map((item) =>
                          item.dialogId === chat.dialogId ? { ...item, unreadCount: 0 } : item,
                        ),
                      );
                    }
                    setActiveChat(chat.unreadCount > 0 ? { ...chat, unreadCount: 0 } : chat);
                  }}
                >
                  Открыть диалог
                </button>
                {canDeleteDialog && (
                  <button className="button danger" type="button" onClick={() => setDialogToDelete(chat)}>
                    ✖
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
          onToggleStatus={requestStatusChange}
          onClose={() => setActiveChat(null)}
        />
      )}

      <ConfirmModal
        open={Boolean(dialogStatusTarget)}
        title={dialogStatusTarget?.action === 'close' ? 'Закрыть диалог?' : 'Открыть диалог?'}
        description={
          dialogStatusTarget
            ? dialogStatusTarget.action === 'close'
              ? (
                <>
                  Клиент получит уведомление о закрытии, AI включится автоматически.
                  Новый входящий запрос снова откроет диалог.
                </>
              )
              : (
                <>Диалог станет активным. AI останется включённым и готовым к ответам.</>
              )
            : undefined
        }
        tone={dialogStatusTarget?.action === 'close' ? 'danger' : 'default'}
        confirmLabel={dialogStatusTarget?.action === 'close' ? 'Закрыть' : 'Открыть'}
        cancelLabel="Отмена"
        loading={dialogStatusLoading}
        onCancel={() => setDialogStatusTarget(null)}
        onConfirm={handleDialogStatusChange}
      />

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