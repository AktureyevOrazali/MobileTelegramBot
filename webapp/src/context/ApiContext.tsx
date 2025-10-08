import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession } from '../types';

interface ApiContextValue {
  apiClient: ApiClient;
  session: AuthSession | null;
  setSession: (session: AuthSession | null) => void;
  logout: () => void;
}

const ApiContext = createContext<ApiContextValue | undefined>(undefined);

function loadSessionFromStorage(): AuthSession | null {
  try {
    const stored = localStorage.getItem('telegram-companion-session');
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && typeof parsed.token === 'string' && parsed.user) {
      const role: string = parsed.user.role ?? 'viewer';
    const favoriteChatIds: number[] = Array.isArray(parsed.user.favoriteChatIds)
      ? (parsed.user.favoriteChatIds as unknown[]).map((value: unknown): number => Number(value)).filter((value: number) => !Number.isNaN(value))
      : [];
      return {
        token: parsed.token,
        user: {
          ...parsed.user,
          createdAt: new Date(parsed.user.createdAt ?? parsed.user.created_at ?? new Date().toISOString()),
          sections: Array.isArray(parsed.user.sections) ? parsed.user.sections : [],
          bins: Array.isArray(parsed.user.bins) ? parsed.user.bins : [],
          favoriteChatIds,
          isAdmin: role === 'admin',
          canReply: role === 'admin' || role === 'moderator',
          role,
        },
      } as AuthSession;
    }
    return null;
  } catch (error) {
    console.warn('Failed to restore session from storage', error);
    return null;
  }
}

export const ApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSessionState] = useState<AuthSession | null>(() => loadSessionFromStorage());

  const apiClient = useMemo(() => new ApiClient(), []);

  useEffect(() => {
    apiClient.setSession(session);
  }, [apiClient, session]);

  useEffect(() => {
    if (session) {
      localStorage.setItem('telegram-companion-session', JSON.stringify(session));
    } else {
      localStorage.removeItem('telegram-companion-session');
    }
  }, [session]);

  const setSession = useCallback(
    (next: AuthSession | null) => {
      setSessionState(next);
    },
    [setSessionState],
  );

  const logout = useCallback(() => {
    apiClient.clearSession();
    setSessionState(null);
  }, [apiClient]);

  const value = useMemo<ApiContextValue>(
    () => ({ apiClient, session, setSession, logout }),
    [apiClient, logout, session, setSession],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
};

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error('useApi must be used within ApiProvider');
  }
  return ctx;
}