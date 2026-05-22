import React from 'react';
import type { DashboardTab } from '../../hooks/useDashboardData';

interface DashboardSkeletonStateProps {
  tab: DashboardTab;
}

const skeletonStyle = (index: number) => ({ '--skeleton-index': index } as React.CSSProperties);

const Card: React.FC<{ children: React.ReactNode; className?: string; index?: number }> = ({ children, className = '', index = 0 }) => (
  <div
    className={`dashboard-card dashboard-card--loading dashboard-card--skeleton ${className}`.trim()}
    data-testid="dashboard-card-skeleton"
    style={skeletonStyle(index)}
  >
    {children}
  </div>
);

const Title = ({ width = '44%' }: { width?: string }) => (
  <span className="dashboard-skeleton-line dashboard-skeleton-line--title" style={{ width }} />
);

const Line = ({ width = '100%' }: { width?: string }) => (
  <span className="dashboard-skeleton-line" style={{ width }} />
);

const Chart = ({ className = '' }: { className?: string }) => (
  <div className={`dashboard-skeleton-chart ${className}`.trim()} />
);

const Table = ({ rows = 6 }: { rows?: number }) => (
  <div className="table-scroll dashboard-table-skeleton">
    <table className="dashboard-table" aria-hidden="true">
      <thead>
        <tr>
          <th><Line width="74%" /></th>
          <th><Line width="58%" /></th>
          <th><Line width="70%" /></th>
          <th><Line width="48%" /></th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, index) => (
          <tr key={index}>
            <td><Line width="78%" /></td>
            <td><Line width="42%" /></td>
            <td><Line width="92%" /></td>
            <td><Line width="52%" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Legend = ({ rows = 4 }: { rows?: number }) => (
  <div className="dashboard-legend dashboard-legend--skeleton" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => (
      <div className="dashboard-legend-row" key={index}>
        <div className="dashboard-legend-left">
          <span className="dashboard-skeleton-dot" />
          <Line width={index % 2 === 0 ? '58%' : '44%'} />
        </div>
        <div className="dashboard-legend-right">
          <Line width="36px" />
        </div>
      </div>
    ))}
  </div>
);

const OverviewSkeleton = () => (
  <>
    <Card className="dashboard-card--map" index={0}>
      <div className="dashboard-map-widget__header">
        <div>
          <Line width="84px" />
          <Title width="320px" />
        </div>
        <Line width="132px" />
      </div>
      <div className="dashboard-map-widget__body">
        <Chart className="dashboard-skeleton-chart--map" />
      </div>
    </Card>

    <div className="dashboard-overview-row">
      <Card index={1}>
        <div className="dashboard-speed__header">
          <Title width="150px" />
          <Line width="96px" />
        </div>
        <div className="dashboard-donut-col">
          <div className="dashboard-skeleton-donut" />
          <Legend rows={4} />
        </div>
      </Card>
      <Card className="dashboard-card--delay-1" index={2}>
        <Title width="130px" />
        <div className="dashboard-kv dashboard-kv--skeleton">
          {Array.from({ length: 6 }, (_, index) => (
            <React.Fragment key={index}>
              <Line width={index % 2 === 0 ? '48%' : '36%'} />
              <Line width="44px" />
            </React.Fragment>
          ))}
        </div>
      </Card>
    </div>

    <div className="dashboard-overview-row">
      <Card className="dashboard-card--delay-2" index={3}>
        <Title width="180px" />
        <Chart />
        <Legend rows={4} />
      </Card>
      <Card className="dashboard-card--delay-3" index={4}>
        <Title width="220px" />
        <Chart className="dashboard-skeleton-chart--gauge" />
        <Legend rows={3} />
      </Card>
    </div>

    <div className="dashboard-overview-row">
      <Card className="dashboard-card--delay-3 dashboard-card--rating" index={5}>
        <Title width="210px" />
        <div className="dashboard-rating">
          <div className="dashboard-rating__summary">
            <Line width="82px" />
            <Line width="120px" />
            <Line width="92px" />
          </div>
          <Chart />
        </div>
      </Card>
      <Card className="dashboard-card--delay-3 dashboard-card--rating" index={6}>
        <Title width="190px" />
        <div className="dashboard-rating">
          <div className="dashboard-rating__summary">
            <Line width="82px" />
            <Line width="120px" />
            <Line width="92px" />
          </div>
          <Chart />
        </div>
      </Card>
    </div>
  </>
);

const OperatorsSkeleton = () => (
  <div className="dashboard-columns">
    <Card index={0}>
      <div className="dashboard-card__header">
        <Title width="92px" />
        <Line width="220px" />
      </div>
      <Chart />
    </Card>
    <Card className="dashboard-card--delay-1" index={1}>
      <Title width="230px" />
      <Table />
    </Card>
  </div>
);

const SectionsSkeleton = () => (
  <div className="dashboard-columns">
    <Card index={0}>
      <Title width="220px" />
      <Chart />
      <Legend rows={5} />
    </Card>
    <Card className="dashboard-card--delay-1" index={1}>
      <div className="dashboard-card__header">
        <Title width="160px" />
        <Line width="220px" />
      </div>
      <Chart />
    </Card>
  </div>
);

const ActivitySkeleton = () => (
  <Card index={0}>
    <Title width="220px" />
    <Chart className="dashboard-skeleton-chart--wide" />
  </Card>
);

const CommercialSkeleton = () => (
  <div className="dashboard-columns">
    <Card index={0}>
      <Title width="180px" />
      <div className="dashboard-donut-col">
        <div className="dashboard-skeleton-donut" />
        <Legend rows={4} />
      </div>
      <div className="dashboard-card__header">
        <Line width="120px" />
        <Line width="170px" />
      </div>
      <Chart className="dashboard-skeleton-chart--compact" />
    </Card>
    <Card className="dashboard-card--delay-1 flex-1" index={1}>
      <Title width="300px" />
      <div className="dashboard-heatmap-skeleton">
        {Array.from({ length: 84 }, (_, index) => (
          <span className="dashboard-heatmap-skeleton__cell" key={index} />
        ))}
      </div>
      <Line width="220px" />
    </Card>
  </div>
);

const DashboardSkeletonState: React.FC<DashboardSkeletonStateProps> = ({ tab }) => {
  if (tab === 'operators') return <OperatorsSkeleton />;
  if (tab === 'sections') return <SectionsSkeleton />;
  if (tab === 'activity') return <ActivitySkeleton />;
  if (tab === 'commercial') return <CommercialSkeleton />;
  return <OverviewSkeleton />;
};

export default DashboardSkeletonState;
