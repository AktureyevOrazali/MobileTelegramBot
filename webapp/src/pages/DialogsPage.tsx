import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession, ChatSummary } from '../types';
import SelectPill from '../components/SelectPill';
import ConfirmModal from '../components/ConfirmModal';
import DialogCard from '../components/DialogCard';
import InlineChatPanel from '../components/InlineChatPanel';
import Modal from '../components/Modal';
import { useDialogsData } from '../hooks/useDialogsData';

interface DialogsPageProps {
  apiClient: ApiClient;
  session: AuthSession;
}

const LIST_PANEL_COLLAPSE_STORAGE_KEY = 'mobilebot-dialogs-list-collapsed';

const getCollapsedRailLabel = (chat: ChatSummary): string => {
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

const DialogsPage: React.FC<DialogsPageProps> = ({ apiClient, session }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isListCollapsed, setIsListCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      return window.localStorage.getItem(LIST_PANEL_COLLAPSE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LIST_PANEL_COLLAPSE_STORAGE_KEY, isListCollapsed ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [isListCollapsed]);

  useEffect(() => {
    if (!isSearchOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isSearchOpen]);

  const {
    filteredChats,
    loading,
    error,
    banner,
    setBanner,
    activeChat,
    setActiveChat,
    dialogToDelete,
    setDialogToDelete,
    dialogDeleteLoading,
    aiToggleDialogId,
    dialogStatusTarget,
    setDialogStatusTarget,
    dialogStatusLoading,
    canDeleteDialog,
    selectedSection,
    setSelectedSection,
    selectedBin,
    setSelectedBin,
    showFavoritesOnly,
    setShowFavoritesOnly,
    sortOrder,
    setSortOrder,
    statusFilter,
    setStatusFilter,
    sectionOptions,
    binOptions,
    sortOptions,
    statusOptions,
    loadSectionsAndChats,
    handleDialogDelete,
    handleDialogStatusChange,
    handleToggleAi,
    handleToggleFavorite,
    requestStatusChange,
    renderStatusBadge,
  } = useDialogsData(apiClient, session);

  const handleOpenChat = (chat: ChatSummary) => {
    if (chat.unreadCount > 0) {
      setActiveChat({ ...chat, unreadCount: 0 });
    } else {
      setActiveChat(chat);
    }
  };

  const visibleChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return filteredChats;

    return filteredChats.filter((chat) => {
      const haystack = [
        chat.title,
        chat.username,
        chat.bin,
        chat.sectionTitle,
        chat.lastMessageText,
        chat.lastMessageAuthor,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [filteredChats, searchQuery]);

  const collapsedRailChats = useMemo(() => visibleChats.slice(0, 6), [visibleChats]);


  const findOptionLabel = (options: Array<{ value: string; label: string }>, value: string | null) =>
    options.find((option) => option.value === (value ?? ''))?.label ?? '';

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];

    if (selectedSection) {
      chips.push(findOptionLabel(sectionOptions, selectedSection));
    }
    if (selectedBin) {
      chips.push(`БИН ${selectedBin}`);
    }

    if (statusFilter !== 'all') {
      chips.push(findOptionLabel(statusOptions, statusFilter));
    }

    if (sortOrder !== 'desc') {
      chips.push(findOptionLabel(sortOptions, sortOrder));
    }
    if (showFavoritesOnly) {
      chips.push('Только избранные');
    }

    return chips.filter(Boolean);
  }, [sectionOptions, selectedSection, selectedBin, showFavoritesOnly, sortOptions, sortOrder, statusFilter, statusOptions]);

  const resetFilters = () => {
    setSelectedSection(null);
    setSelectedBin(null);
    setShowFavoritesOnly(false);
    setSortOrder('desc');
    setStatusFilter('all');
  };



  return (
    <div className={`dialogs-page dialogs-page--messenger dialogs-page--app-sidebar dialogs-page--minimal dialogs-page--reference ${isListCollapsed ? 'dialogs-page--list-collapsed' : ''}`}>
      {banner && <div className="dialogs-banner" onAnimationEnd={() => setBanner(null)}>{banner}</div>}

      <section className={`dialogs-workspace dialogs-workspace--main dialogs-workspace--chat ${isListCollapsed ? 'dialogs-workspace--list-collapsed' : ''}`}>
        <section className={`dialogs-list-panel dialogs-list-panel--minimal dialogs-list-panel--reference ${isListCollapsed ? 'is-collapsed' : ''}`}>
          <header className={`dialogs-list-panel__header dialogs-list-panel__header--minimal dialogs-list-panel__header--reference ${isSearchOpen && !isListCollapsed ? 'is-search-open' : ''}`}>
            {!isListCollapsed && (
              <div className="dialogs-list-panel__header-copy">
                <h2 className="dialogs-list-panel__title">Сообщения</h2>
              </div>
            )}

            <div className="dialogs-list-panel__header-controls">
              {!isListCollapsed && (
                <label
                  className={`dialogs-search dialogs-search--minimal dialogs-search--reference dialogs-search--expanded dialogs-search--overlay ${isSearchOpen ? 'is-open' : ''}`}
                  aria-label="Поиск по диалогам"
                  aria-hidden={!isSearchOpen}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск"
                    tabIndex={isSearchOpen ? 0 : -1}
                  />
                </label>
              )}
              {!isListCollapsed && (
                <button
                  type="button"
                  className={`panel-collapse-toggle panel-collapse-toggle--search ${isSearchOpen ? 'is-active' : ''}`}
                  onClick={() => {
                    if (isSearchOpen) {
                      setIsSearchOpen(false);
                      setSearchQuery('');
                      return;
                    }
                    setIsSearchOpen(true);
                  }}
                  aria-label={isSearchOpen ? 'Скрыть поиск' : 'Показать поиск'}
                  title={isSearchOpen ? 'Скрыть поиск' : 'Показать поиск'}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className={`panel-collapse-toggle panel-collapse-toggle--list ${isListCollapsed ? 'is-collapsed' : ''}`}
                onClick={() => {
                  setIsListCollapsed((prev) => {
                    const next = !prev;
                    if (next) {
                      setIsSearchOpen(false);
                      setSearchQuery('');
                    }
                    return next;
                  });
                }}
                aria-label={isListCollapsed ? 'Развернуть список диалогов' : 'Свернуть список диалогов'}
                title={isListCollapsed ? 'Развернуть список диалогов' : 'Свернуть список диалогов'}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12.5 4.5-5 5 5 5" />
                </svg>
              </button>
            </div>
          </header>

          <div className={`dialogs-list-panel__expanded-content ${isListCollapsed ? 'is-hidden' : ''}`}>
            <div className="dialogs-filters dialogs-filters--inline dialogs-filters--minimal dialogs-filters--reference">
              <div className="controls-row controls-row--minimal controls-row--reference controls-row--dialogs-main">
                <SelectPill
                  label=""
                  showLabelInside={false}
                  options={sectionOptions}
                  value={selectedSection ?? ''}
                  onChange={(value) => setSelectedSection(value || null)}
                  style={{ minWidth: 0, flex: '1 1 140px' }}
                />
                <SelectPill
                  label=""
                  showLabelInside={false}
                  options={binOptions}
                  value={selectedBin ?? ''}
                  onChange={(value) => setSelectedBin(value || null)}
                  searchable
                  style={{ minWidth: 0, flex: '1.2 1 150px' }}
                />
                <button
                  type="button"
                  className={`dialogs-filters__icon-btn ${showFavoritesOnly ? 'dialogs-filters__icon-btn--active' : ''}`}
                  onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                  aria-label="Только избранные"
                  title="Только избранные"
                >
                  <svg viewBox="0 0 24 24" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px' }}>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`dialogs-filters__icon-btn ${activeFilterChips.length > 0 ? 'dialogs-filters__icon-btn--active' : ''}`}
                  onClick={() => setFiltersOpen(true)}
                  aria-label="Все фильтры"
                  title="Настроить фильтры"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px' }}>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {activeFilterChips.length > 0 && (
                    <span className="dialogs-filters__button-badge">{activeFilterChips.length}</span>
                  )}
                </button>
              </div>
            </div>

            <div className="dialogs-list-panel__scroll dialogs-list-panel__scroll--minimal dialogs-list-panel__scroll--reference">
              {loading ? (
                <div className="dialogs-state-card">
                  <span className="dialogs-state-card__icon dialogs-loading-pulse">⏳</span>
                  <p className="dialogs-state-card__title">Загрузка диалогов...</p>
                </div>
              ) : error ? (
                <div className="dialogs-state-card">
                  <span className="dialogs-state-card__icon">⚠️</span>
                  <p className="dialogs-state-card__title">Ошибка</p>
                  <p className="dialogs-state-card__text">{error}</p>
                  <button className="button" type="button" onClick={() => loadSectionsAndChats(true)}>Повторить попытку</button>
                </div>
              ) : visibleChats.length === 0 ? (
                <div className="dialogs-state-card">
                  <span className="dialogs-state-card__icon">🔍</span>
                  <h3 className="dialogs-state-card__title">{searchQuery ? "Ничего не найдено" : "Нет активных диалогов"}</h3>
                  <p className="dialogs-state-card__text">
                    {searchQuery
                      ? "Попробуйте изменить запрос или сбросить фильтры."
                      : "Диалоги появятся здесь, как только клиенты напишут."}
                  </p>
                </div>
              ) : (
                visibleChats.map((chat, index) => (
                  <DialogCard
                    key={`${chat.chatId}-${chat.dialogId}`}
                    chat={chat}
                    index={index}
                    isActive={activeChat?.dialogId === chat.dialogId}
                    aiToggleDialogId={aiToggleDialogId}
                    canDeleteDialog={canDeleteDialog}
                    statusBadge={renderStatusBadge(chat)}
                    onOpenChat={handleOpenChat}
                    onToggleAi={handleToggleAi}
                    onToggleFavorite={handleToggleFavorite}
                    onDeleteRequest={setDialogToDelete}
                  />
                ))
              )}
            </div>
          </div>

          <div className={`dialogs-list-panel__collapsed-actions ${isListCollapsed ? 'is-visible' : ''}`}>
            <button
              type="button"
              className={`dialogs-list-panel__rail-button ${activeFilterChips.length > 0 ? 'dialogs-list-panel__rail-button--active' : ''}`}
              onClick={() => setFiltersOpen(true)}
              aria-label="Настроить фильтры"
              title="Настроить фильтры"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              {activeFilterChips.length > 0 && (
                <span className="dialogs-list-panel__rail-badge">{activeFilterChips.length}</span>
              )}
            </button>
            {collapsedRailChats.length > 0 && (
              <div className="dialogs-list-panel__rail-chats">
                {collapsedRailChats.map((chat) => (
                  <button
                    key={`${chat.chatId}-${chat.dialogId}`}
                    type="button"
                    className={`dialogs-list-panel__rail-avatar ${activeChat?.dialogId === chat.dialogId ? 'dialogs-list-panel__rail-avatar--active' : ''}`}
                    style={{ "--avatar-bg": getAvatarColor(chat.title || chat.username || "Клиент") } as React.CSSProperties}
                    onClick={() => handleOpenChat(chat)}
                    aria-label={`Открыть чат ${chat.title}`}
                    title={chat.title}
                  >
                    {getCollapsedRailLabel(chat)}
                    {chat.unreadCount > 0 && <span className="dialogs-list-panel__rail-chat-badge">{chat.unreadCount}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>


        <aside className="dialogs-side-panel dialogs-side-panel--main dialogs-side-panel--chat dialogs-side-panel--minimal dialogs-side-panel--reference">
          <InlineChatPanel
            apiClient={apiClient}
            chat={activeChat}
            onToggleAi={handleToggleAi}
            onToggleStatus={requestStatusChange}
          />
        </aside>
      </section>

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

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} className="dialogs-filters-modal">
        <div className="dialogs-filters-modal__header">
          <div>
            <h3 className="modal__title">Фильтры диалогов</h3>
            <p className="modal__description">Все параметры собраны в одном месте, чтобы верхняя панель оставалась в одну строку.</p>
          </div>
          <button
            type="button"
            className="dialogs-filters-modal__close"
            onClick={() => setFiltersOpen(false)}
            aria-label="Закрыть фильтры"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        </div>

        <div className="dialogs-filters-modal__grid">
          <div className="dialogs-filters-modal__field">
            <span className="dialogs-filters-modal__label">Раздел</span>
            <SelectPill
              label=""
              showLabelInside={false}
              options={sectionOptions}
              value={selectedSection ?? ''}
              onChange={(value) => setSelectedSection(value || null)}
              style={{ width: '100%' }}
            />
          </div>

          <div className="dialogs-filters-modal__field">
            <span className="dialogs-filters-modal__label">БИН</span>
            <SelectPill
              label=""
              showLabelInside={false}
              options={binOptions}
              value={selectedBin ?? ''}
              onChange={(value) => setSelectedBin(value || null)}
              searchable
              style={{ width: '100%' }}
            />
          </div>

          <div className="dialogs-filters-modal__field">
            <span className="dialogs-filters-modal__label">Статус</span>
            <SelectPill
              label=""
              showLabelInside={false}
              options={statusOptions}
              value={statusFilter}
              onChange={(value) => setStatusFilter((value as 'all' | 'open' | 'closed') || 'all')}
              style={{ width: '100%' }}
            />
          </div>

          <div className="dialogs-filters-modal__field">
            <span className="dialogs-filters-modal__label">Сортировка</span>
            <SelectPill
              label=""
              showLabelInside={false}
              options={sortOptions}
              value={sortOrder}
              onChange={(value) => setSortOrder((value as 'asc' | 'desc') || 'desc')}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div className="dialogs-filters-modal__actions">
          <button type="button" className="dialogs-filters-modal__secondary" onClick={resetFilters}>
            Сбросить
          </button>
          <button type="button" className="button" onClick={() => setFiltersOpen(false)}>
            Готово
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default DialogsPage;
