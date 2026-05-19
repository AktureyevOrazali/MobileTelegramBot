import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HrPage from './HrPage';
import { hrRequests, hrTemplates } from './hr/hrMockData';

describe('HrPage', () => {
  it('renders compact header stats and HR tabs', () => {
    render(<HrPage />);

    expect(screen.getByRole('heading', { name: 'Кадры' })).toBeInTheDocument();
    expect(screen.getByText('Новые заявления')).toBeInTheDocument();
    expect(screen.getByText('Отпуска на неделе')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Заявления' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Сотрудники' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Календарь' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Шаблоны' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Архив' })).toBeInTheDocument();
  });

  it('switches tabs without leaving the HR page shell', () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));

    expect(screen.getByRole('tab', { name: 'Сотрудники' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hr-page-shell')).toBeInTheDocument();
  });

  it('shows request details and quick actions on the requests tab', () => {
    render(<HrPage />);

    expect(screen.getByText(hrRequests[0].summary)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Одобрить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Запросить данные' })).toBeInTheDocument();
  });

  it('shows equal-grid employee cards on the employees tab', () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));

    expect(screen.getByText('Арман Темирланов')).toBeInTheDocument();
    expect(screen.getAllByText('Документы неполные').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('hr-employee-card').length).toBeGreaterThanOrEqual(6);
  });

  it('shows calendar, templates, and archive content', () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Календарь' }));
    expect(screen.getByText('Пн 18')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Шаблоны' }));
    expect(screen.getAllByText(hrTemplates[0].title).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));
    expect(screen.getByRole('columnheader', { name: /Дата/ })).toBeInTheDocument();
  });
});
