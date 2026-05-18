import { describe, expect, it } from 'vitest';
import {
  hrArchiveItems,
  hrCalendarEvents,
  hrEmployees,
  hrRequests,
  hrTemplates,
} from './hrMockData';

describe('HR mock data', () => {
  it('contains enough data to render every HR tab', () => {
    expect(hrRequests.length).toBeGreaterThanOrEqual(6);
    expect(hrEmployees.length).toBeGreaterThanOrEqual(6);
    expect(hrCalendarEvents.length).toBeGreaterThanOrEqual(8);
    expect(hrTemplates.length).toBeGreaterThanOrEqual(5);
    expect(hrArchiveItems.length).toBeGreaterThanOrEqual(5);
  });

  it('uses stable unique IDs in every collection', () => {
    const collections = [hrRequests, hrEmployees, hrCalendarEvents, hrTemplates, hrArchiveItems];
    for (const collection of collections) {
      const ids = collection.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('covers the primary request types and statuses', () => {
    expect(new Set(hrRequests.map((request) => request.type))).toEqual(
      new Set(['vacation', 'advance', 'sickLeave', 'businessTrip', 'certificate', 'serviceLetter']),
    );
    expect(new Set(hrRequests.map((request) => request.status))).toContain('new');
    expect(new Set(hrRequests.map((request) => request.status))).toContain('needsInfo');
  });
});
