import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAdminData } from './useAdminData';

describe('useAdminData', () => {
  it('loads admin data without waiting for a slow BIN contract sync', async () => {
    const slowSync = new Promise(() => {});
    const apiClient = {
      syncBinsWithContracts: vi.fn(() => slowSync),
      fetchRoles: vi.fn().mockResolvedValue([]),
      fetchUsers: vi.fn().mockResolvedValue([]),
      fetchSections: vi.fn().mockResolvedValue([]),
      fetchBins: vi.fn().mockResolvedValue([]),
      fetchUnassignedBins: vi.fn().mockResolvedValue([]),
      fetchPendingRegistrations: vi.fn().mockResolvedValue([]),
      fetchOrganizationsWithoutContracts: vi.fn().mockResolvedValue([]),
      getBinsDetailed: vi.fn().mockResolvedValue([]),
    };

    const { result } = renderHook(() => useAdminData(apiClient as any));

    await act(async () => {
      await result.current.loadAdminData('1818');
    });

    expect(result.current.loading).toBe(false);
    expect(apiClient.getBinsDetailed).toHaveBeenCalled();
    expect(apiClient.syncBinsWithContracts).toHaveBeenCalled();
  });
});
