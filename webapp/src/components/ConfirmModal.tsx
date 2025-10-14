import React from 'react';
import Modal from './Modal';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  loading = false,
  tone = 'default',
  onConfirm,
  onCancel,
}) => {
  const confirmClass = tone === 'danger' ? 'button danger' : 'button';
  const icon =
    tone === 'danger' ? (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M9.4 3.2a1 1 0 0 0-.94.68L8 5H5a1 1 0 1 0 0 2h1.08l1.3 12.38A2 2 0 0 0 9.36 21h5.28a2 2 0 0 0 1.98-1.62L17.92 7H19a1 1 0 1 0 0-2h-3l-.46-1.12A1 1 0 0 0 14.64 3h-5.2ZM9 7h6l-1.2 11h-3.6L9 7Zm2 2v7a1 1 0 0 0 2 0V9a1 1 0 1 0-2 0Z"
          fill="currentColor"
        />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 5a3 3 0 0 1 3 3 2.73 2.73 0 0 1-1.26 2.3l-.48.32a1 1 0 0 0-.26.26.94.94 0 0 0-.12.38 1 1 0 0 1-2 0 2.81 2.81 0 0 1 .41-1.46 3.3 3.3 0 0 1 .94-.94 1 1 0 0 0 .51-.86 1 1 0 0 0-2 0 1 1 0 0 1-2 0 3 3 0 0 1 3-3Zm0 11a1.25 1.25 0 1 1 1.25-1.25A1.25 1.25 0 0 1 12 18Z"
          fill="currentColor"
        />
      </svg>
    );
  return (
    <Modal open={open} onClose={onCancel} className={`modal--confirm modal--confirm-${tone}`}>
      <div className="confirm-modal__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="modal__header">
        <h3 className="modal__title">{title}</h3>
      </div>
      {description && <div className="modal__description">{description}</div>}
      <div className="modal__actions">
        <button className="button secondary" type="button" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </button>
        <button className={confirmClass} type="button" onClick={onConfirm} disabled={loading}>
          {loading ? 'Подождите…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
