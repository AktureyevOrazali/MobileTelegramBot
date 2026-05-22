import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataLoadingState from './DataLoadingState';

describe('DataLoadingState', () => {
  it('renders visible skeleton pieces inside admin user cards', () => {
    const { container } = render(<DataLoadingState variant="adminUsers" skeletonRows={2} />);

    expect(container.querySelectorAll('.admin-user-card--skeleton')).toHaveLength(2);
    expect(screen.getAllByTestId('admin-user-card-skeleton')).toHaveLength(2);
    expect(container.querySelectorAll('.admin-user-card-skeleton__line').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.admin-user-card-skeleton__button').length).toBeGreaterThan(0);
  });
});
