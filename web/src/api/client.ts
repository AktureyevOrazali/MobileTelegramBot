import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  AuthSession,
  ChatSummary,
  Message,
  MessageNotification,
  RoleInfo,
  Section,
  UserProfile,
} from './types';

dayjs.extend(utc);

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const roleTitles: Record<string, string> = {
  admin: 'Администратор',
  moderator: 'Модератор',
  viewer: 'Пользователь',
};

export interface ApiClientOptions {
  baseUrl?: string;
  apiToken?: string;
}

const DEFAULT_BASE_URL = 'https://exclamatorily-nonaffecting-chelsey.ngrok-free.dev';
const DEFAULT_API_TOKEN = 'MySecretTokenSayCheese';

export default class ApiClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private sessionToken: string | null = null;
  private currentUserInternal: UserProfile | null = null;
  private favoriteChatIds = new Set<number>();

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl && options.baseUrl.trim().length > 0)
      ? options.baseUrl
      : DEFAULT_BASE_URL;
    this.apiToken = (options.apiToken && options.apiToken.trim().length > 0)
      ? options.apiToken
      : DEFAULT_API_TOKEN;
  }

  setSession(session: AuthSession) {
    this.sessionToken = session.token;
    this.updateCurrentUser(session.user);
    this.favoriteChatIds = new Set(session.user.favoriteChatIds);
  }

  clearSession() {
    this.sessionToken = null;
    this.currentUserInternal = null;
    this.favoriteChatIds.clear();
  }

  updateCurrentUser(profile: UserProfile) {
    this.currentUserInternal = {
      ...profile,
      favoriteChatIds: [...new Set(profile.favoriteChatIds)],
    };
    this.favoriteChatIds = new Set(profile.favoriteChatIds);
  }

  updateSessionToken(token: string) {
    if (this.sessionToken) {
      this.sessionToken = token;
    }
  }

  get currentUser(): UserProfile | null {
    if (!this.currentUserInternal) {
      return null;
    }
    return {
      ...this.currentUserInternal,
      favoriteChatIds: Array.from(this.favoriteChatIds),
    };
  }

  get session(): AuthSession | null {
    if (!this.sessionToken || !this.currentUserInternal) {
      return null;
    }
    return {
      token: this.sessionToken,
      user: this.currentUser,
    } as AuthSession;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const normalizedBase = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(normalizedPath, normalizedBase);
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null) {
          return;
        }
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  private get headers() {
    return {
      'Content-Type': 'application/json; charset=utf-8',
      ...(this.apiToken ? { 'X-Api-Token': this.apiToken } : {}),
      ...(this.sessionToken ? { 'X-Session-Token': this.sessionToken } : {}),
    } as Record<string, string>;
  }

  private async send<T>(request: () => Promise<Response>, fallbackMessage: string): Promise<T> {
    try {
      const response = await request();
      if (!response.ok) {
        const message = await this.extractErrorMessage(response);
        throw new ApiError(message ?? fallbackMessage);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw new ApiError(
          'Не удалось подключиться к серверу. Проверьте интернет-соединение и адрес API.',
        );
      }
      throw new ApiError(fallbackMessage);
    }
  }

  private async extractErrorMessage(response: Response): Promise<string | null> {
    const body = await response.text();
    if (!body) {
      return null;
    }
    try {
      const data = JSON.parse(body);
      const normalized = this.normalizeDetail(data);
      if (normalized && normalized.length > 0) {
        return normalized;
      }
    } catch (error) {
      if (!body.startsWith('<')) {
        return body;
      }
      console.error('Failed to parse error body', error);
    }
    if (!body.startsWith('<')) {
      return body;
    }
    return null;
  }

  private normalizeDetail(detail: unknown): string | null {
    if (!detail) {
      return null;
    }
    if (typeof detail === 'string') {
      switch (detail) {
        case 'Invalid API token':
          return 'Неверный API токен. Проверьте настройку бэкенда.';
        case 'Invalid credentials':
          return 'Неверный логин или пароль.';
        case 'User already exists':
          return 'Пользователь с таким e-mail уже зарегистрирован.';
        case 'Administrator role required':
          return 'Недостаточно прав: требуется роль администратора.';
        case 'Session token required':
          return 'Не удалось определить сессию. Выполните вход заново.';
        case 'Invalid session token':
          return 'Сессия истекла. Выполните вход ещё раз.';
        default:
          return detail;
      }
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) => this.normalizeDetail(item))
        .filter((item): item is string => Boolean(item))
        .join('\n');
    }
    if (typeof detail === 'object') {
      const record = detail as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : undefined;
      const message = typeof record.message === 'string'
        ? record.message
        : typeof record.msg === 'string'
          ? record.msg
          : undefined;
      const ctx = record.ctx as Record<string, unknown> | undefined;
      const loc = Array.isArray(record.loc) ? record.loc : undefined;
      const field = this.friendlyFieldName(loc && loc.length > 0 ? String(loc[loc.length - 1]) : '');
      if (type === 'value_error.any_str.min_length' && ctx?.limit_value) {
        return `${field} должно содержать не менее ${ctx.limit_value} символов.`;
      }
      if (type === 'value_error.any_str.max_length' && ctx?.limit_value) {
        return `${field} должно содержать не более ${ctx.limit_value} символов.`;
      }
      if (type === 'value_error.missing') {
        return `Заполните поле ${field}.`;
      }
      if (type === 'value_error.email') {
        return 'Введите корректный e-mail.';
      }
      if (type === 'type_error.integer') {
        return `${field} должно быть числом.`;
      }
      if (type === 'type_error.string') {
        return `${field} должно быть строкой.`;
      }
      if (message && message.length > 0) {
        return message;
      }
    }
    return String(detail);
  }

  private friendlyFieldName(raw: string): string {
    switch (raw) {
      case 'name':
        return '«Имя»';
      case 'email':
        return '«E-mail»';
      case 'password':
        return '«Пароль»';
      case 'identifier':
        return '«Логин или e-mail»';
      case 'job_title':
        return '«Должность»';
      case 'phone':
        return '«Телефон»';
      case 'bio':
        return '«Описание»';
      case 'chat_id':
        return '«Чат»';
      case 'text':
        return '«Сообщение»';
      case 'role':
        return '«Роль»';
      case 'sections':
        return '«Разделы»';
      case 'bins':
        return '«БИНы»';
      case 'new_password':
        return '«Новый пароль»';
      case 'current_password':
        return '«Текущий пароль»';
      default:
        return `«${raw}»`;
    }
  }

  private parseUserProfile(data: any): UserProfile {
    const sections = Array.isArray(data?.sections)
      ? data.sections.map((item: unknown) => String(item))
      : [];
    const bins = Array.isArray(data?.bins)
      ? data.bins.map((item: unknown) => String(item))
      : [];
    const favorite = Array.isArray(data?.favorite_chat_ids)
      ? data.favorite_chat_ids
          .map((item: unknown) => {
            if (typeof item === 'number') return item;
            const parsed = Number.parseInt(String(item), 10);
            return Number.isNaN(parsed) ? null : parsed;
          })
          .filter((item): item is number => item !== null)
      : [];
    return {
      id: Number(data?.id ?? 0),
      name: String(data?.name ?? ''),
      email: String(data?.email ?? ''),
      login: data?.login ? String(data.login) : String(data?.email ?? ''),
      createdAt: String(data?.created_at ?? new Date().toISOString()),
      jobTitle: String(data?.job_title ?? ''),
      phone: String(data?.phone ?? ''),
      bio: String(data?.bio ?? ''),
      role: String(data?.role ?? 'viewer'),
      sections,
      bins,
      favoriteChatIds: favorite,
    };
  }

  private parseChatSummary(data: any): ChatSummary {
    return {
      chatId: Number(data?.chat_id ?? data?.id ?? 0),
      title: String(data?.title ?? 'Неизвестный чат'),
      username: data?.username ? String(data.username) : null,
      type: String(data?.type ?? ''),
      updatedAt: String(data?.updated_at ?? data?.updatedAt ?? new Date().toISOString()),
      section: data?.section ? String(data.section) : null,
      sectionTitle: data?.section_title ? String(data.section_title) : null,
      bin: data?.bin ? String(data.bin) : null,
      isFavorite: Boolean(data?.is_favorite ?? data?.isFavorite ?? this.favoriteChatIds.has(Number(data?.chat_id))),
    };
  }

  private parseMessage(data: any): Message {
    const createdAt = String(data?.created_at ?? data?.createdAt ?? new Date().toISOString());
    const createdAtLabel = data?.created_at_label
      ? String(data.created_at_label)
      : dayjs.utc(createdAt).local().format('DD.MM.YYYY HH:mm');
    return {
      id: Number(data?.id ?? 0),
      chatId: Number(data?.chat_id ?? 0),
      text: String(data?.text ?? ''),
      direction: (data?.direction === 'outgoing' ? 'outgoing' : 'incoming'),
      author: data?.author ? String(data.author) : null,
      createdAt,
      createdAtLabel,
      sectionTitle: data?.section_title ? String(data.section_title) : null,
    };
  }

  private parseMessageNotification(data: any): MessageNotification {
    const createdAt = String(data?.created_at ?? new Date().toISOString());
    return {
      chatId: Number(data?.chat_id ?? 0),
      chatTitle: String(data?.chat_title ?? ''),
      createdAt,
    };
  }

  private parseRoleInfo(data: any): RoleInfo {
    return {
      id: String(data?.id ?? ''),
      title: String(data?.title ?? data?.id ?? ''),
    };
  }

  async register(name: string, email: string, password: string): Promise<AuthSession> {
    const url = this.buildUrl('auth/register');
    const payload = { name, email, password };
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      }),
      'Не удалось завершить регистрацию.',
    );
    const session: AuthSession = {
      token: String(data?.token ?? ''),
      user: this.parseUserProfile(data?.user),
    };
    this.setSession(session);
    return session;
  }

  async login(identifier: string, password: string): Promise<AuthSession> {
    const url = this.buildUrl('auth/login');
    const payload = { identifier, password };
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      }),
      'Не удалось выполнить вход. Проверьте логин и пароль.',
    );
    const session: AuthSession = {
      token: String(data?.token ?? ''),
      user: this.parseUserProfile(data?.user),
    };
    this.setSession(session);
    return session;
  }

  async fetchSections(): Promise<Section[]> {
    const url = this.buildUrl('sections');
    const data = await this.send<any[]>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось загрузить список разделов.',
    );
    return data.map((item) => ({
      id: String(item?.id ?? ''),
      title: String(item?.title ?? ''),
    }));
  }

  async fetchBins(query?: string): Promise<string[]> {
    const url = this.buildUrl('bins', query ? { query } : undefined);
    const data = await this.send<any[]>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось загрузить список БИНов.',
    );
    return data.map((item) => String(item));
  }

  async fetchProfile(): Promise<UserProfile> {
    const url = this.buildUrl('profile');
    const data = await this.send<any>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось загрузить профиль пользователя.',
    );
    const profile = this.parseUserProfile(data);
    this.updateCurrentUser(profile);
    return profile;
  }

  async updateProfile(params: { name: string; jobTitle?: string; phone?: string; bio?: string }): Promise<UserProfile> {
    const url = this.buildUrl('profile');
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({
          name: params.name,
          job_title: params.jobTitle ?? '',
          phone: params.phone ?? '',
          bio: params.bio ?? '',
        }),
      }),
      'Не удалось обновить профиль.',
    );
    const profile = this.parseUserProfile(data);
    this.updateCurrentUser(profile);
    return profile;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthSession> {
    const url = this.buildUrl('profile/password');
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      }),
      'Не удалось обновить пароль.',
    );
    const session: AuthSession = {
      token: String(data?.token ?? ''),
      user: this.parseUserProfile(data?.user ?? data),
    };
    this.setSession(session);
    return session;
  }

  async fetchChats(params?: { favoritesOnly?: boolean; binQuery?: string; section?: string | null }): Promise<ChatSummary[]> {
    const query: Record<string, unknown> = {};
    if (params?.favoritesOnly) {
      query.favorite_only = true;
    }
    if (params?.binQuery) {
      query.bin_query = params.binQuery;
    }
    if (params?.section) {
      query.section = params.section;
    }
    const url = this.buildUrl('chats', Object.keys(query).length > 0 ? query : undefined);
    const data = await this.send<any[]>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось загрузить список диалогов.',
    );
    return data.map((item) => this.parseChatSummary(item));
  }

  async fetchMessages(chatId: number): Promise<Message[]> {
    const url = this.buildUrl(`chats/${chatId}/messages`, { limit: 100 });
    const data = await this.send<any[]>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось загрузить сообщения.',
    );
    return data.map((item) => this.parseMessage(item));
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const url = this.buildUrl(`chats/${chatId}/messages`);
    await this.send(
      () => fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ text }),
      }),
      'Не удалось отправить сообщение.',
    );
  }

  async setFavorite(chatId: number, isFavorite: boolean): Promise<void> {
    const url = this.buildUrl(`chats/${chatId}/favorite`);
    await this.send(
      () => fetch(url, {
        method: isFavorite ? 'POST' : 'DELETE',
        headers: this.headers,
      }),
      'Не удалось обновить избранное.',
    );
    if (isFavorite) {
      this.favoriteChatIds.add(chatId);
    } else {
      this.favoriteChatIds.delete(chatId);
    }
  }

  async deleteChat(chatId: number): Promise<void> {
    const url = this.buildUrl(`chats/${chatId}`);
    await this.send(
      () => fetch(url, {
        method: 'DELETE',
        headers: this.headers,
      }),
      'Не удалось удалить диалог.',
    );
  }

  async fetchUsers(params?: { query?: string }): Promise<UserProfile[]> {
    const url = this.buildUrl('users', params?.query ? { query: params.query } : undefined);
    const data = await this.send<any[]>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось загрузить список пользователей.',
    );
    return data.map((item) => this.parseUserProfile(item));
  }

  async fetchRoles(): Promise<RoleInfo[]> {
    const url = this.buildUrl('roles');
    const data = await this.send<any[]>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось загрузить список ролей.',
    );
    return data.map((item) => this.parseRoleInfo(item));
  }

  async updateUserRole(userId: number, role: string): Promise<UserProfile> {
    const url = this.buildUrl(`users/${userId}/role`);
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ role }),
      }),
      'Не удалось обновить роль пользователя.',
    );
    const profile = this.parseUserProfile(data);
    if (this.currentUserInternal && this.currentUserInternal.id === profile.id) {
      this.updateCurrentUser(profile);
    }
    return profile;
  }

  async updateUserSections(userId: number, sections: string[]): Promise<UserProfile> {
    const url = this.buildUrl(`users/${userId}/sections`);
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ sections }),
      }),
      'Не удалось обновить назначенные разделы.',
    );
    return this.parseUserProfile(data);
  }

  async updateUserBins(userId: number, bins: string[]): Promise<UserProfile> {
    const url = this.buildUrl(`users/${userId}/bins`);
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ bins }),
      }),
      'Не удалось обновить назначенные БИНы.',
    );
    return this.parseUserProfile(data);
  }

  async adminSetUserPassword(userId: number, newPassword: string): Promise<UserProfile> {
    const url = this.buildUrl(`users/${userId}/password`);
    const data = await this.send<any>(
      () => fetch(url, {
        method: 'PUT',
        headers: this.headers,
        body: JSON.stringify({ new_password: newPassword }),
      }),
      'Не удалось обновить пароль пользователя.',
    );
    return this.parseUserProfile(data);
  }

  async fetchUpdates(since?: Date): Promise<MessageNotification[]> {
    const url = this.buildUrl('updates', since ? {
      since: since.toISOString().replace('Z', '+00:00'),
    } : undefined);
    const data = await this.send<any[]>(
      () => fetch(url, { headers: this.headers }),
      'Не удалось получить обновления.',
    );
    return data.map((item) => this.parseMessageNotification(item));
  }

  getRoleLabel(role: string): string {
    return roleTitles[role] ?? role;
  }

  canUserDeleteChats(user: UserProfile | null): boolean {
    if (!user) return false;
    return user.role === 'admin' || user.role === 'moderator';
  }

  isAdmin(user: UserProfile | null): boolean {
    return Boolean(user && user.role === 'admin');
  }
}
