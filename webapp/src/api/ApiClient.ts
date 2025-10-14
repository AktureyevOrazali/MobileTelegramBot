import {
  AuthSession,
  AuthSessionRaw,
  ChatSummary,
  ChatSummaryRaw,
  Message,
  MessageNotification,
  MessageNotificationRaw,
  MessageRaw,
  RoleInfo,
  Section,
  UserProfile,
  UserProfileRaw,
} from '../types';
import { mapChatSummary, mapMessage, mapNotification, mapSession, mapUserProfile } from '../utils/converters';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const DEFAULT_BASE_URL =
  typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'http://localhost:8000';
const DEFAULT_API_TOKEN = 'MySecretTokenSayCheese';

export interface ApiClientOptions {
  baseUrl?: string;
  apiToken?: string;
}

export class ApiClient {
  private readonly baseUrl: string;

  private readonly apiToken: string;

  private session: AuthSession | null = null;

  private currentUserProfile: UserProfile | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl || import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiToken = options.apiToken || import.meta.env.VITE_API_TOKEN || DEFAULT_API_TOKEN;
  }

  get currentUser(): UserProfile | null {
    return this.currentUserProfile;
  }

  get sessionToken(): string | null {
    return this.session?.token ?? null;
  }

  setSession(session: AuthSession | null): void {
    this.session = session;
    this.currentUserProfile = session?.user ?? null;
  }

  updateCurrentUser(profile: UserProfile): void {
    if (!this.session) {
      return;
    }
    this.currentUserProfile = profile;
    this.session = { ...this.session, user: profile };
  }

  clearSession(): void {
    this.session = null;
    this.currentUserProfile = null;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
    const normalizedPath = path.replace(/^\//, '');
    const url = new URL(`${this.baseUrl}/${normalizedPath}`);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          return;
        }
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    options: RequestInit & { query?: Record<string, any>; expectJson?: boolean } = {},
  ): Promise<T> {
    const { query, expectJson = true, headers, ...rest } = options;
    const url = this.buildUrl(path, query);
    let response: Response;
    try {
      response = await fetch(url, {
        ...rest,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Token': this.apiToken,
          ...(this.session?.token ? { 'X-Session-Token': this.session.token } : {}),
          ...headers,
        },
      });
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        'Не удалось подключиться к серверу. Проверьте интернет-соединение и адрес API.',
      );
    }

    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new ApiError(message ?? 'Не удалось выполнить запрос к API.', response.status);
    }

    if (!expectJson) {
      // Сбрасываем тело ответа, чтобы соединение могло быть переиспользовано.
      if (response.body) {
        try {
          await response.body.cancel();
        } catch (error) {
          // Игнорируем ошибки при отмене чтения тела ответа.
        }
      }
      return undefined as T;
    }

    return this.parseJsonResponse<T>(response);
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const raw = await response.text();
    if (!raw) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.toLowerCase().includes('application/json')) {
      return JSON.parse(raw) as T;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      const message = this.normalizeErrorMessage(raw.trim());
      throw new ApiError(
        message || 'Сервер вернул неожиданный ответ. Попробуйте повторить попытку позже.',
        response.status,
      );
    }
  }

  private async extractErrorMessage(response: Response): Promise<string | null> {
    try {
      const text = await response.text();
      if (!text) {
        return null;
      }
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('<')) {
        return null;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          const detail = (parsed as any).detail ?? (parsed as any).message ?? (parsed as any).error;
          if (typeof detail === 'string') {
            return this.normalizeErrorMessage(detail) ?? null;
          }
          if (Array.isArray(detail)) {
            return detail
              .map((item) => this.normalizeErrorMessage(String(item)))
              .filter((value): value is string => Boolean(value))
              .join('\n');
          }
        }
        return this.normalizeErrorMessage(trimmed);
      } catch (error) {
        return this.normalizeErrorMessage(trimmed);
      }
    } catch (error) {
      return null;
    }
  }

  private normalizeErrorMessage(message: string | null | undefined): string | null {
    if (!message) {
      return null;
    }
    const normalized = message.trim();
    if (!normalized || normalized.startsWith('<')) {
      return null;
    }
    switch (normalized) {
      case 'Invalid API token':
        return 'Неверный API токен. Проверьте конфигурацию.';
      case 'Invalid credentials':
        return 'Неверный логин или пароль.';
      case 'User already exists':
        return 'Пользователь с таким e-mail уже зарегистрирован.';
      case 'Administrator role required':
        return 'Недостаточно прав: требуется роль администратора.';
      case 'Session token required':
      case 'Invalid session token':
        return 'Сессия истекла. Выполните вход заново.';
      default:
        return normalized;
    }
  }

  async login(identifier: string, password: string): Promise<AuthSession> {
    const payload = { identifier, password };
    const response = await this.request<AuthSessionRaw>('auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const session = mapSession(response);
    this.setSession(session);
    return session;
  }

  async register(name: string, email: string, password: string): Promise<AuthSession> {
    const payload = { name, email, password };
    const response = await this.request<AuthSessionRaw>('auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const session = mapSession(response);
    this.setSession(session);
    return session;
  }

  async fetchProfile(): Promise<UserProfile> {
    const response = await this.request<UserProfileRaw>('profile', { method: 'GET' });
    const profile = mapUserProfile(response);
    this.updateCurrentUser(profile);
    return profile;
  }

  async updateProfile(payload: { name?: string; jobTitle?: string; phone?: string; bio?: string; email?: string }): Promise<UserProfile> {
    const body = {
      name: payload.name,
      job_title: payload.jobTitle,
      phone: payload.phone,
      bio: payload.bio,
      email: payload.email,
    };
    const response = await this.request<UserProfileRaw>('profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    const profile = mapUserProfile(response);
    this.updateCurrentUser(profile);
    return profile;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthSession> {
    const response = await this.request<AuthSessionRaw>('profile/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    const session = mapSession(response);
    this.setSession(session);
    return session;
  }

  async fetchSections(): Promise<Section[]> {
    return this.request<Section[]>('sections', { method: 'GET' });
  }

  async fetchBins(query?: string): Promise<string[]> {
    return this.request<string[]>('bins', {
      method: 'GET',
      query: query ? { query } : undefined,
    });
  }

  async fetchChats(options: { favoriteOnly?: boolean; binQuery?: string | null } = {}): Promise<ChatSummary[]> {
    const response = await this.request<ChatSummaryRaw[]>('chats', {
      method: 'GET',
      query: {
        favorite_only: options.favoriteOnly ? 'true' : undefined,
        bin_query: options.binQuery ?? undefined,
      },
    });
    return response.map(mapChatSummary);
  }

  async fetchMessages(chatId: number, limit = 50, dialogId?: number): Promise<Message[]> {
    const response = await this.request<MessageRaw[]>(`chats/${chatId}/messages`, {
      method: 'GET',
      query: { limit, dialog_id: dialogId },
    });
    return response.map(mapMessage);
  }

  async sendMessage(chatId: number, text: string, dialogId?: number): Promise<void> {
    await this.request('messages/send', {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, text, dialog_id: dialogId }),
    });
  }

  async setFavorite(chatId: number, favorite: boolean): Promise<void> {
    await this.request(`chats/${chatId}/favorite`, {
      method: favorite ? 'POST' : 'DELETE',
      expectJson: false,
    });
    if (this.currentUserProfile) {
      const favoriteSet = new Set(this.currentUserProfile.favoriteChatIds);
      if (favorite) {
        favoriteSet.add(chatId);
      } else {
        favoriteSet.delete(chatId);
      }
      this.updateCurrentUser({ ...this.currentUserProfile, favoriteChatIds: Array.from(favoriteSet) });
    }
  }

  async deleteDialog(dialogId: number): Promise<void> {
    if (!this.currentUserProfile?.isAdmin) {
      throw new ApiError('Удаление диалогов доступно только администраторам.', 403);
    }
    await this.request(`dialogs/${dialogId}`, {
      method: 'DELETE',
      expectJson: false,
    });
  }

  async fetchUsers(query?: string): Promise<UserProfile[]> {
    const response = await this.request<UserProfileRaw[]>('users', {
      method: 'GET',
      query: query ? { query } : undefined,
    });
    return response.map(mapUserProfile);
  }

  async deleteUser(userId: number): Promise<void> {
    await this.request(`users/${userId}`, {
      method: 'DELETE',
      expectJson: false,
    });
  }

  async fetchRoles(): Promise<RoleInfo[]> {
    return this.request<RoleInfo[]>('roles', { method: 'GET' });
  }

  async updateUserRole(userId: number, role: string): Promise<UserProfile> {
    const response = await this.request<UserProfileRaw>(`users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
    const profile = mapUserProfile(response);
    if (this.currentUserProfile && this.currentUserProfile.id === profile.id) {
      this.updateCurrentUser(profile);
    }
    return profile;
  }

  async updateUserSections(userId: number, sections: string[]): Promise<UserProfile> {
    const response = await this.request<UserProfileRaw>(`users/${userId}/sections`, {
      method: 'PUT',
      body: JSON.stringify({ sections }),
    });
    return mapUserProfile(response);
  }

  async updateUserBins(userId: number, bins: string[]): Promise<UserProfile> {
    const response = await this.request<UserProfileRaw>(`users/${userId}/bins`, {
      method: 'PUT',
      body: JSON.stringify({ bins }),
    });
    return mapUserProfile(response);
  }

  async adminSetUserPassword(userId: number, newPassword: string): Promise<UserProfile> {
    const response = await this.request<UserProfileRaw>(`users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ new_password: newPassword }),
    });
    return mapUserProfile(response);
  }

  async fetchUpdates(since?: Date | null): Promise<MessageNotification[]> {
    const response = await this.request<MessageNotificationRaw[]>('updates', {
      method: 'GET',
      query: since
        ? {
            since: new Date(since.getTime() - since.getTimezoneOffset() * 60000)
              .toISOString()
              .replace('Z', '+00:00'),
          }
        : undefined,
    });
    return response.map(mapNotification);
  }

  

  
}