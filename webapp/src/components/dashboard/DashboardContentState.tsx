import React from 'react';
import LoadingEstimate from '../LoadingEstimate';

interface DashboardContentStateProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const DashboardContentState: React.FC<DashboardContentStateProps> = ({ loading, error, onRetry }) => {
  if (loading) {
    return (
      <div className="dashboard-loading-state">
        <LoadingEstimate
          title={'\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u0434\u0430\u043d\u043d\u044b\u0435 \u0434\u044d\u0448\u0431\u043e\u0440\u0434\u0430'}
          description={'\u0417\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u043c \u0441\u0432\u043e\u0434\u043a\u0443, \u0447\u0430\u0442\u044b \u0438 BIN-\u0434\u0430\u043d\u043d\u044b\u0435.'}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-loading-state">
        <div className="dashboard-loading-state__icon">{'\u26A0\uFE0F'}</div>
        <p>{`\u041E\u0448\u0438\u0431\u043A\u0430: ${error}`}</p>
        <button className="button" type="button" onClick={onRetry}>
          {'\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C \u043F\u043E\u043F\u044B\u0442\u043A\u0443'}
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard-loading-state">
      <div className="dashboard-loading-state__icon">{'\u{1F4CA}'}</div>
      <p>{'\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445.'}</p>
      <button className="button" type="button" onClick={onRetry}>
        {'\u041F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0441\u043D\u043E\u0432\u0430'}
      </button>
    </div>
  );
};

export default DashboardContentState;
