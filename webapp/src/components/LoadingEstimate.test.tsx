import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LoadingEstimate, { formatLoadingElapsed } from './LoadingEstimate';

describe('LoadingEstimate', () => {
  it('shows elapsed time and the normal duration hint', () => {
    render(
      <LoadingEstimate
        title="Загружаем БИНы из госзакупа"
        elapsedSeconds={12}
        typicalDurationLabel="10-30 сек"
      />,
    );

    expect(screen.getByText('Загружаем БИНы из госзакупа')).toBeInTheDocument();
    expect(screen.getByText('Прошло 12 сек')).toBeInTheDocument();
    expect(screen.getByText('Обычно занимает 10-30 сек')).toBeInTheDocument();
  });

  it('uses the long-running hint after the estimate is exceeded', () => {
    render(
      <LoadingEstimate
        title="Загружаем аналитику опросов"
        elapsedSeconds={34}
        slowAfterSeconds={30}
      />,
    );

    expect(screen.getByText('Прошло 34 сек')).toBeInTheDocument();
    expect(screen.getByText('Данные еще обрабатываются, это может занять больше времени')).toBeInTheDocument();
  });
});

describe('formatLoadingElapsed', () => {
  it('formats seconds and minutes', () => {
    expect(formatLoadingElapsed(9)).toBe('9 сек');
    expect(formatLoadingElapsed(75)).toBe('1 мин 15 сек');
  });
});
