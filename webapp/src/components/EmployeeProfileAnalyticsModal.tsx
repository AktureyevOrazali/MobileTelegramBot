import React from 'react';
import { ApiClient } from '../api/ApiClient';
import type { UserProfile } from '../types';
import Modal from './Modal';

interface EmployeeProfileAnalyticsModalProps {
  open: boolean;
  user: UserProfile | null;
  apiClient: ApiClient;
  onClose: () => void;
}

const EmployeeProfileAnalyticsModal: React.FC<EmployeeProfileAnalyticsModalProps> = ({
  open,
  user,
  apiClient: _apiClient,
  onClose,
}) => {
  return (
    <Modal open={open} onClose={onClose} className="modal--dialog">
      <div className="modal__header">
        <h3 className="modal__title">Профиль сотрудника</h3>
      </div>
      <div className="modal__description">
        <div style={{ display: 'grid', gap: 8 }}>
          <div><strong>Имя:</strong> {user?.name ?? '-'}</div>
          <div><strong>Email:</strong> {user?.email ?? '-'}</div>
          <div><strong>Логин:</strong> {user?.login ?? '-'}</div>
          <div><strong>Роль:</strong> {user?.role ?? '-'}</div>
          <div><strong>Должность:</strong> {user?.jobTitle ?? '-'}</div>
          <div><strong>Телефон:</strong> {user?.phone ?? '-'}</div>
        </div>
      </div>
      <div className="modal__actions">
        <button className="button secondary" type="button" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Modal>
  );
};

export default EmployeeProfileAnalyticsModal;
