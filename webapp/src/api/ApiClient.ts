import {
  AiRatingsAnalytics,
  AiRatingsAnalyticsRaw,
  AuthSession,
  AuthSessionRaw,
  BinContractSyncResult,
  BinContractSyncResultRaw,
  BinDetailed,
  BinDetailedRaw,
  ChatSummary,
  ChatSummaryRaw,
  ClientRatingRow,
  ClientRatingRowRaw,
  ClientRatingsAnalytics,
  ClientRatingsAnalyticsRaw,
  DashboardSummary,
  DashboardSummaryRaw,
  DialogStatusUpdate,
  DialogStatusUpdateRaw,
  EmployeeRatingRow,
  EmployeeRatingRowRaw,
  EmployeeClientAssessmentAnalytics,
  EmployeeClientAssessmentAnalyticsRaw,
  EmployeeClientAssessmentResult,
  EmployeeClientAssessmentResultRaw,
  EmployeeClientAssessmentSubmitPayload,
  EmployeeRatingsAnalytics,
  EmployeeRatingsAnalyticsRaw,
  HrEmployee,
  HrEmployeeRaw,
  HrRequest,
  HrRequestRaw,
  HrRequestStatus,
  HrSignature,
  HrSignatureRaw,
  HrTemplate,
  HrTemplateRaw,
  Message,
  MessageNotification,
  MutualRatingMatrix,
  MutualRatingMatrixRaw,
  RatingLedgerEntry,
  RatingLedgerEntryRaw,
  RatingLedgerFilters,
  RatingLedgerResponse,
  RatingLedgerResponseRaw,
  RatingsSummary,
  RatingsSummaryEntity,
  RatingsSummaryEntityRaw,
  RatingsSummaryRaw,
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
  SurveyAnalytics,
  SurveyAnalyticsRaw,
  SurveyLaunchResult,
  SurveyQuestion,
  SurveyQuestionRaw,
  SurveyTemplate,
  SurveyTemplateAudience,
  SurveyTemplateRaw,
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

const DEFAULT_API_BASE_URL = '/api';
const BUILD_TIME_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim() || DEFAULT_API_BASE_URL;
const BUILD_TIME_API_TOKEN = (import.meta.env.VITE_API_TOKEN ?? '').trim();
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+\-.]*:/i;

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase());
}

