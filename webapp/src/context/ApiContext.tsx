import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession } from '../types';

interface ApiContextValue {
  apiClient: ApiClient;
  session: AuthSession | null;
  setSession: (session: AuthSession | null) => void;
  logout: () => void;
}

const SESSION_KEY = 'telegram-companion-session';
const STAMP_KEY = 'telegram-companion-server-stamp';

const ApiContext = createContext<ApiContextValue | undefined>(undefined);

// ---- helpers ----
function loadSessionFromStorage(): AuthSession | null {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && typeof parsed.token === 'string' && parsed.user) {
      const role: string = parsed.user.role ?? 'viewer';
      const favoriteChatIds: number[] = Array.isArray(parsed.user.favoriteChatIds)
        ? (parsed.user.favoriteChatIds as unknown[])
            .map((v: unknown) => Number(v))
            .filter((n) => !Number.isNaN(n))
        : [];
      const session: AuthSession = {
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
      };
      return session;
    }
    return null;
  } catch (e) {
    console.warn('Failed to restore session from storage', e);
    return null;
  }
}

export const ApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1) Восстанавливаем сессию (для F5)
  const [session, setSessionState] = useState<AuthSession | null>(() => loadSessionFromStorage());
  // 2) Текущий штамп сервера (для детекта рестарта)
  const [serverStamp, setServerStamp] = useState<string | null>(() => {
    try { return localStorage.getItem(STAMP_KEY); } catch { return null; }
  });

  const apiClient = useMemo(() => new ApiClient(), []);

  // Пробрасываем сессию внутрь apiClient
  useEffect(() => {
    apiClient.setSession(session);
  }, [apiClient, session]);

  // Сохраняем/чистим сессию в storage (для F5)
  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, [session]);

  // --- ВАЖНО: проверка штампа сервера ---
  // Если есть метод apiClient.getServerStamp -> сравниваем с сохранённым
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof (apiClient as any).getServerStamp !== 'function') {
        // метода нет — ничего не делаем, F5 будет сохранять сессию
        return;
      }
      try {
        const stamp: string = await (apiClient as any).getServerStamp();
        if (cancelled) return;

        const prev = serverStamp;
        if (stamp && stamp !== prev) {
          // Сервер перезапустился -> сбрасываем сессию
          setSessionState(null);
          apiClient.clearSession?.();
          apiClient.setSession(null);
          try {
            localStorage.removeItem(SESSION_KEY);
          } catch {}
        }

        setServerStamp(stamp);
        try { localStorage.setItem(STAMP_KEY, stamp ?? ''); } catch {}
      } catch (e) {
        // если не удалось получить штамп — ничего не делаем, считаем что сервер не перезапускался
        console.debug('getServerStamp failed (ignored):', e);
      }
    })();

    return () => { cancelled = true; };
    // хотим проверять при первом запуске и при смене apiClient
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClient]);

  const setSession = useCallback((next: AuthSession | null) => {
    setSessionState(next);
  }, []);

  const logout = useCallback(() => {
    apiClient.clearSession?.();
    apiClient.setSession(null);
    setSessionState(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, [apiClient]);

  const value = useMemo<ApiContextValue>(
    () => ({ apiClient, session, setSession, logout }),
    [apiClient, session, setSession, logout],
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
