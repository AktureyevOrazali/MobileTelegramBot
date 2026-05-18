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
import { normalizeAssignmentsFromStorage } from '../utils/converters';
import { isAdminLikeRole, normalizeRole, roleCanReply } from '../utils/roles';
import { sanitizeUiText } from '../utils/text';

interface ApiContextValue {
  apiClient: ApiClient;
  session: AuthSession | null;
  setSession: (session: AuthSession | null) => void;
  logout: () => void;
}

const SESSION_KEY = 'mobilebot-companion-session';
const STAMP_KEY = 'mobilebot-companion-server-stamp';

const ApiContext = createContext<ApiContextValue | undefined>(undefined);

// ---- helpers ----
function loadSessionFromStorage(): AuthSession | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && typeof parsed.token === 'string' && parsed.user) {
      const role = normalizeRole(parsed.user.role);
      const favoriteRaw = parsed.user.favoriteDialogIds ?? parsed.user.favorite_dialog_ids;
      const favoriteDialogIds: number[] = Array.isArray(favoriteRaw)
        ? (favoriteRaw as unknown[])
          .map((v: unknown) => Number(v))
          .filter((n) => !Number.isNaN(n))
        : [];
      const normalizedBins = normalizeAssignmentsFromStorage(parsed.user.bins);
      const session: AuthSession = {
        token: parsed.token,
        user: {
          ...parsed.user,
          email: sanitizeUiText(parsed.user.email) ?? parsed.user.email ?? '',
          login: sanitizeUiText(parsed.user.login) ?? parsed.user.login ?? '',
          name: sanitizeUiText(parsed.user.name) ?? parsed.user.name ?? '',
          jobTitle: sanitizeUiText(parsed.user.jobTitle ?? parsed.user.job_title) ?? parsed.user.jobTitle ?? parsed.user.job_title ?? '',
          phone: sanitizeUiText(parsed.user.phone) ?? parsed.user.phone ?? '',
          bio: sanitizeUiText(parsed.user.bio) ?? parsed.user.bio ?? '',
          createdAt: new Date(parsed.user.createdAt ?? parsed.user.created_at ?? new Date().toISOString()),
          sections: Array.isArray(parsed.user.sections) ? parsed.user.sections : [],
          bins: normalizedBins,
          favoriteDialogIds,
          isAdmin: isAdminLikeRole(role),
          canReply: roleCanReply(role),
          role,
          isApproved: parsed.user.isApproved ?? parsed.user.is_approved ?? true,
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

  useEffect(() => {
    if (!session?.token) {
      return;
    }
    let cancelled = false;
    const token = session.token;

    (async () => {
      try {
        const profile = await apiClient.fetchProfile();
        if (cancelled) {
          return;
        }
        setSessionState((current) =>
          current?.token === token ? { ...current, user: profile } : current,
        );
      } catch (e) {
        console.debug('fetchProfile failed during session restore (ignored):', e);
      }
    })();

    return () => { cancelled = true; };
  }, [apiClient, session?.token]);

  // Сохраняем/чистим сессию в storage (для F5)
  useEffect(() => {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { }
  }, [session]);

  // --- ВАЖНО: проверка штампа сервера ---
  // Если есть метод apiClient.getServerStamp -> сравниваем с сохранённым
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!('getServerStamp' in apiClient) || typeof (apiClient as Record<string, unknown>).getServerStamp !== 'function') {
        // метода нет — ничего не делаем, F5 будет сохранять сессию
        return;
      }
      try {
        const getStamp = (apiClient as Record<string, unknown>).getServerStamp as () => Promise<string>;
        const stamp: string = await getStamp();
        if (cancelled) return;

        const prev = serverStamp;
        if (stamp && stamp !== prev) {
          // Сервер перезапустился -> сбрасываем сессию
          setSessionState(null);
          apiClient.clearSession?.();
          apiClient.setSession(null);
          try {
            sessionStorage.removeItem(SESSION_KEY);
          } catch { }
        }

        setServerStamp(stamp);
        try { localStorage.setItem(STAMP_KEY, stamp ?? ''); } catch { }
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
      sessionStorage.removeItem(SESSION_KEY);
    } catch { }
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
