import React from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession, ChatSummary } from '../types';
import SelectPill from '../components/SelectPill';
import ConfirmModal from '../components/ConfirmModal';
import ChatDetailModal from '../components/ChatDetailModal';
import DialogCard from '../components/DialogCard';
import RegionActivityMap from '../components/RegionActivityMap';
import { useDialogsData } from '../hooks/useDialogsData';

/* -------------------- Props -------------------- */
interface DialogsPageProps {
  apiClient: ApiClient;
  session: AuthSession;
}

/* -------------------- Page -------------------- */
const DialogsPage: React.FC<DialogsPageProps> = ({ apiClient, session }) => {
  const {
    filteredChats,
    regionCounts,
    rayonCounts,
    maxRegionCount,
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
          <RegionActivityMap counts={regionCounts} rayonCounts={rayonCounts} />
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
          <DialogCard
            key={`${chat.chatId}-${chat.dialogId}`}
            chat={chat}
            index={i}
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