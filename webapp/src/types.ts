export interface UserBinAssignmentRaw {
  bin: string;
  assigned_at: string;
  expires_at?: string | null;
  assigned_by?: number | null;
}

export interface UserBinAssignment {
  bin: string;
  assignedAt: Date;
  expiresAt: Date | null;
  assignedBy?: number | null;
}

export interface UnassignedBinRaw {
  bin: string;
  open_dialogs: number;
}

export interface UnassignedBin {
  bin: string;
  openDialogs: number;
}

export interface OrganizationWithoutContractRaw {
  customer_bin: string;
  customer_legal_address: string | null;
  customer_bank_name_ru: string | null;
  created_at: string;
}

export interface OrganizationWithoutContract {
  customerBin: string;
  customerLegalAddress: string | null;
  customerBankNameRu: string | null;
  createdAt: Date;
}

export interface BinDetailedRaw {
  bin: string;
  has_contract: boolean;
  customer_legal_address: string | null;
  customer_bank_name_ru: string | null;
}

export interface BinDetailed {
  bin: string;
  hasContract: boolean;
  customerLegalAddress: string | null;
  customerBankNameRu: string | null;
}

export interface UserProfileRaw {
  id: number;
  email: string;
  login: string;
  name: string;
  created_at: string;
  job_title: string;
  phone: string;
  bio: string;
  role: string;
  is_approved?: boolean;
  sections: string[];
  bins: (string | UserBinAssignmentRaw)[];
  favorite_dialog_ids: number[];
}

export interface AuthSessionRaw {
  token: string;
  user: UserProfileRaw;
}

export interface RegisterStatus {
  status: string;
  message: string;
}

export interface Section {
  id: string;
  title: string;
}

export interface ChatSummaryRaw {
  chat_id: number;
  dialog_id: number;
  title: string;
  username?: string | null;
  type: string;
  updated_at: string;
  dialog_started_at: string;
  dialog_closed_at?: string | null;
  section?: string | null;
  section_title?: string | null;
  bin?: string | null;
  is_favorite: boolean;
  operator_mode?: boolean;
  unread_count?: number;
}

export interface DialogStatusUpdateRaw {
  chat_id: number;
  dialog_id: number;
  dialog_closed_at?: string | null;
  ai_enabled?: boolean;
}

export interface MessageRaw {
  id: number;
  chat_id: number;
  direction: 'incoming' | 'outgoing';
  text: string;
  author?: string | null;
  created_at: string;
  section?: string | null;
  section_title?: string | null;
  dialog_id?: number | null;
}

export interface MessageNotificationRaw {
  type: 'message' | 'bin_assignment' | string;
  chat_id?: number | null;
  chat_title?: string | null;
  text: string;
  created_at: string;
  section?: string | null;
  section_title?: string | null;
  bin?: string | null;
  dialog_id?: number | null;
}

export interface RoleInfo {
  id: string;
  title: string;
}

export interface UserProfile {
  id: number;
  email: string;
  login: string;
  name: string;
  createdAt: Date;
  jobTitle: string;
  phone: string;
  bio: string;
  role: string;
  isApproved: boolean;
  sections: string[];
  bins: UserBinAssignment[];
  favoriteDialogIds: number[];
  isAdmin: boolean;
  canReply: boolean;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
}

export interface PendingRegistration {
  id: number;
  email: string;
  name: string;
  createdAt: Date;
}

