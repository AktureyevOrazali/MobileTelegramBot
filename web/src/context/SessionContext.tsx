import {
  PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import ApiClient, { ApiError } from '@/api/client';
import { AuthSession, UserProfile } from '@/api/types';

interface SessionContextValue {
  apiClient: ApiClient;
  session: AuthSession | null;
  initializing: boolean;
  login: (identifier: string, password: string) => Promise<AuthSession>;
  register: (params: { name: string; email: string; password: string }) => Promise<AuthSession>;
  logout: () => void;
  updateSession: (session: AuthSession) => void;
  updateCurrentUser: (profile: UserProfile) => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

const STORAGE_KEY = 'telegram-companion-session';

const resolveEnv = (key: string, fallback: string) => {
  const value = (import.meta as any).env?.[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof window !== 'undefined') {
    const globalValue = (window as any)?.__CONFIG__?.[key];
    if (typeof globalValue === 'string' && globalValue.trim().length > 0) {
      return globalValue.trim();
    }
  }
  return fallback;
};

const defaultBaseUrl = resolveEnv('VITE_API_BASE_URL', '');
const defaultApiToken = resolveEnv('VITE_API_TOKEN', '');

export const SessionProvider = ({ children }: PropsWithChildren) => {
  const [apiClient] = useState(
    () => new ApiClient({ baseUrl: defaultBaseUrl, apiToken: defaultApiToken }),
  );
  const [session, setSession] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AuthSession;
        if (parsed?.token && parsed?.user) {
          setSession(parsed);
          apiClient.setSession(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to restore session', error);
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setInitializing(false);
    }
  }, [apiClient]);

  const persist = (value: AuthSession | null) => {
    if (!value) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }
  };

  const login = async (identifier: string, password: string) => {
    const result = await apiClient.login(identifier, password);
    setSession(result);
    persist(result);
    return result;
  };

  const register = async (params: { name: string; email: string; password: string }) => {
    const result = await apiClient.register(params.name, params.email, params.password);
    setSession(result);
    persist(result);
    return result;
  };

  const logout = () => {
    apiClient.clearSession();
    setSession(null);
    persist(null);
  };

  const updateSession = (value: AuthSession) => {
    apiClient.setSession(value);
    setSession(value);
    persist(value);
  };

  const updateCurrentUser = (profile: UserProfile) => {
    apiClient.updateCurrentUser(profile);
    setSession((current) => {
      if (!current) {
        return null;
      }
      const updated: AuthSession = {
        token: current.token,
        user: profile,
      };
      persist(updated);
      return updated;
    });
  };

  const value = useMemo<SessionContextValue>(
    () => ({
      apiClient,
      session,
      initializing,
      login,
      register,
      logout,
      updateSession,
      updateCurrentUser,
    }),
    [apiClient, initializing, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new ApiError('SessionContext is not available outside of SessionProvider');
  }
  return context;
};
