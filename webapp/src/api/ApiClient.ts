import {
  AuthSession,
  AuthSessionRaw,
  BinDetailed,
  BinDetailedRaw,
  ChatSummary,
  ChatSummaryRaw,
  DashboardSummary,
  DashboardSummaryRaw,
  DialogStatusUpdate,
  DialogStatusUpdateRaw,
  Message,
  MessageNotification,
  MessageNotificationRaw,
  MessageRaw,
  OrganizationWithoutContract,
  OrganizationWithoutContractRaw,
  PendingRegistration,
  PendingRegistrationRaw,
  RoleInfo,
  RegisterStatus,
  Section,
  UserProfile,
  UserProfileRaw,
  UnassignedBin,
  UnassignedBinRaw,
  UserBinAssignment,
} from '../types';
import {
  mapChatSummary,
  mapDashboardSummary,
  mapMessage,
  mapNotification,
  mapSession,
  mapUserProfile,
} from '../utils/converters';

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const BUILD_TIME_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
const BUILD_TIME_API_TOKEN = (import.meta.env.VITE_API_TOKEN ?? '').trim();

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
    const resolvedBaseUrl = (options.baseUrl ?? BUILD_TIME_BASE_URL).replace(/\/$/, '');
    if (!resolvedBaseUrl) {
      throw new Error('API base URL is required. Set VITE_API_BASE_URL or pass it via ApiClient options.');
    }
    const resolvedToken = options.apiToken ?? BUILD_TIME_API_TOKEN;
    if (!resolvedToken) {
      throw new Error('API token is required. Set VITE_API_TOKEN or pass it via ApiClient options.');
    }

    this.baseUrl = resolvedBaseUrl;
    this.apiToken = resolvedToken;
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
    options: RequestInit & { query?: Record<string, string | number | boolean | null | undefined>; expectJson?: boolean } = {},
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
          const detail = 'detail' in parsed ? parsed.detail
            : 'message' in parsed ? parsed.message
              : 'error' in parsed ? parsed.error
                : undefined;
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
      case 'Аккаунт ожидает подтверждения модератора':
        return 'Аккаунт ожидает подтверждения модератора.';
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

  async register(name: string, email: string, password: string): Promise<RegisterStatus> {
    const payload = { name, email, password };
    const response = await this.request<RegisterStatus>('auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return response;
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

  async fetchUnassignedBins(): Promise<UnassignedBin[]> {
    const normalize = (items: UnassignedBinRaw[]) =>
      items.map((item) => ({
        bin: item.bin,
        openDialogs: typeof item.open_dialogs === 'number' ? item.open_dialogs : 0,
      }));
    try {
      const response = await this.request<UnassignedBinRaw[]>('bins/unassigned', { method: 'GET' });
      return normalize(response);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
        const legacy = await this.request<UnassignedBinRaw[]>('bins/pending', { method: 'GET' });
        return normalize(legacy);
      }
      throw error;
    }
  }

  async deleteBin(binValue: string): Promise<void> {
    await this.request(`bins/${encodeURIComponent(binValue)}`, { method: 'DELETE' });
  }

  async fetchOrganizationsWithoutContracts(): Promise<OrganizationWithoutContract[]> {
    const response = await this.request<OrganizationWithoutContractRaw[]>('organizations/without-contracts', { method: 'GET' });
    return response.map((item) => ({
      customerBin: item.customer_bin,
      customerLegalAddress: item.customer_legal_address,
      customerBankNameRu: item.customer_bank_name_ru,
      createdAt: new Date(item.created_at),
    }));
  }

  async getBinsDetailed(query?: string): Promise<BinDetailed[]> {
    const params = query ? `?query=${encodeURIComponent(query)}` : '';
    const response = await this.request<BinDetailedRaw[]>(`bins/detailed${params}`, { method: 'GET' });
    return response.map((item) => ({
      bin: item.bin,
      hasContract: item.has_contract,
      customerLegalAddress: item.customer_legal_address,
      customerBankNameRu: item.customer_bank_name_ru,
    }));
  }

  async getBinInfo(binValue: string): Promise<BinDetailed> {
    const response = await this.request<BinDetailedRaw>(`bins/${encodeURIComponent(binValue)}/info`, { method: 'GET' });
    return {
      bin: response.bin,
      hasContract: response.has_contract,
      customerLegalAddress: response.customer_legal_address,
      customerBankNameRu: response.customer_bank_name_ru,
    };
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

  async fetchDashboardSummary(options?: {
    operatorId?: number | null;
    startDate?: string | null;
    endDate?: string | null;
  }): Promise<DashboardSummary> {
    const response = await this.request<DashboardSummaryRaw>('analytics/dashboard', {
      method: 'GET',
      query: {
        operator_id: options?.operatorId ?? undefined,
        start_date: options?.startDate ?? undefined,
        end_date: options?.endDate ?? undefined,
      },
    });
    return mapDashboardSummary(response);
  }

  async sendMessage(chatId: number, text: string, dialogId?: number): Promise<void> {
    await this.request('messages/send', {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, text, dialog_id: dialogId }),
    });
  }

  async setFavorite(dialogId: number, favorite: boolean): Promise<void> {
    await this.request(`dialogs/${dialogId}/favorite`, {
      method: favorite ? 'POST' : 'DELETE',
      expectJson: false,
    });
    if (this.currentUserProfile) {
      const favoriteSet = new Set(this.currentUserProfile.favoriteDialogIds);
      if (favorite) {
        favoriteSet.add(dialogId);
      } else {
        favoriteSet.delete(dialogId);
      }
      this.updateCurrentUser({ ...this.currentUserProfile, favoriteDialogIds: Array.from(favoriteSet) });
    }
  }

  async enableDialogAI(dialogId: number): Promise<void> {
    await this.request(`dialogs/${dialogId}/ai/enable`, {
      method: 'POST',
      expectJson: false,
    });
  }

  async disableDialogAI(dialogId: number): Promise<void> {
    await this.request(`dialogs/${dialogId}/ai/disable`, {
      method: 'POST',
      expectJson: false,
    });
  }

  async closeDialog(dialogId: number): Promise<DialogStatusUpdate> {
    const response = await this.request<DialogStatusUpdateRaw>(`dialogs/${dialogId}/close`, {
      method: 'POST',
    });
    return {
      chatId: response.chat_id,
      dialogId: response.dialog_id,
      dialogClosedAt: response.dialog_closed_at ? new Date(response.dialog_closed_at) : new Date(),
      aiEnabled: response.ai_enabled !== false,
    };
  }

  async openDialog(dialogId: number): Promise<DialogStatusUpdate> {
    const response = await this.request<DialogStatusUpdateRaw>(`dialogs/${dialogId}/open`, {
      method: 'POST',
    });
    return {
      chatId: response.chat_id,
      dialogId: response.dialog_id,
      dialogClosedAt: response.dialog_closed_at ? new Date(response.dialog_closed_at) : null,
      aiEnabled: response.ai_enabled !== false,
    };
  }

  async deleteDialog(dialogId: number): Promise<void> {
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

  async fetchPendingRegistrations(): Promise<PendingRegistration[]> {
    const response = await this.request<PendingRegistrationRaw[]>('users/pending', { method: 'GET' });
    return response.map((item) => ({
      id: item.id,
      email: item.email,
      name: item.name,
      createdAt: new Date(item.created_at),
    }));
  }

  async approveRegistration(userId: number): Promise<UserProfile> {
    const response = await this.request<UserProfileRaw>(`users/${userId}/approve`, { method: 'POST' });
    const profile = mapUserProfile(response);
    if (this.currentUserProfile?.id === profile.id) {
      this.updateCurrentUser(profile);
    }
    return profile;
  }

  async rejectRegistration(userId: number): Promise<void> {
    await this.request<{ status: string }>(`users/${userId}/reject`, { method: 'POST' });
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

  async updateUserBins(userId: number, bins: UserBinAssignment[]): Promise<UserProfile> {
    const payload = bins
      .filter((assignment) => assignment && assignment.bin)
      .map((assignment) => ({
        bin: assignment.bin,
        expires_at: assignment.expiresAt ? assignment.expiresAt.toISOString() : null,
      }));
    const response = await this.request<UserProfileRaw>(`users/${userId}/bins`, {
      method: 'PUT',
      body: JSON.stringify({ bins: payload }),
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