import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DialogsPage from './DialogsPage';

const mockDialogsState = vi.hoisted(() => ({ current: {} as any }));

vi.mock('../hooks/useDialogsData', () => ({
  useDialogsData: () => mockDialogsState.current,
}));

const createDialogsState = () => ({
  filteredChats: [],
  loading: true,
  error: null,
  banner: null,
  setBanner: vi.fn(),
  activeChat: null,
  setActiveChat: vi.fn(),
  dialogToDelete: null,
  setDialogToDelete: vi.fn(),
  dialogDeleteLoading: false,
  aiToggleDialogId: null,
  dialogStatusTarget: null,
  setDialogStatusTarget: vi.fn(),
  dialogStatusLoading: false,
  canDeleteDialog: true,
  selectedSection: null,
  setSelectedSection: vi.fn(),
  selectedBin: null,
  setSelectedBin: vi.fn(),
  showFavoritesOnly: false,
  setShowFavoritesOnly: vi.fn(),
  sortOrder: 'desc',
  setSortOrder: vi.fn(),
  statusFilter: 'all',
  setStatusFilter: vi.fn(),
  sectionOptions: [{ value: '', label: 'All sections' }],
  binOptions: [{ value: '', label: 'All BINs' }],
  sortOptions: [{ value: 'desc', label: 'Newest' }],
  statusOptions: [{ value: 'all', label: 'All statuses' }],
  loadSectionsAndChats: vi.fn(),
  handleDialogDelete: vi.fn(),
  handleDialogStatusChange: vi.fn(),
  handleToggleAi: vi.fn(),
  handleToggleFavorite: vi.fn(),
  requestStatusChange: vi.fn(),
  renderStatusBadge: vi.fn(() => null),
});

describe('DialogsPage', () => {
  beforeEach(() => {
    mockDialogsState.current = createDialogsState();
  });

  it('renders fitted dialog skeleton rows while the list is loading', () => {
    const { container } = render(<DialogsPage apiClient={{} as any} session={{} as any} />);

    const loadingState = container.querySelector('.dialogs-loading-state--fit');

    expect(loadingState).toBeInTheDocument();
    expect(screen.getAllByTestId('dialog-row-skeleton')).toHaveLength(6);
  });
});
