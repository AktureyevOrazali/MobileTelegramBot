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
  UploadMediaResponse,
  MessageNotificationRaw,
  MessageRaw,
  OrganizationWithoutContract,
  UploadMediaResponseRaw,
  OrganizationWithoutContractRaw,
  PendingRegistration,
  PendingRegistrationRaw,
  ReplyTemplate,
  ReplyTemplateRaw,
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
import { sanitizeUiText } from '../utils/text';

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
        '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c\u0441\u044f \u043a \u0441\u0435\u0440\u0432\u0435\u0440\u0443. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442-\u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435 \u0438 \u0430\u0434\u0440\u0435\u0441 API.',
      );
    }

    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new ApiError(message ?? 'Не удалось выполнить запрос к API.', response.status);
    }

    if (!expectJson) {
      // РЎР±СЂР°СЃС‹РІР°РµРј С‚РµР»Рѕ РѕС‚РІРµС‚Р°, С‡С‚РѕР±С‹ СЃРѕРµРґРёРЅРµРЅРёРµ РјРѕРіР»Рѕ Р±С‹С‚СЊ РїРµСЂРµРёСЃРїРѕР»СЊР·РѕРІР°РЅРѕ.
      if (response.body) {
        try {
          await response.body.cancel();
        } catch (error) {
          // РРіРЅРѕСЂРёСЂСѓРµРј РѕС€РёР±РєРё РїСЂРё РѕС‚РјРµРЅРµ С‡С‚РµРЅРёСЏ С‚РµР»Р° РѕС‚РІРµС‚Р°.
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
        message || '\u0421\u0435\u0440\u0432\u0435\u0440 \u0432\u0435\u0440\u043d\u0443\u043b \u043d\u0435\u043e\u0436\u0438\u0434\u0430\u043d\u043d\u044b\u0439 \u043e\u0442\u0432\u0435\u0442. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u043f\u043e\u043f\u044b\u0442\u043a\u0443 \u043f\u043e\u0437\u0436\u0435.',
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
    const repaired = sanitizeUiText(normalized) ?? normalized;
    switch (repaired) {
      case 'Invalid API token':
        return '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 API \u0442\u043e\u043a\u0435\u043d. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044e.';
      case 'Invalid credentials':
        return '\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u043b\u043e\u0433\u0438\u043d \u0438\u043b\u0438 \u043f\u0430\u0440\u043e\u043b\u044c.';
      case 'User already exists':
        return '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u0441 \u0442\u0430\u043a\u0438\u043c e-mail \u0443\u0436\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d.';
      case 'Administrator role required':
        return '\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043f\u0440\u0430\u0432: \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u0440\u043e\u043b\u044c \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430.';
      case '\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u043e\u0436\u0438\u0434\u0430\u0435\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440\u0430':
        return '\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u043e\u0436\u0438\u0434\u0430\u0435\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043c\u043e\u0434\u0435\u0440\u0430\u0442\u043e\u0440\u0430.';
      case 'Session token required':
      case 'Invalid session token':
        return '\u0421\u0435\u0441\u0441\u0438\u044f \u0438\u0441\u0442\u0435\u043a\u043b\u0430. \u0412\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0432\u0445\u043e\u0434 \u0437\u0430\u043d\u043e\u0432\u043e.';
      default:
        return repaired;
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
    const response = await this.request<Section[]>('sections', { method: 'GET' });
    return response.map((section) => ({
      ...section,
      id: sanitizeUiText(section.id) ?? section.id,
      title: sanitizeUiText(section.title) ?? section.title,
    }));
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
        hasContract: Boolean(item.has_contract),
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
      customerNameRu: item.customer_name_ru,
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
      customerNameRu: item.customer_name_ru,
    }));
  }

  async getBinInfo(binValue: string): Promise<BinDetailed> {
    const response = await this.request<BinDetailedRaw>(`bins/${encodeURIComponent(binValue)}/info`, { method: 'GET' });
    return {
      bin: response.bin,
      hasContract: response.has_contract,
      customerLegalAddress: response.customer_legal_address,
      customerBankNameRu: response.customer_bank_name_ru,
      customerNameRu: response.customer_name_ru,
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

  async downloadDashboardExport(options?: {
    operatorId?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    format?: 'xlsx' | 'pdf';
  }): Promise<void> {
    const query: Record<string, string | number | undefined> = {};
    if (options?.operatorId) query.operator_id = options.operatorId;
    if (options?.startDate) query.start_date = options.startDate;
    if (options?.endDate) query.end_date = options.endDate;
    if (options?.format) query.format = options.format;

    const url = this.buildUrl('analytics/export', query);
    const response = await fetch(url, {
      headers: {
        'X-Api-Token': this.apiToken,
        ...(this.session?.token ? { 'X-Session-Token': this.session.token } : {}),
      },
    });
    if (!response.ok) {
      throw new ApiError('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043a\u0430\u0447\u0430\u0442\u044c \u043e\u0442\u0447\u0451\u0442.', response.status);
    }

    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);

    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = options?.format === 'pdf' ? 'report.pdf' : 'report.xlsx';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  async uploadMedia(file: File): Promise<UploadMediaResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(this.buildUrl('uploads'), {
      method: 'POST',
      headers: {
        'X-Api-Token': this.apiToken,
        ...(this.session?.token ? { 'X-Session-Token': this.session.token } : {}),
      },
      body: formData,
    });
    if (!response.ok) {
      const message = await this.extractErrorMessage(response);
      throw new ApiError(message ?? 'Не удалось загрузить файл.', response.status);
    }
    const raw = await this.parseJsonResponse<UploadMediaResponseRaw>(response);
    return {
      status: raw.status,
      mediaId: raw.media_id,
      kind: raw.kind,
      url: raw.url,
      previewUrl: raw.preview_url ?? null,
      mimeType: raw.mime_type,
      sizeBytes: raw.size_bytes,
      originalName: raw.original_name,
      width: raw.width ?? null,
      height: raw.height ?? null,
      durationSec: raw.duration_sec ?? null,
    };
  }

  async sendMessage(chatId: number, text: string, dialogId?: number, attachmentIds: number[] = []): Promise<void> {
    await this.request('messages/send', {
      method: 'POST',
      body: JSON.stringify({ chat_id: chatId, text, dialog_id: dialogId, attachment_ids: attachmentIds }),
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
    const response = await this.request<RoleInfo[]>('roles', { method: 'GET' });
    return response.map((role) => ({
      ...role,
      id: sanitizeUiText(role.id) ?? role.id,
      title: sanitizeUiText(role.title) ?? role.title,
    }));
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

  // ---------- Reply Templates ----------

  async fetchReplyTemplates(section?: string | null): Promise<ReplyTemplate[]> {
    const response = await this.request<ReplyTemplateRaw[]>('reply-templates', {
      method: 'GET',
      query: section ? { section } : undefined,
    });
    return response.map((t) => ({
      id: t.id,
      title: t.title,
      text: t.text,
      section: t.section,
      sectionTitle: t.section_title ?? null,
      sortOrder: t.sort_order,
      createdBy: t.created_by ?? null,
      createdAt: new Date(t.created_at),
    }));
  }

  async createReplyTemplate(data: { title: string; text: string; section?: string | null; sortOrder?: number }): Promise<ReplyTemplate> {
    const response = await this.request<ReplyTemplateRaw>('reply-templates', {
      method: 'POST',
      body: JSON.stringify({
        title: data.title,
        text: data.text,
        section: data.section ?? null,
        sort_order: data.sortOrder ?? 0,
      }),
    });
    return {
      id: response.id,
      title: response.title,
      text: response.text,
      section: response.section,
      sectionTitle: response.section_title ?? null,
      sortOrder: response.sort_order,
      createdBy: response.created_by ?? null,
      createdAt: new Date(response.created_at),
    };
  }

  async updateReplyTemplate(id: number, data: { title: string; text: string; section?: string | null; sortOrder?: number }): Promise<ReplyTemplate> {
    const response = await this.request<ReplyTemplateRaw>(`reply-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: data.title,
        text: data.text,
        section: data.section ?? null,
        sort_order: data.sortOrder ?? 0,
      }),
    });
    return {
      id: response.id,
      title: response.title,
      text: response.text,
      section: response.section,
      sectionTitle: response.section_title ?? null,
      sortOrder: response.sort_order,
      createdBy: response.created_by ?? null,
      createdAt: new Date(response.created_at),
    };
  }

  async deleteReplyTemplate(id: number): Promise<void> {
    await this.request(`reply-templates/${id}`, {
      method: 'DELETE',
      expectJson: false,
    });
  }

  // ---------- SSE (Server-Sent Events) ----------

  connectToStream(callbacks: {
    onMessage?: (data: MessageRaw) => void;
  }): () => void {
    if (!this.sessionToken) {
      console.warn('Cannot connect to stream without a session token');
      return () => { };
    }

    const url = this.buildUrl('stream', {
      api_token: this.apiToken,
      session_token: this.sessionToken,
    });

    const es = new EventSource(url, {
      withCredentials: true,
    });

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'new_message' && callbacks.onMessage) {
          callbacks.onMessage(payload.data);
        }
      } catch (e) {
        console.error('Failed to parse SSE event', e);
      }
    };

    es.onerror = (err) => {
      console.error('SSE Error', err);
    };

    return () => {
      es.close();
    };
  }
}





