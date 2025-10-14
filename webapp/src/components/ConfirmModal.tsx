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
  return (
    <Modal open={open} onClose={onCancel} className="modal--confirm">
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