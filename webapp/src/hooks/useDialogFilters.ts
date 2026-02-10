import { useState, useCallback } from 'react';

export interface DialogFilters {
    selectedSection: string | null;
    selectedBin: string | null;
    showFavoritesOnly: boolean;
    sortOrder: 'desc' | 'asc';
    statusFilter: 'all' | 'open' | 'closed';
}

const INITIAL_FILTERS: DialogFilters = {
    selectedSection: null,
    selectedBin: null,
    showFavoritesOnly: false,
    sortOrder: 'desc',
    statusFilter: 'all',
};

/**
 * Custom hook encapsulating all dialog list filter state.
 * Reduces 5 individual useState calls into a single cohesive unit.
 */
export function useDialogFilters() {
    const [filters, setFilters] = useState<DialogFilters>(INITIAL_FILTERS);

    const setSelectedSection = useCallback(
        (value: string | null) => setFilters((prev) => ({ ...prev, selectedSection: value })),
        [],
    );

    const setSelectedBin = useCallback(
        (value: string | null) => setFilters((prev) => ({ ...prev, selectedBin: value })),
        [],
    );

    const setShowFavoritesOnly = useCallback(
        (value: boolean) => setFilters((prev) => ({ ...prev, showFavoritesOnly: value })),
        [],
    );

    const setSortOrder = useCallback(
        (value: 'desc' | 'asc') => setFilters((prev) => ({ ...prev, sortOrder: value })),
        [],
    );

    const setStatusFilter = useCallback(
        (value: 'all' | 'open' | 'closed') => setFilters((prev) => ({ ...prev, statusFilter: value })),
        [],
    );

    return {
        ...filters,
        setSelectedSection,
        setSelectedBin,
        setShowFavoritesOnly,
        setSortOrder,
        setStatusFilter,
    };
}
