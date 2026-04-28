import React from 'react';
import Modal from '../Modal';
import type { SurveyTemplate } from '../../types';

interface SurveyLaunchSettingsModalProps {
  open: boolean;
  onClose: () => void;
  draft: Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>;
  setDraft: React.Dispatch<React.SetStateAction<Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>>;
}

export const SurveyLaunchSettingsModal: React.FC<SurveyLaunchSettingsModalProps> = ({
  open,
  onClose,
  draft,
  setDraft,
}) => {
  const setPreset = (kind: 'month_start' | 'after_appeal_closed' | 'custom_date') => {
    setDraft((current) => {
      if (kind === 'month_start') {
        return {
          ...current,
          triggerType: 'periodic',
          scheduledAt: null,
          launchRules: [{ type: 'calendar', schedule: 'month_start', dates: [] }],
        };
      }

      if (kind === 'custom_date') {
        return {
          ...current,
          triggerType: 'periodic',
          launchRules: [{ type: 'calendar', schedule: 'custom_dates', dates: current.scheduledAt ? [current.scheduledAt] : [] }],
        };
      }

      return {
        ...current,
        triggerType: 'after_appeal_closed',
        scheduledAt: null,
        launchRules: [{ type: 'after_appeal_closed', dates: [] }],
      };
    });
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="surveys-launch-modal">
        <div className="modal__header">
          <h2 className="modal__title">Настройки запуска</h2>
          <p className="modal__description">Выберите когда запускать опрос.</p>
        </div>

        <div className="surveys-actions">
          <button type="button" className="surveys-button" onClick={() => setPreset('month_start')}>Начало месяца</button>
          <button type="button" className="surveys-button" onClick={() => setPreset('after_appeal_closed')}>После обращения</button>
          <button type="button" className="surveys-button" onClick={() => setPreset('custom_date')}>Своя дата</button>
        </div>

        <label className="surveys-field">
          <span>Дата запуска</span>
          <input
            aria-label="Дата запуска"
            type="date"
            value={draft.scheduledAt ?? ''}
            onChange={(event) => setDraft((current) => ({
              ...current,
              triggerType: 'periodic',
              scheduledAt: event.target.value || null,
              launchRules: [{ type: 'calendar', schedule: 'custom_dates', dates: event.target.value ? [event.target.value] : [] }],
            }))}
          />
        </label>

        <div className="modal__actions">
          <button type="button" className="surveys-button" onClick={onClose}>Отмена</button>
          <button type="button" className="surveys-button surveys-button--primary" onClick={onClose}>Сохранить настройки запуска</button>
        </div>
      </div>
    </Modal>
  );
};
