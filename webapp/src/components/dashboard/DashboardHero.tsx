import React from 'react';

import type { ApiClient } from '../../api/ApiClient';
import SelectPill from '../SelectPill';
import { useDashboardData, type DashboardTab, type TimePreset } from '../../hooks/useDashboardData';

const DASHBOARD_TABS: ReadonlyArray<{ key: DashboardTab; icon: string; label: string }> = [
  { key: 'overview', icon: '\u{1F4CA}', label: '\u041E\u0431\u0437\u043E\u0440' },
  { key: 'operators', icon: '\u{1F465}', label: '\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0438' },
  { key: 'sections', icon: '\u{1F4C2}', label: '\u0420\u0430\u0437\u0434\u0435\u043B\u044B' },
  { key: 'activity', icon: '\u{1F4C8}', label: '\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C' },
  { key: 'commercial', icon: '\u{1F4BC}', label: '\u0410\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0430' },
];

interface DashboardHeroProps {
  apiClient: ApiClient;
  dashboard: ReturnType<typeof useDashboardData>;
  lastUpdated: string;
}

const ExportButton: React.FC<{
  apiClient: ApiClient;
  filters: { operatorId?: number | null; startDate?: string | null; endDate?: string | null };
}> = ({ apiClient, filters }) => {
  const [exporting, setExporting] = React.useState<'xlsx' | 'pdf' | null>(null);

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    setExporting(format);
    try {
      await apiClient.downloadDashboardExport({
        operatorId: filters.operatorId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        format,
      });
    } catch {
      alert('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u0430\u0447\u0430\u0442\u044C \u043E\u0442\u0447\u0435\u0442.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <button
        className="dashboard-hero__refresh dashboard-hero__refresh--export"
        type="button"
        onClick={() => handleExport('xlsx')}
        disabled={exporting !== null}
      >
        {exporting === 'xlsx' ? '\u23F3\u2026' : '\u{1F4E5} Excel'}
      </button>
      <button
        className="dashboard-hero__refresh dashboard-hero__refresh--export"
        type="button"
        onClick={() => handleExport('pdf')}
        disabled={exporting !== null}
      >
        {exporting === 'pdf' ? '\u23F3\u2026' : '\u{1F4C4} PDF'}
      </button>
    </>
  );
};

const DashboardHero: React.FC<DashboardHeroProps> = ({ apiClient, dashboard: d, lastUpdated }) => (
  <div className={`dashboard-hero ${d.isLoading ? 'dashboard-hero--loading' : ''}`}>
    <div className="dashboard-hero__top">
      <div className="dashboard-hero__meta">
        <h2 className="dashboard-hero__title">{'\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430'}</h2>
        <p className="dashboard-hero__sub">
          {`${d.selectedOperatorLabel} \u00B7 ${d.timeRange.label}${lastUpdated ? ` \u00B7 ${lastUpdated}` : ''}`}
        </p>
      </div>

      <div className="dashboard-hero__controls">
        <div className="dashboard-hero__controls-group dashboard-hero__controls-group--filters">
          <SelectPill
            label=""
            options={d.periodOptions}
            value={d.effectiveTimePreset}
            onChange={(value) => {
              const next = (value as TimePreset) || 'last7';
              if (next === 'custom') {
                d.setCustomRange((prev) => ({
                  start: prev.start || d.timeRange.startDate || '',
                  end: prev.end || d.timeRange.endDate || '',
                }));
                d.setTimePreset('custom');
                return;
              }
              d.setTimePreset(next);
            }}
            showLabelInside={false}
          />

          <SelectPill
            label={d.operatorsLoading ? '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026' : ''}
            options={d.operatorOptions}
            value={d.operatorSelectValue}
            onChange={(value) => {
              const nextValue = value === 'all' ? null : Number(value);
              d.setSelectedOperatorId((prev) => (prev === nextValue ? prev : nextValue));
            }}
            searchable
            showLabelInside={false}
            disabled={d.dashboardTab === 'operators'}
          />
        </div>

        <div className="dashboard-hero__controls-group dashboard-hero__controls-group--actions">
          <button
            className="dashboard-hero__refresh dashboard-hero__refresh--primary"
            type="button"
            onClick={() => d.loadData('refresh', d.activeFilters)}
            disabled={d.refreshing}
          >
            {d.refreshing ? '\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u043C\u2026' : '\u21BB \u041F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u0442\u044C'}
          </button>
          <ExportButton apiClient={apiClient} filters={d.activeFilters} />
        </div>
      </div>
    </div>

    {(d.operatorsError || d.error) && (
      <div className="dashboard-hero__errors">
        {d.operatorsError && <span className="dashboard-hero__error">{d.operatorsError}</span>}
        {d.error && <span className="dashboard-hero__error">{d.error}</span>}
      </div>
    )}

    {d.timePreset === 'custom' && (
      <div className="dashboard-date-row">
        <input
          type="date"
          value={d.customRange.start}
          onChange={(event) => {
            d.setCustomRange((prev) => ({ ...prev, start: event.target.value }));
            d.setTimePreset('custom');
          }}
        />
        <span className="text-muted">{'\u2014'}</span>
        <input
          type="date"
          value={d.customRange.end}
          onChange={(event) => {
            d.setCustomRange((prev) => ({ ...prev, end: event.target.value }));
            d.setTimePreset('custom');
          }}
        />
      </div>
    )}

    <div className="dashboard-tabs">
      {DASHBOARD_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`dashboard-tab ${d.dashboardTab === tab.key ? 'is-active' : ''}`}
          onClick={() => d.setDashboardTab(tab.key)}
        >
          <span className="dashboard-tab__icon" aria-hidden="true">{tab.icon}</span>
          <span className="dashboard-tab__label">{tab.label}</span>
        </button>
      ))}
    </div>
  </div>
);

export default DashboardHero;
