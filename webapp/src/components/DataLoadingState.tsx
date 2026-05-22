import React from 'react';

type DataLoadingVariant =
  | 'adminUsers'
  | 'list'
  | 'grid'
  | 'table'
  | 'form'
  | 'chat'
  | 'dashboard'
  | 'page';

interface DataLoadingStateProps {
  title?: string;
  description?: string;
  className?: string;
  skeletonRows?: number;
  variant?: DataLoadingVariant;
}

const createItems = (count: number) => Array.from({ length: Math.max(0, count) }, (_, index) => index);
const delayStyle = (index: number) => ({ '--skeleton-index': index } as React.CSSProperties);

const SkeletonUnits: React.FC<{ count: number; className: string }> = ({ count, className }) => (
  <>
    {createItems(count).map((item) => (
      <div className={`skeleton-unit ${className}`} key={item} style={delayStyle(item)} />
    ))}
  </>
);

const DataLoadingState: React.FC<DataLoadingStateProps> = ({
  title = 'Загружаем данные',
  className = '',
  skeletonRows = 6,
  variant = 'list',
}) => {
  if (variant === 'adminUsers') {
    return (
      <div className={`admin-user-grid admin-user-grid--skeleton ${className}`.trim()} role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{title}</span>
        {createItems(skeletonRows).map((item) => (
          <div
            className="card admin-user-card admin-user-card--skeleton"
            data-testid="admin-user-card-skeleton"
            key={item}
            style={delayStyle(item)}
            aria-hidden="true"
          >
            <div className="admin-user-card-skeleton__header">
              <span className="admin-user-card-skeleton__line admin-user-card-skeleton__line--title" />
              <span className="admin-user-card-skeleton__pill" />
            </div>
            <span className="admin-user-card-skeleton__separator" />
            <div className="admin-user-card-skeleton__row">
              <span className="admin-user-card-skeleton__line admin-user-card-skeleton__line--wide" />
              <span className="admin-user-card-skeleton__button" />
            </div>
            <div className="admin-user-card-skeleton__actions">
              <span className="admin-user-card-skeleton__button" />
              <span className="admin-user-card-skeleton__button" />
            </div>
            <span className="admin-user-card-skeleton__line admin-user-card-skeleton__line--wide" />
            <div className="admin-user-card-skeleton__footer">
              <span className="admin-user-card-skeleton__button admin-user-card-skeleton__button--wide" />
              <span className="admin-user-card-skeleton__button admin-user-card-skeleton__button--short" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'chat') {
    return (
      <div className={`data-loading-state data-loading-state--chat ${className}`.trim()} role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{title}</span>
        {createItems(skeletonRows).map((item) => (
          <div
            className={`skeleton-unit skeleton-unit--chat ${item % 3 === 1 ? 'skeleton-unit--chat-out' : ''}`}
            key={item}
            style={delayStyle(item)}
          />
        ))}
      </div>
    );
  }

  const wrapperClassName = `data-loading-state data-loading-state--${variant} ${className}`.trim();

  return (
    <div className={wrapperClassName} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{title}</span>
      <SkeletonUnits count={skeletonRows} className={`skeleton-unit--${variant}`} />
    </div>
  );
};

export default DataLoadingState;