function resolveRuntimeBaseUrl(configuredBaseUrl: string): string {
  const normalizedBaseUrl = configuredBaseUrl.trim();
  if (!normalizedBaseUrl || typeof window === 'undefined') {
    return normalizedBaseUrl;
  }

  try {
    const apiUrl = new URL(normalizedBaseUrl);
    const browserHostname = window.location.hostname.trim().toLowerCase();
    if (!browserHostname || isLoopbackHost(browserHostname) || !isLoopbackHost(apiUrl.hostname)) {
      return normalizedBaseUrl;
    }

    apiUrl.hostname = browserHostname;
    return apiUrl.toString();
  } catch {
    return normalizedBaseUrl;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  apiToken?: string;
}

export class ApiClient {
  private readonly baseUrl: string;

  private readonly apiToken: string;

  private session: AuthSession | null = null;

  private currentUserProfile: UserProfile | null = null;

  private streamSource: EventSource | null = null;

  private streamSubscribers = new Map<number, { onMessage?: (data: MessageRaw) => void }>();

  private nextStreamSubscriberId = 1;

  private streamConnectionKey: string | null = null;

  constructor(options: ApiClientOptions = {}) {
    const resolvedBaseUrl = resolveRuntimeBaseUrl(options.baseUrl ?? BUILD_TIME_BASE_URL).replace(/\/$/, '');
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
    const previousSessionToken = this.session?.token ?? null;
    this.session = session;
    this.currentUserProfile = session?.user ?? null;
    if (previousSessionToken !== this.sessionToken) {
      this.closeStreamConnection();
      if (this.streamSubscribers.size > 0 && this.sessionToken) {
        this.ensureStreamConnection();
      }
    }
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
    this.closeStreamConnection();
  }

  private ensureStreamConnection(): void {
    if (!this.sessionToken) {
      return;
    }

    const connectionKey = `${this.apiToken}:${this.sessionToken}`;
    if (this.streamSource && this.streamConnectionKey === connectionKey) {
      return;
    }

    this.closeStreamConnection();

    const url = this.buildUrl('stream', {
      api_token: this.apiToken,
      session_token: this.sessionToken,
    });

    const es = new EventSource(url, {
      withCredentials: true,
    });

    this.streamSource = es;
    this.streamConnectionKey = connectionKey;

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== 'new_message') {
          return;
        }
        for (const subscriber of this.streamSubscribers.values()) {
          subscriber.onMessage?.(payload.data);
        }
      } catch (e) {
        console.error('Failed to parse SSE event', e);
      }
    };

    es.onerror = (err) => {
      console.error('SSE Error', err);
    };
  }

  private closeStreamConnection(): void {
    if (this.streamSource) {
      this.streamSource.close();
      this.streamSource = null;
    }
    this.streamConnectionKey = null;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
    const normalizedPath = path.replace(/^\//, '');
    const normalizedBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    const url = ABSOLUTE_URL_PATTERN.test(normalizedBaseUrl)
      ? new URL(`${normalizedBaseUrl}${normalizedPath}`)
      : new URL(`${normalizedBaseUrl}${normalizedPath}`, window.location.origin);
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
      // Discard the response body so the connection can be reused.
      if (response.body) {
        try {
          await response.body.cancel();
        } catch (error) {
          // Ignore body cancellation errors.
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

  async updateProfile(payload: { name?: string; jobTitle?: string; organization?: string; phone?: string; bio?: string; email?: string }): Promise<UserProfile> {
    const body = {
      name: payload.name,
      job_title: payload.jobTitle,
      organization: payload.organization,
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

  async syncBinsWithContracts(options: { force?: boolean } = {}): Promise<BinContractSyncResult> {
    const response = await this.request<BinContractSyncResultRaw>('bins/sync', {
      method: 'POST',
      query: options.force ? { force: true } : undefined,
    });
    return {
      status: response.status,
      added: response.added,
      removed: response.removed,
      totalBins: response.total_bins,
      binsWithContracts: response.bins_with_contracts,
      staleBins: response.stale_bins,
      skipped: response.skipped,
    };
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
      dialogPurgeAt: response.dialog_purge_at ? new Date(response.dialog_purge_at) : null,
      aiEnabled: response.ai_enabled !== false,
      employeeAssessmentId: typeof response.employee_assessment_id === 'number' ? response.employee_assessment_id : null,
      employeeAssessmentPending: Boolean(response.employee_assessment_pending),
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
      dialogPurgeAt: response.dialog_purge_at ? new Date(response.dialog_purge_at) : null,
      aiEnabled: response.ai_enabled !== false,
      employeeAssessmentId: typeof response.employee_assessment_id === 'number' ? response.employee_assessment_id : null,
      employeeAssessmentPending: Boolean(response.employee_assessment_pending),
    };
  }

  async deleteDialog(dialogId: number): Promise<void> {
    await this.request(`dialogs/${dialogId}`, {
      method: 'DELETE',
      expectJson: false,
    });
  }

  async submitEmployeeClientAssessment(assessmentId: number, payload: EmployeeClientAssessmentSubmitPayload): Promise<EmployeeClientAssessmentResult> {
    const response = await this.request<EmployeeClientAssessmentResultRaw>(`employee-client-assessments/${assessmentId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        question_clarity_score: payload.questionClarityScore,
        data_completeness_score: payload.dataCompletenessScore,
        client_response_speed_score: payload.clientResponseSpeedScore,
        business_communication_score: payload.businessCommunicationScore,
        client_readiness_score: payload.clientReadinessScore,
        low_score_reason: payload.lowScoreReason ?? null,
        internal_comment: payload.internalComment ?? null,
        interaction_status: payload.interactionStatus,
        interaction_flag: payload.interactionFlag,
        request_repeat_status: payload.requestRepeatStatus,
        client_data_overdue: payload.clientDataOverdue,
      }),
    });
    return {
      id: response.id,
      dialogId: response.dialog_id,
      status: response.status,
      overallScore: response.overall_score ?? null,
      interactionQualityIndex: response.interaction_quality_index ?? null,
      submittedAt: response.submitted_at ? new Date(response.submitted_at) : null,
    };
  }

  async fetchEmployeeClientAssessmentAnalytics(options: {
    employeeId?: number | null;
    employeeName?: string | null;
    clientBin?: string | null;
  } = {}): Promise<EmployeeClientAssessmentAnalytics> {
    const response = await this.request<EmployeeClientAssessmentAnalyticsRaw>('analytics/employee-client-assessments', {
      method: 'GET',
      query: {
        employee_id: options.employeeId ?? undefined,
        employee_name: options.employeeName ?? undefined,
        client_bin: options.clientBin ?? undefined,
      },
    });
    return {
      totalAssessments: response.total_assessments,
      averageOverallScore: response.average_overall_score ?? null,
      averageInteractionQualityIndex: response.average_interaction_quality_index ?? null,
      averageFeedbackDelayHours: response.average_feedback_delay_hours ?? null,
      highScoreShare: response.high_score_share,
      lowScoreShare: response.low_score_share,
      repeatedRequestShare: response.repeated_request_share,
      firstContactShare: response.first_contact_share,
      hinderedCount: response.hindered_count,
      withoutClarificationsCount: response.without_clarifications_count,
      firstTimeFullDataShare: response.first_time_full_data_share,
      lowScoreReasons: response.low_score_reasons ?? [],
      interactionStatuses: response.interaction_statuses ?? [],
      interactionFlags: response.interaction_flags ?? [],
      requestRepeatStatuses: response.request_repeat_statuses ?? [],
      monthlyScores: (response.monthly_scores ?? []).map((item) => ({
        month: item.month,
        averageOverallScore: item.average_overall_score,
        averageInteractionQualityIndex: item.average_interaction_quality_index,
        count: item.count,
      })),
      clientRatings: (response.client_ratings ?? []).map((item) => ({
        clientBin: item.client_bin ?? null,
        clientName: item.client_name,
        taskCount: item.task_count,
        averageOverallScore: item.average_overall_score,
        averageInteractionQualityIndex: item.average_interaction_quality_index,
        highScoreShare: item.high_score_share,
        lowScoreShare: item.low_score_share,
        repeatedRequestShare: item.repeated_request_share,
        firstContactShare: item.first_contact_share,
        averageFeedbackDelayHours: item.average_feedback_delay_hours ?? null,
        hinderedCount: item.hindered_count,
        withoutClarificationsCount: item.without_clarifications_count,
        firstTimeFullDataShare: item.first_time_full_data_share,
        internalRating: item.internal_rating,
      })),
      recentAssessments: (response.recent_assessments ?? []).map((item) => ({
        id: item.id,
        clientName: item.client_name,
        clientBin: item.client_bin ?? null,
        assignedUserName: item.assigned_user_name ?? null,
        overallScore: item.overall_score ?? null,
        interactionQualityIndex: item.interaction_quality_index ?? null,
        lowScoreReason: item.low_score_reason ?? null,
        submittedAt: item.submitted_at ? new Date(item.submitted_at) : null,
        repeatedRequest: item.repeated_request,
        requestRepeatStatus: item.request_repeat_status,
        clientDataOverdue: item.client_data_overdue,
        aiAssisted: item.ai_assisted,
      })),
      updatedAt: new Date(response.updated_at),
    };
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
      title: sanitizeUiText(t.title) ?? t.title,
      text: sanitizeUiText(t.text) ?? t.text,
      section: t.section,
      sectionTitle: sanitizeUiText(t.section_title) ?? t.section_title ?? null,
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
      title: sanitizeUiText(response.title) ?? response.title,
      text: sanitizeUiText(response.text) ?? response.text,
      section: response.section,
      sectionTitle: sanitizeUiText(response.section_title) ?? response.section_title ?? null,
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
      title: sanitizeUiText(response.title) ?? response.title,
      text: sanitizeUiText(response.text) ?? response.text,
      section: response.section,
      sectionTitle: sanitizeUiText(response.section_title) ?? response.section_title ?? null,
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

  // ---------- HR Requests ----------

  private mapHrTemplate(raw: HrTemplateRaw): HrTemplate {
    return {
      id: raw.id,
      title: sanitizeUiText(raw.title) || raw.title,
      type: raw.type,
      description: sanitizeUiText(raw.description) || '',
      body: raw.body,
      variables: raw.variables ?? [],
      status: raw.status,
      createdBy: raw.created_by ?? null,
      createdAt: new Date(raw.created_at),
      updatedAt: new Date(raw.updated_at),
    };
  }

  private mapHrRequest(raw: HrRequestRaw): HrRequest {
    return {
      id: raw.id,
      templateId: raw.template_id ?? null,
      templateTitle: sanitizeUiText(raw.template_title) || raw.template_title || '',
      type: raw.type,
      employeeId: raw.employee_id ?? null,
      employeeName: sanitizeUiText(raw.employee_name) || raw.employee_name,
      department: sanitizeUiText(raw.department) || '',
      status: raw.status,
      values: raw.values ?? {},
      renderedText: sanitizeUiText(raw.rendered_text) || raw.rendered_text,
      summary: sanitizeUiText(raw.summary) || '',
      period: sanitizeUiText(raw.period) || '',
      submittedAt: new Date(raw.submitted_at),
      updatedAt: new Date(raw.updated_at),
      decidedAt: raw.decided_at ? new Date(raw.decided_at) : null,
      decidedBy: raw.decided_by ?? null,
      decidedByName: raw.decided_by_name ? sanitizeUiText(raw.decided_by_name) || raw.decided_by_name : null,
      decisionComment: sanitizeUiText(raw.decision_comment) || '',
      employeeSignature: this.mapHrSignature(raw.employee_signature),
      hrSignature: this.mapHrSignature(raw.hr_signature),
      events: (raw.events ?? []).map((event) => ({
        id: event.id,
        requestId: event.request_id,
        action: event.action,
        actorId: event.actor_id ?? null,
        actorName: sanitizeUiText(event.actor_name) || event.actor_name,
        comment: sanitizeUiText(event.comment) || '',
        createdAt: new Date(event.created_at),
      })),
    };
  }

  private mapHrSignature(raw?: HrSignatureRaw | null): HrSignature | null {
    if (!raw) return null;
    return {
      signature: raw.signature,
      signedPayload: raw.signed_payload,
      signedAt: raw.signed_at,
      certificateSubject: raw.certificate_subject ?? null,
      certificateSerial: raw.certificate_serial ?? null,
      certificatePem: raw.certificate_pem ?? null,
    };
  }

  async fetchHrTemplates(): Promise<HrTemplate[]> {
    const response = await this.request<HrTemplateRaw[]>('hr/templates', { method: 'GET' });
    return response.map((template) => this.mapHrTemplate(template));
  }

  async fetchHrEmployees(query?: string): Promise<HrEmployee[]> {
    const response = await this.request<HrEmployeeRaw[]>('hr/employees', {
      method: 'GET',
      query: query ? { query } : undefined,
    });
    return response.map((employee) => ({
      ...mapUserProfile(employee),
      schedule: sanitizeUiText(employee.schedule) || '09:00-18:00',
    }));
  }

  async updateHrEmployeeOrganization(userId: number, organization: string): Promise<HrEmployee> {
    const response = await this.request<HrEmployeeRaw>(`hr/employees/${userId}/organization`, {
      method: 'PUT',
      body: JSON.stringify({ organization }),
    });
    return {
      ...mapUserProfile(response),
      schedule: sanitizeUiText(response.schedule) || '09:00-18:00',
    };
  }

  async createHrTemplate(data: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<HrTemplate> {
    const response = await this.request<HrTemplateRaw>('hr/templates', {
      method: 'POST',
      body: JSON.stringify({
        title: data.title,
        type: data.type,
        description: data.description,
        body: data.body,
        variables: data.variables,
        status: data.status,
      }),
    });
    return this.mapHrTemplate(response);
  }

  async updateHrTemplate(id: number, data: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<HrTemplate> {
    const response = await this.request<HrTemplateRaw>(`hr/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: data.title,
        type: data.type,
        description: data.description,
        body: data.body,
        variables: data.variables,
        status: data.status,
      }),
    });
    return this.mapHrTemplate(response);
  }

  async fetchHrRequests(): Promise<HrRequest[]> {
    const response = await this.request<HrRequestRaw[]>('hr/requests', { method: 'GET' });
    return response.map((request) => this.mapHrRequest(request));
  }

  async createHrRequest(data: {
    templateId: number;
    values: Record<string, unknown>;
    summary?: string;
    period?: string;
    employeeSignature: HrSignature;
  }): Promise<HrRequest> {
    const response = await this.request<HrRequestRaw>('hr/requests', {
      method: 'POST',
      body: JSON.stringify({
        template_id: data.templateId,
        values: data.values,
        summary: data.summary ?? '',
        period: data.period ?? '',
        employee_signature: {
          signature: data.employeeSignature.signature,
          signed_payload: data.employeeSignature.signedPayload,
          signed_at: data.employeeSignature.signedAt,
          certificate_subject: data.employeeSignature.certificateSubject,
          certificate_serial: data.employeeSignature.certificateSerial,
          certificate_pem: data.employeeSignature.certificatePem,
        },
      }),
    });
    return this.mapHrRequest(response);
  }

  async decideHrRequest(
    id: number,
    data: {
      status: Extract<HrRequestStatus, 'approved' | 'rejected' | 'needsInfo'>;
      comment?: string;
      hrSignature?: HrSignature | null;
    },
  ): Promise<HrRequest> {
    const response = await this.request<HrRequestRaw>(`hr/requests/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        status: data.status,
        comment: data.comment ?? '',
        ...(data.hrSignature ? {
          hr_signature: {
            signature: data.hrSignature.signature,
            signed_payload: data.hrSignature.signedPayload,
            signed_at: data.hrSignature.signedAt,
            certificate_subject: data.hrSignature.certificateSubject,
            certificate_serial: data.hrSignature.certificateSerial,
            certificate_pem: data.hrSignature.certificatePem,
          },
        } : {}),
      }),
    });
    return this.mapHrRequest(response);
  }

  async downloadHrRequestDocument(id: number, format: 'doc' | 'pdf'): Promise<void> {
    const url = this.buildUrl(`hr/requests/${id}/document.${format}`);
    const response = await fetch(url, {
      headers: {
        'X-Api-Token': this.apiToken,
        ...(this.session?.token ? { 'X-Session-Token': this.session.token } : {}),
      },
    });
    if (!response.ok) {
      throw new ApiError('Не удалось скачать заявление.', response.status);
    }

    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hr-request-${id}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // ---------- Customer Surveys ----------

  private mapSurveyQuestion(raw: SurveyQuestionRaw): SurveyQuestion {
    return {
      id: raw.id,
      templateId: raw.template_id,
      sortOrder: raw.sort_order ?? 0,
      questionType: raw.question_type,
      text: raw.text,
      topic: raw.topic ?? null,
      required: raw.required !== false,
      anonymityMode: raw.anonymity_mode ?? 'inherit',
      config: raw.config ?? {},
      createdAt: raw.created_at ? new Date(raw.created_at) : null,
      updatedAt: raw.updated_at ? new Date(raw.updated_at) : null,
    };
  }

  private mapSurveyTemplate(raw: SurveyTemplateRaw): SurveyTemplate {
    return {
      id: raw.id,
      title: raw.title,
      description: raw.description ?? '',
      audience: raw.audience ?? 'client',
      status: raw.status,
      triggerType: raw.trigger_type,
      periodicInterval: raw.periodic_interval ?? null,
      scheduledAt: raw.scheduled_at ?? null,
      launchRules: (raw.launch_rules ?? []).map((rule) => ({
        type: rule.type,
        schedule: rule.schedule,
        dates: rule.dates ?? [],
      })),
      isAnonymous: raw.is_anonymous,
      createdBy: raw.created_by ?? null,
      createdAt: new Date(raw.created_at),
      updatedAt: new Date(raw.updated_at),
      questions: (raw.questions ?? []).map((question) => this.mapSurveyQuestion(question)),
    };
  }

  private surveyTemplatePayload(data: Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>) {
    return {
      title: data.title,
      description: data.description,
      audience: data.audience,
      status: data.status,
      trigger_type: data.triggerType,
      periodic_interval: data.periodicInterval,
      scheduled_at: data.scheduledAt,
      launch_rules: data.launchRules.map((rule) => ({
        type: rule.type,
        schedule: rule.schedule,
        dates: rule.dates ?? [],
      })),
      is_anonymous: data.isAnonymous,
      questions: data.questions.map((question, index) => ({
        text: question.text,
        question_type: question.questionType,
        topic: question.topic,
        required: question.required,
        anonymity_mode: question.anonymityMode,
        config: question.config ?? {},
        sort_order: question.sortOrder || index + 1,
      })),
    };
  }

  private mapSurveyAnalytics(raw: SurveyAnalyticsRaw): SurveyAnalytics {
    return {
      averageScore: raw.average_score ?? null,
      completedSurveyCount: raw.completed_survey_count ?? 0,
      answerCount: raw.answer_count ?? raw.answers_total_count ?? raw.answers?.length ?? 0,
      scoreCount: raw.score_count,
      positiveCount: raw.positive_count,
      neutralCount: raw.neutral_count,
      negativeCount: raw.negative_count,
      positiveShare: raw.positive_share,
      neutralShare: raw.neutral_share,
      negativeShare: raw.negative_share,
      topClientRequests: raw.top_client_requests ?? [],
      topTrainingWishes: raw.top_training_wishes ?? [],
      employeeRemarks: raw.employee_remarks ?? [],
      questionAnalytics: (raw.question_analytics ?? []).map((item) => ({
        questionId: item.question_id,
        questionText: item.question_text,
        questionType: item.question_type,
        topic: item.topic ?? null,
        sortOrder: item.sort_order,
        answerCount: item.answer_count,
        averageScore: item.average_score ?? null,
        scoreDistribution: item.score_distribution ?? [],
        topAnswers: item.top_answers ?? [],
      })),
      monthlySatisfaction: (raw.monthly_satisfaction ?? []).map((item) => ({ month: item.month, averageScore: item.average_score, count: item.count })),
      answers: (raw.answers ?? []).map((item) => ({
        id: item.id,
        sessionId: item.session_id,
        templateId: item.template_id,
        templateTitle: item.template_title,
        questionId: item.question_id,
        questionText: item.question_text,
        questionType: item.question_type,
        topic: item.topic ?? null,
        numericScore: item.numeric_score ?? null,
        rawText: item.raw_text,
        selectedOptions: item.selected_options ?? [],
        selectedEmployeeName: item.selected_employee_name ?? null,
        createdAt: new Date(item.created_at),
        chatId: item.chat_id ?? null,
        dialogId: item.dialog_id ?? null,
        appealId: item.appeal_id ?? null,
        bin: item.bin ?? null,
        organization: item.organization ?? null,
        chatTitle: item.chat_title ?? null,
        operators: item.operators ?? [],
        isAnonymous: item.effective_is_anonymous ?? item.is_anonymous,
        section: item.section ?? null,
      })),
      answersPreviewLimited: Boolean(raw.answers_preview_limited),
      updatedAt: new Date(raw.updated_at),
    };
  }

  private mapRatingsSummaryEntity(raw: RatingsSummaryEntityRaw | null | undefined): RatingsSummaryEntity {
    return {
      averageScore: raw?.average_score ?? null,
      ratingCount: raw?.rating_count ?? 0,
      highScoreShare: raw?.high_score_share ?? 0,
      lowScoreShare: raw?.low_score_share ?? 0,
      averageResolutionMinutes: raw?.average_resolution_minutes ?? null,
      withoutRepeatShare: raw?.without_repeat_share ?? null,
      withoutEscalationShare: raw?.without_escalation_share ?? null,
      aiAssistedShare: raw?.ai_assisted_share ?? null,
      closureCorrectness: raw?.closure_correctness ?? null,
      fullDataFirstTimeShare: raw?.full_data_first_time_share ?? 0,
      assessmentCount: raw?.assessment_count ?? 0,
      averageFeedbackDelayHours: raw?.average_feedback_delay_hours ?? null,
      repeatedRequestShare: raw?.repeated_request_share ?? 0,
      hinderedCount: raw?.hindered_count ?? 0,
      interactionQualityIndex: raw?.interaction_quality_index ?? null,
      aiUsageShare: raw?.ai_usage_share ?? null,
      inaccurateShare: raw?.inaccurate_share ?? 0,
      manualCorrectionShare: raw?.manual_correction_share ?? null,
      clientFeedbackCount: raw?.client_feedback_count ?? 0,
      employeeFeedbackCount: raw?.employee_feedback_count ?? 0,
      notAvailable: raw?.not_available ?? [],
    };
  }

  private mapEmployeeRatingRow(raw: EmployeeRatingRowRaw): EmployeeRatingRow {
    return {
      employeeId: raw.employee_id ?? null,
      employeeName: sanitizeUiText(raw.employee_name) ?? raw.employee_name,
      averageScore: raw.average_score ?? null,
      ratedAppealsCount: raw.rated_appeals_count,
      highScoreShare: raw.high_score_share,
      lowScoreShare: raw.low_score_share,
      averageResolutionMinutes: raw.average_resolution_minutes ?? null,
      withoutRepeatShare: raw.without_repeat_share ?? null,
      withoutEscalationShare: raw.without_escalation_share ?? null,
      aiAssistedShare: raw.ai_assisted_share ?? null,
      closureCorrectness: raw.closure_correctness ?? null,
      totalLowRatings: raw.total_low_ratings,
    };
  }

  private mapClientRatingRow(raw: ClientRatingRowRaw): ClientRatingRow {
    return {
      clientBin: raw.client_bin ?? null,
      clientName: sanitizeUiText(raw.client_name) ?? raw.client_name,
      completedAppealsCount: raw.completed_appeals_count,
      averageScore: raw.average_score ?? null,
      interactionQualityIndex: raw.interaction_quality_index ?? null,
      fullDataFirstTimeShare: raw.full_data_first_time_share,
      averageFeedbackDelayHours: raw.average_feedback_delay_hours ?? null,
      repeatedRequestShare: raw.repeated_request_share,
      hinderedCount: raw.hindered_count,
      recommendation: sanitizeUiText(raw.recommendation) ?? raw.recommendation ?? null,
    };
  }

  private mapAiRatingRow(raw: { section?: string | null; average_score?: number | null; rating_count: number; low_score_share: number }) {
    return {
      section: sanitizeUiText(raw.section) ?? raw.section ?? null,
      averageScore: raw.average_score ?? null,
      ratingCount: raw.rating_count,
      lowScoreShare: raw.low_score_share,
    };
  }

  private mapRatingLedgerEntry(raw: RatingLedgerEntryRaw): RatingLedgerEntry {
    return {
      ratingId: raw.rating_id,
      sourceTable: raw.source_table,
      sourceKind: raw.source_kind,
      appealId: raw.appeal_id ?? null,
      dialogId: raw.dialog_id ?? null,
      chatId: raw.chat_id ?? null,
      clientId: raw.client_id ?? null,
      clientBin: sanitizeUiText(raw.client_bin) ?? raw.client_bin ?? null,
      clientName: sanitizeUiText(raw.client_name) ?? raw.client_name ?? null,
      organization: sanitizeUiText(raw.organization) ?? raw.organization ?? null,
      section: sanitizeUiText(raw.section) ?? raw.section ?? null,
      region: sanitizeUiText(raw.region) ?? raw.region ?? null,
      raterType: raw.rater_type,
      raterId: raw.rater_id ?? null,
      raterName: sanitizeUiText(raw.rater_name) ?? raw.rater_name ?? null,
      ratedObjectType: raw.rated_object_type,
      ratedObjectId: raw.rated_object_id ?? null,
      ratedObjectName: sanitizeUiText(raw.rated_object_name) ?? raw.rated_object_name ?? null,
      employeeId: raw.employee_id ?? null,
      employeeName: sanitizeUiText(raw.employee_name) ?? raw.employee_name ?? null,
      ratingChannel: raw.rating_channel ?? null,
      aiInvolved: Boolean(raw.ai_involved),
      finalScore: raw.final_score ?? null,
      comment: sanitizeUiText(raw.comment) ?? raw.comment ?? null,
      lowScoreReason: sanitizeUiText(raw.low_score_reason) ?? raw.low_score_reason ?? null,
      parameterDetails: raw.parameter_details ?? {},
      createdAt: new Date(raw.created_at),
      status: raw.status,
      scenario: raw.scenario ?? null,
    };
  }

  async fetchSurveyTemplates(status?: string | null): Promise<SurveyTemplate[]> {
    const response = await this.request<SurveyTemplateRaw[]>('surveys/templates', {
      method: 'GET',
      query: status ? { status } : undefined,
    });
    return response.map((template) => this.mapSurveyTemplate(template));
  }

  async createSurveyTemplate(data: Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<SurveyTemplate> {
    const response = await this.request<SurveyTemplateRaw>('surveys/templates', {
      method: 'POST',
      body: JSON.stringify(this.surveyTemplatePayload(data)),
    });
    return this.mapSurveyTemplate(response);
  }

  async updateSurveyTemplate(id: number, data: Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>): Promise<SurveyTemplate> {
    const response = await this.request<SurveyTemplateRaw>(`surveys/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(this.surveyTemplatePayload(data)),
    });
    return this.mapSurveyTemplate(response);
  }

  async duplicateSurveyTemplate(id: number): Promise<SurveyTemplate> {
    const response = await this.request<SurveyTemplateRaw>(`surveys/templates/${id}/duplicate`, { method: 'POST' });
    return this.mapSurveyTemplate(response);
  }

  async deleteSurveyTemplate(id: number): Promise<void> {
    await this.request(`surveys/templates/${id}`, { method: 'DELETE', expectJson: false });
  }

  async launchSurvey(data: { templateId: number; binValues?: string[]; dialogIds?: number[] }): Promise<SurveyLaunchResult> {
    return this.request<SurveyLaunchResult>('surveys/manual-launch', {
      method: 'POST',
      body: JSON.stringify({ template_id: data.templateId, bin_values: data.binValues ?? [], dialog_ids: data.dialogIds ?? [] }),
    });
  }

  async fetchSurveyAnalytics(options: {
    audience?: SurveyTemplateAudience | null;
    startDate?: string | null;
    endDate?: string | null;
    operatorName?: string | null;
    bin?: string | null;
    region?: string | null;
    topic?: string | null;
    templateId?: number | null;
    section?: string | null;
  } = {}): Promise<SurveyAnalytics> {
    const response = await this.request<SurveyAnalyticsRaw>('analytics/surveys', {
      method: 'GET',
      query: {
        audience: options.audience ?? undefined,
        start_date: options.startDate ?? undefined,
        end_date: options.endDate ?? undefined,
        operator_name: options.operatorName ?? undefined,
        bin: options.bin ?? undefined,
        region: options.region ?? undefined,
        topic: options.topic ?? undefined,
        template_id: options.templateId ?? undefined,
        section: options.section ?? undefined,
      },
    });
    return this.mapSurveyAnalytics(response);
  }

  async fetchRatingsSummary(): Promise<RatingsSummary> {
    const response = await this.request<RatingsSummaryRaw>('analytics/ratings/summary', {
      method: 'GET',
    });
    return {
      employees: this.mapRatingsSummaryEntity(response.employees),
      clients: this.mapRatingsSummaryEntity(response.clients),
      ai: this.mapRatingsSummaryEntity(response.ai),
      missingFlows: response.missing_flows ?? [],
      updatedAt: new Date(response.updated_at),
    };
  }

  async fetchEmployeeRatingsAnalytics(options: {
    employeeId?: number | null;
    employeeName?: string | null;
  } = {}): Promise<EmployeeRatingsAnalytics> {
    const response = await this.request<EmployeeRatingsAnalyticsRaw>('analytics/ratings/employees', {
      method: 'GET',
      query: {
        employee_id: options.employeeId ?? undefined,
        employee_name: options.employeeName ?? undefined,
      },
    });
    return {
      summary: this.mapRatingsSummaryEntity(response.summary),
      rows: (response.rows ?? []).map((item) => this.mapEmployeeRatingRow(item)),
      monthlyDynamics: (response.monthly_dynamics ?? []).map((item) => ({
        month: item.month,
        averageScore: item.average_score ?? null,
        ratingCount: item.rating_count,
      })),
      lowScoreReasons: response.low_score_reasons ?? [],
      aiImpact: (response.ai_impact ?? []).map((item) => ({
        label: sanitizeUiText(item.label) ?? item.label,
        averageScore: item.average_score ?? null,
        ratingCount: item.rating_count,
      })),
      topEmployees: (response.top_employees ?? []).map((item) => this.mapEmployeeRatingRow(item)),
      problemEmployees: (response.problem_employees ?? []).map((item) => this.mapEmployeeRatingRow(item)),
      updatedAt: new Date(response.updated_at),
    };
  }

  async fetchClientRatingsAnalytics(): Promise<ClientRatingsAnalytics> {
    const response = await this.request<ClientRatingsAnalyticsRaw>('analytics/ratings/clients', {
      method: 'GET',
    });
    return {
      summary: this.mapRatingsSummaryEntity(response.summary),
      rows: (response.rows ?? []).map((item) => this.mapClientRatingRow(item)),
      monthlyDynamics: (response.monthly_dynamics ?? []).map((item) => ({
        month: item.month,
        averageScore: item.average_score ?? null,
        interactionQualityIndex: item.interaction_quality_index ?? null,
        count: item.count,
      })),
      lowScoreReasons: response.low_score_reasons ?? [],
      interactionStatuses: response.interaction_statuses ?? [],
      interactionFlags: response.interaction_flags ?? [],
      requestRepeatStatuses: response.request_repeat_statuses ?? [],
      supportCandidates: (response.support_candidates ?? []).map((item) => this.mapClientRatingRow(item)),
      recentAssessments: (response.recent_assessments ?? []).map((item) => ({
        id: item.id,
        clientName: item.client_name,
        clientBin: item.client_bin ?? null,
        assignedUserName: item.assigned_user_name ?? null,
        overallScore: item.overall_score ?? null,
        interactionQualityIndex: item.interaction_quality_index ?? null,
        lowScoreReason: item.low_score_reason ?? null,
        submittedAt: item.submitted_at ? new Date(item.submitted_at) : null,
        repeatedRequest: item.repeated_request,
        requestRepeatStatus: item.request_repeat_status,
        clientDataOverdue: item.client_data_overdue,
        aiAssisted: item.ai_assisted,
      })),
      updatedAt: new Date(response.updated_at),
    };
  }

  async fetchAiRatingsAnalytics(): Promise<AiRatingsAnalytics> {
    const response = await this.request<AiRatingsAnalyticsRaw>('analytics/ratings/ai', {
      method: 'GET',
    });
    return {
      summary: this.mapRatingsSummaryEntity(response.summary),
      rows: (response.rows ?? []).map((item) => this.mapAiRatingRow(item)),
      monthlyDynamics: (response.monthly_dynamics ?? []).map((item) => ({
        month: item.month,
        averageScore: item.average_score ?? null,
        ratingCount: item.rating_count,
      })),
      lowScoreReasons: response.low_score_reasons ?? [],
      scenarioComparison: (response.scenario_comparison ?? []).map((item) => ({
        scenario: item.scenario,
        label: sanitizeUiText(item.label) ?? item.label,
        casesCount: item.cases_count,
        averageScore: item.average_score ?? null,
      })),
      topUsefulSections: (response.top_useful_sections ?? []).map((item) => this.mapAiRatingRow(item)),
      reviewRequiredSections: (response.review_required_sections ?? []).map((item) => this.mapAiRatingRow(item)),
      updatedAt: new Date(response.updated_at),
    };
  }

  async fetchMutualRatingMatrix(): Promise<MutualRatingMatrix> {
    const response = await this.request<MutualRatingMatrixRaw>('analytics/ratings/matrix', {
      method: 'GET',
    });
    return {
      cells: (response.cells ?? []).map((item) => ({
        code: item.code,
        raterType: item.rater_type,
        ratedObjectType: item.rated_object_type,
        label: sanitizeUiText(item.label) ?? item.label,
        count: item.count,
        averageScore: item.average_score ?? null,
        status: item.status,
      })),
      updatedAt: new Date(response.updated_at),
    };
  }

  async fetchRatingLedger(filters: RatingLedgerFilters = {}): Promise<RatingLedgerResponse> {
    const response = await this.request<RatingLedgerResponseRaw>('analytics/ratings/ledger', {
      method: 'GET',
      query: {
        start_date: filters.startDate ?? undefined,
        end_date: filters.endDate ?? undefined,
        rater_type: filters.raterType ?? undefined,
        rated_object_type: filters.ratedObjectType ?? undefined,
        employee_id: filters.employeeId ?? undefined,
        employee_name: filters.employeeName ?? undefined,
        client_bin: filters.clientBin ?? undefined,
        client_id: filters.clientId ?? undefined,
        section: filters.section ?? undefined,
        region: filters.region ?? undefined,
        organization: filters.organization ?? undefined,
        ai_involved: filters.aiInvolved ?? undefined,
        channel: filters.channel ?? undefined,
        limit: filters.limit ?? 50,
        offset: filters.offset ?? 0,
      },
    });
    return {
      items: (response.items ?? []).map((item) => this.mapRatingLedgerEntry(item)),
      total: response.total,
      limit: response.limit,
      offset: response.offset,
      updatedAt: new Date(response.updated_at),
    };
  }

  // ---------- SSE (Server-Sent Events) ----------

  connectToStream(callbacks: {
    onMessage?: (data: MessageRaw) => void;
  }): () => void {
    if (!this.sessionToken) {
      console.warn('Cannot connect to stream without a session token');
      return () => { };
    }

    const subscriberId = this.nextStreamSubscriberId++;
    this.streamSubscribers.set(subscriberId, callbacks);
    this.ensureStreamConnection();

    return () => {
      this.streamSubscribers.delete(subscriberId);
      if (this.streamSubscribers.size === 0) {
        this.closeStreamConnection();
      }
    };
  }
}





