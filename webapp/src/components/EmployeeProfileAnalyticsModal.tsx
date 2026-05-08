import React from 'react';
import { ApiClient } from '../api/ApiClient';
import type { UserProfile } from '../types';
import Modal from './Modal';
import SurveyEntityAnalyticsPanel from './SurveyEntityAnalyticsPanel';

interface EmployeeProfileAnalyticsModalProps {
  open: boolean;
  user: UserProfile | null;
  apiClient: ApiClient;
  onClose: () => void;
}

const EmployeeProfileAnalyticsModal: React.FC<EmployeeProfileAnalyticsModalProps> = ({
  open,
  user,
  apiClient,
  onClose,
}) => {
  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

  return (
    <Modal open={open} onClose={onClose} className="employee-profile-modal__container modal--dialog">
      <div className="employee-profile-modal">
        <header className="employee-profile-modal__hero">
          <div className="employee-profile-modal__identity">
            <div className="employee-profile-modal__avatar" aria-hidden="true">{initials}</div>
            <div>
              <h3>{user?.name ?? 'Профиль сотрудника'}</h3>
              <p>{user?.email ?? '-'}</p>
            </div>
          </div>
          <div className="employee-profile-modal__meta">
            <span>{user?.role ?? '-'}</span>
            <span>{user?.login ?? '-'}</span>
          </div>
        </header>

        <div className="employee-profile-modal__body">
          <section className="employee-profile-modal__section">
            <div className="employee-profile-modal__section-head">
              <h4>Профиль</h4>
            </div>
            <div className="employee-profile-modal__profile-grid">
              <div>
                <span>Должность</span>
                <strong>{user?.jobTitle || '-'}</strong>
              </div>
              <div>
                <span>Телефон</span>
                <strong>{user?.phone || '-'}</strong>
              </div>
              <div>
                <span>Разделы</span>
                <strong>{user?.sections.length ?? 0}</strong>
              </div>
              <div>
                <span>БИНы</span>
                <strong>{user?.bins.length ?? 0}</strong>
              </div>
            </div>
          </section>

          <SurveyEntityAnalyticsPanel
            apiClient={apiClient}
            open={open}
            target={user ? { kind: 'employee', label: user.name, operatorName: user.name } : null}
          />
        </div>

        <div className="modal__actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default EmployeeProfileAnalyticsModal;