export interface PendingRegistrationRaw {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

export interface ChatSummary {
  chatId: number;
  dialogId: number;
  title: string;
  username?: string | null;
  type: string;
  updatedAt: Date;
  dialogStartedAt: Date;
  dialogClosedAt: Date | null;
  section?: string | null;
  sectionTitle?: string | null;
  bin?: string | null;
  isFavorite: boolean;
  aiEnabled: boolean;
  unreadCount: number;
}

export interface DialogStatusUpdate {
  chatId: number;
  dialogId: number;
  dialogClosedAt: Date | null;
  aiEnabled: boolean;
}

export interface Message {
  id: number;
  chatId: number;
  direction: 'incoming' | 'outgoing';
  text: string;
  author?: string | null;
  createdAt: Date;
  section?: string | null;
  sectionTitle?: string | null;
  dialogId?: number | null;
}

export interface MessageNotification {
  type: 'message' | 'bin_assignment' | string;
  chatId?: number | null;
  chatTitle?: string | null;
  text: string;
  createdAt: Date;
  section?: string | null;
  sectionTitle?: string | null;
  bin?: string | null;
  dialogId?: number | null;
}

export interface DashboardSectionStatRaw {
  section: string | null;
  title: string;
  dialogs: number;
  percentage: number;
}

export interface DashboardTopQuestionRaw {
  question: string;
  count: number;
}

export interface DashboardSectionTopQuestionsRaw {
  section: string | null;
  title: string;
  questions: DashboardTopQuestionRaw[];
}

export interface DashboardAgentStatRaw {
  name: string;
  dialogs: number;
  messages: number;
  avg_messages_per_dialog: number;
  avg_response_time_minutes?: number | null;
  last_activity: string | null;
}

export interface DashboardActivityPointRaw {
  date: string;
  dialogs: number;
  incoming_messages: number;
}

export interface DashboardResponseTimeDialogRaw {
  chat_id?: number | null;
  dialog_id?: number | null;
  author: string;
  response_time_minutes: number;
}

export interface DashboardSummaryRaw {
  total_dialogs: number;
  open_dialogs: number;
  closed_dialogs: number;
  total_chats: number;
  total_messages?: number;
  total_incoming_messages?: number;
  total_outgoing_messages?: number;
  average_messages_per_dialog?: number | null;
  avg_dialog_duration_minutes?: number | null;
  avg_response_time_minutes?: number | null;
  avg_response_time_seconds?: number | null;
  response_time_dialogs?: DashboardResponseTimeDialogRaw[];
  section_breakdown?: DashboardSectionStatRaw[];
  top_questions?: DashboardTopQuestionRaw[];
  questions_by_section?: DashboardSectionTopQuestionsRaw[];
  agent_breakdown?: DashboardAgentStatRaw[];
  recent_activity?: DashboardActivityPointRaw[];
  updated_at?: string;
}

export interface DashboardSectionStat {
  section: string | null;
  title: string;
  dialogs: number;
  percentage: number;
}

export interface DashboardTopQuestion {
  question: string;
  count: number;
}

export interface DashboardSectionTopQuestions {
  section: string | null;
  title: string;
  questions: DashboardTopQuestion[];
}

export interface DashboardAgentStat {
  name: string;
  dialogs: number;
  messages: number;
  avgMessagesPerDialog: number;
  avgResponseTimeMinutes: number | null;
  lastActivity: Date | null;
}

export interface DashboardActivityPoint {
  date: string;
  dialogs: number;
  incomingMessages: number;
}

export interface DashboardResponseTimeDialog {
  chatId: number | null;
  dialogId: number | null;
  author: string;
  responseTimeMinutes: number;
}

export interface DashboardSummary {
  totalDialogs: number;
  openDialogs: number;
  closedDialogs: number;
  totalChats: number;
  totalMessages: number;
  totalIncomingMessages: number;
  totalOutgoingMessages: number;
  averageMessagesPerDialog: number;
  avgDialogDurationMinutes: number | null;
  avgResponseTimeMinutes: number | null;
  responseTimeDialogs: DashboardResponseTimeDialog[];
  sectionBreakdown: DashboardSectionStat[];
  topQuestions: DashboardTopQuestion[];
  questionsBySection: DashboardSectionTopQuestions[];
  agentBreakdown: DashboardAgentStat[];
  recentActivity: DashboardActivityPoint[];
  updatedAt: Date;
}