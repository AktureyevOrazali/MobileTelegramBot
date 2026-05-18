import React, { useEffect, useState } from 'react';

interface LoadingEstimateProps {
  title: string;
  description?: string;
  typicalDurationLabel?: string;
  slowAfterSeconds?: number;
  elapsedSeconds?: number;
  className?: string;
}

export function formatLoadingElapsed(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  if (safeSeconds < 60) {
    return `${safeSeconds} сек`;
  }

  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return seconds > 0 ? `${minutes} мин ${seconds} сек` : `${minutes} мин`;
}

const LoadingEstimate: React.FC<LoadingEstimateProps> = ({
  title,
  description,
  typicalDurationLabel = '10-30 сек',
  slowAfterSeconds = 30,
  elapsedSeconds,
  className = '',
}) => {
  const [startedAt] = useState(() => Date.now());
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);
  const shownElapsedSeconds = elapsedSeconds ?? liveElapsedSeconds;
  const isSlow = shownElapsedSeconds > slowAfterSeconds;

  useEffect(() => {
    if (elapsedSeconds !== undefined) return undefined;

    const updateElapsed = () => {
      setLiveElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timerId);
  }, [elapsedSeconds, startedAt]);

  return (
    <div className={`loading-estimate ${className}`.trim()} role="status" aria-live="polite">
      <span className="loading-estimate__spinner" aria-hidden="true" />
      <div className="loading-estimate__content">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
        <span>Прошло {formatLoadingElapsed(shownElapsedSeconds)}</span>
        <small>
          {isSlow
            ? 'Данные еще обрабатываются, это может занять больше времени'
            : `Обычно занимает ${typicalDurationLabel}`}
        </small>
      </div>
    </div>
  );
};

export default LoadingEstimate;
