import React from 'react';
import Modal from './Modal';
import { buttonPrimaryClass, buttonSecondaryClass, buttonBaseClass, headingClass, mutedTextClass } from '../ui/primitives';
import { cn } from '../utils/cn';

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

const dangerButtonClass = cn(
  buttonBaseClass,
  'bg-rose-500 text-white hover:bg-rose-600 active:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-400',
);

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
  const confirmClass = tone === 'danger' ? dangerButtonClass : buttonPrimaryClass;
  return (
    <Modal open={open} onClose={onCancel} className="max-w-md">
      <div className="space-y-6">
        <div className="space-y-2">
          <h3 className={cn(headingClass, 'text-xl')}>{title}</h3>
          {description && <div className={cn(mutedTextClass, 'leading-relaxed')}>{description}</div>}
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button className={buttonSecondaryClass} type="button" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button className={confirmClass} type="button" onClick={onConfirm} disabled={loading}>
            {loading ? 'Подождите…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmModal;