import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession, BinDetailed, ChatSummary, MessageNotification, Section } from '../types';
import { formatDateTime } from '../utils/date';
import { extractErrorMessage } from '../utils/errors';
import SelectPill from "../components/SelectPill";
import StarButton from "../components/StarButton";
import ConfirmModal from "../components/ConfirmModal";
import ChatDetailModal from "../components/ChatDetailModal";
import RegionActivityMap, {
  GEOJSON_FEATURES,
  CITY_REGION_KEYS,
  detectRegionFromAddress,
} from "../components/RegionActivityMap";
import { useDialogFilters } from "../hooks/useDialogFilters";

/* -------------------- Props -------------------- */
interface DialogsPageProps {
  apiClient: ApiClient;
  session: AuthSession;
}

/* -------------------- Page -------------------- */
const DialogsPage: React.FC<DialogsPageProps> = ({ apiClient, session }) => {
  const [sections, setSections] = useState<Section[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [bins, setBins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    selectedSection, setSelectedSection,
    selectedBin, setSelectedBin,
    showFavoritesOnly, setShowFavoritesOnly,
    sortOrder, setSortOrder,
    statusFilter, setStatusFilter,
  } = useDialogFilters();

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
        setError(extractErrorMessage(err, 'Не удалось загрузить данные.'));
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
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        if (!updatesCursor) {
          setUpdatesCursor(new Date());
          return;
        }
        const updates = await apiClient.fetchUpdates(updatesCursor);
        if (!cancelled && updates.length > 0) {
          handleUpdates(updates);
          const lastUpdate = updates[updates.length - 1].createdAt;
          setUpdatesCursor(lastUpdate);
        }
      } catch (err) {
        console.warn('Не удалось получить обновления', err);
      }
    }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [apiClient, updatesCursor, handleUpdates, loadSectionsAndChats]);

  useEffect(() => {
    let cancelled = false;
    const interval = window.setInterval(async () => {
      if (!cancelled) loadSectionsAndChats(false);
    }, 15000);
    return () => { cancelled = true; window.clearInterval(interval); };
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
      if (regionKey && regionKey in counts && !CITY_REGION_KEYS.has(regionKey)) {
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
      setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось удалить диалог.')}`);
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
      setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось обновить статус диалога.')}`);
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
        setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось обновить режим AI.')}`);
      } finally {
        setAiToggleDialogId(null);
      }
    },
    [apiClient, updateChatAiStatus],
  );

  const handleToggleFavorite = useCallback(
    async (dialogId: number, currentIsFavorite: boolean) => {
      const next = !currentIsFavorite;
      try {
        await apiClient.setFavorite(dialogId, next);
        setChats((prev) =>
          prev.map((item) =>
            item.dialogId === dialogId ? { ...item, isFavorite: next } : item,
          ),
        );
        setActiveChat((prev) =>
          prev && prev.dialogId === dialogId ? { ...prev, isFavorite: next } : prev,
        );
      } catch (err) {
        setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось обновить избранное.')}`);
      }
    },
    [apiClient],
  );

  return (
    <div className="dialogs-page">
      {banner && (<div className="dialogs-banner" onAnimationEnd={() => setBanner(null)}>{banner}</div>)}

      <div className="analytics-banner">
        <div className="analytics-banner__header">
          <div>
            <div className="analytics-banner__eyebrow">Карта БИН</div>
            <h2 className="analytics-banner__title">Активность по регионам Казахстана</h2>
          </div>
          <div className="kz-map__legend">
            <span>0 БИН</span>
            <span className="kz-map__legend-gradient" aria-hidden="true" />
            <span>{maxRegionCount} БИН</span>
          </div>
        </div>
        <div className="analytics-banner__body">
          <RegionActivityMap features={GEOJSON_FEATURES} counts={regionCounts} />
        </div>
      </div>

      {/* фильтры */}
      <div className="dialogs-filters">
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
        <div className="dialogs-state-card">
          <span className="dialogs-state-card__icon dialogs-loading-pulse">💬</span>
          <p className="dialogs-state-card__title">Загружаем диалоги…</p>
        </div>
      ) : error ? (
        <div className="dialogs-state-card">
          <span className="dialogs-state-card__icon">⚠️</span>
          <p className="dialogs-state-card__title">Ошибка</p>
          <p className="dialogs-state-card__text">{error}</p>
          <button className="button" type="button" onClick={() => loadSectionsAndChats(true)}>Повторить попытку</button>
        </div>
      ) : filteredChats.length === 0 ? (
        <div className="dialogs-state-card">
          <span className="dialogs-state-card__icon">📭</span>
          <h3 className="dialogs-state-card__title">Нет активных диалогов</h3>
          <p className="dialogs-state-card__text">Сообщения из MobileBot появятся здесь автоматически.</p>
        </div>
      ) : (
        filteredChats.map((chat, i) => (
          <div
            key={`${chat.chatId}-${chat.dialogId}`}
            className="dialog-card"
            style={{ '--card-index': i } as React.CSSProperties}
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
                    onToggle={() => handleToggleFavorite(chat.dialogId, chat.isFavorite)}
                    title={chat.isFavorite ? "Убрать из избранного" : "В избранное"}
                  />
                </div>
                <div className="dialog-status-row">
                  <span className="text-muted">
                    {chat.username ? `@${chat.username}` : chat.type}
                  </span>
                  {renderStatusBadge(chat)}
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