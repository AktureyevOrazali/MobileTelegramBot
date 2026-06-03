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
  has_contract: boolean;
}

export interface UnassignedBin {
  bin: string;
  openDialogs: number;
  hasContract: boolean;
}

export interface OrganizationWithoutContractRaw {
  customer_bin: string;
  customer_legal_address: string | null;
  customer_bank_name_ru: string | null;
  customer_name_ru: string | null;
  created_at: string;
}

export interface OrganizationWithoutContract {
  customerBin: string;
  customerLegalAddress: string | null;
  customerBankNameRu: string | null;
  customerNameRu: string | null;
  createdAt: Date;
}

export interface BinDetailedRaw {
  bin: string;
  has_contract: boolean;
  customer_legal_address: string | null;
  customer_bank_name_ru: string | null;
  customer_name_ru: string | null;
}

export interface BinDetailed {
  bin: string;
  hasContract: boolean;
  customerLegalAddress: string | null;
  customerBankNameRu: string | null;
  customerNameRu: string | null;
}

export interface BinContractSyncResult {
  status: string;
  added?: number;
  removed?: number;
  totalBins?: number;
  binsWithContracts?: number;
  staleBins?: number;
  skipped?: boolean;
}

export interface BinContractSyncResultRaw {
  status: string;
  added?: number;
  removed?: number;
  total_bins?: number;
  bins_with_contracts?: number;
  stale_bins?: number;
  skipped?: boolean;
}

export interface UserProfileRaw {
  id: number;
  email: string;
  login: string;
  name: string;
  created_at: string;
  job_title: string;
  organization?: string;
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
  last_message_text?: string | null;
  last_message_direction?: 'incoming' | 'outgoing' | null;
  last_message_author?: string | null;
  last_message_has_attachments?: boolean;
  last_message_attachment_kind?: 'image' | 'video' | string | null;
  employee_assessment_id?: number | null;
  employee_assessment_pending?: boolean;
  employee_assessment_created_at?: string | null;
}

export interface DialogStatusUpdateRaw {
  chat_id: number;
  dialog_id: number;
  dialog_closed_at?: string | null;
  ai_enabled?: boolean;
  employee_assessment_id?: number | null;
  employee_assessment_pending?: boolean;
}

export interface EmployeeClientAssessmentSubmitPayload {
  questionClarityScore: number;
  dataCompletenessScore: number;
  clientResponseSpeedScore: number;
  businessCommunicationScore: number;
  clientReadinessScore: number;
  lowScoreReason?: string | null;
  internalComment?: string | null;
  interactionStatus: 'provided_all' | 'provided_partial' | 'provided_none';
  interactionFlag: 'constructive' | 'repeated_clarifications' | 'hindered_by_client';
  requestRepeatStatus: 'first_contact' | 'not_repeated' | 'repeated_same_issue';
  clientDataOverdue: boolean;
}

export interface EmployeeClientAssessmentResultRaw {
  id: number;
  dialog_id: number;
  status: string;
  overall_score?: number | null;
  interaction_quality_index?: number | null;
  submitted_at?: string | null;
}

export interface EmployeeClientAssessmentResult {
  id: number;
  dialogId: number;
  status: string;
  overallScore: number | null;
  interactionQualityIndex: number | null;
  submittedAt: Date | null;
}

export interface EmployeeClientAssessmentAnalyticsItemRaw {
  label: string;
  count: number;
}

export interface EmployeeClientAssessmentMonthlyRaw {
  month: string;
  average_overall_score: number;
  average_interaction_quality_index: number;
  count: number;
}

export interface EmployeeClientRatingRaw {
  client_bin?: string | null;
  client_name: string;
  task_count: number;
  average_overall_score: number;
  average_interaction_quality_index: number;
  high_score_share: number;
  low_score_share: number;
  repeated_request_share: number;
  first_contact_share: number;
  average_feedback_delay_hours?: number | null;
  hindered_count: number;
  without_clarifications_count: number;
  first_time_full_data_share: number;
  internal_rating: number;
}

export interface EmployeeClientRating {
  clientBin: string | null;
  clientName: string;
  taskCount: number;
  averageOverallScore: number;
  averageInteractionQualityIndex: number;
  highScoreShare: number;
  lowScoreShare: number;
  repeatedRequestShare: number;
  firstContactShare: number;
  averageFeedbackDelayHours: number | null;
  hinderedCount: number;
  withoutClarificationsCount: number;
  firstTimeFullDataShare: number;
  internalRating: number;
}

export interface RecentEmployeeAssessmentRaw {
  id: number;
  client_name: string;
  client_bin?: string | null;
  assigned_user_name?: string | null;
  overall_score?: number | null;
  interaction_quality_index?: number | null;
  low_score_reason?: string | null;
  submitted_at?: string | null;
  repeated_request: boolean;
  request_repeat_status: 'first_contact' | 'not_repeated' | 'repeated_same_issue';
  client_data_overdue: boolean;
  ai_assisted: boolean;
}

export interface RecentEmployeeAssessment {
  id: number;
  clientName: string;
  clientBin: string | null;
  assignedUserName: string | null;
  overallScore: number | null;
  interactionQualityIndex: number | null;
  lowScoreReason: string | null;
  submittedAt: Date | null;
  repeatedRequest: boolean;
  requestRepeatStatus: 'first_contact' | 'not_repeated' | 'repeated_same_issue';
  clientDataOverdue: boolean;
  aiAssisted: boolean;
}

export interface EmployeeClientAssessmentAnalyticsRaw {
  total_assessments: number;
  average_overall_score?: number | null;
  average_interaction_quality_index?: number | null;
  average_feedback_delay_hours?: number | null;
  high_score_share: number;
  low_score_share: number;
  repeated_request_share: number;
  first_contact_share: number;
  hindered_count: number;
  without_clarifications_count: number;
  first_time_full_data_share: number;
  low_score_reasons: EmployeeClientAssessmentAnalyticsItemRaw[];
  interaction_statuses: EmployeeClientAssessmentAnalyticsItemRaw[];
  interaction_flags: EmployeeClientAssessmentAnalyticsItemRaw[];
  request_repeat_statuses: EmployeeClientAssessmentAnalyticsItemRaw[];
  monthly_scores: EmployeeClientAssessmentMonthlyRaw[];
  client_ratings: EmployeeClientRatingRaw[];
  recent_assessments: RecentEmployeeAssessmentRaw[];
  updated_at: string;
}

export interface EmployeeClientAssessmentAnalytics {
  totalAssessments: number;
  averageOverallScore: number | null;
  averageInteractionQualityIndex: number | null;
  averageFeedbackDelayHours: number | null;
  highScoreShare: number;
  lowScoreShare: number;
  repeatedRequestShare: number;
  firstContactShare: number;
  hinderedCount: number;
  withoutClarificationsCount: number;
  firstTimeFullDataShare: number;
  lowScoreReasons: EmployeeClientAssessmentAnalyticsItemRaw[];
  interactionStatuses: EmployeeClientAssessmentAnalyticsItemRaw[];
  interactionFlags: EmployeeClientAssessmentAnalyticsItemRaw[];
  requestRepeatStatuses: EmployeeClientAssessmentAnalyticsItemRaw[];
  monthlyScores: { month: string; averageOverallScore: number; averageInteractionQualityIndex: number; count: number }[];
  clientRatings: EmployeeClientRating[];
  recentAssessments: RecentEmployeeAssessment[];
  updatedAt: Date;
}


export interface AttachmentRaw {
  id: number;
  media_id: number;
  kind: 'image' | 'video';
  url: string;
  preview_url?: string | null;
  mime_type: string;
  size_bytes: number;
  original_name: string;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
  caption?: string | null;
}

export interface UploadMediaResponseRaw {
  status: string;
  media_id: number;
  kind: 'image' | 'video';
  url: string;
  preview_url?: string | null;
  mime_type: string;
  size_bytes: number;
  original_name: string;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
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
  attachments?: AttachmentRaw[];
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
  organization: string;
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

export interface HrEmployeeRaw extends UserProfileRaw {
  schedule?: string;
}

export interface HrEmployee extends UserProfile {
  schedule: string;
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
  lastMessageText: string | null;
  lastMessageDirection: 'incoming' | 'outgoing' | null;
  lastMessageAuthor: string | null;
  lastMessageHasAttachments: boolean;
  lastMessageAttachmentKind: 'image' | 'video' | string | null;
  employeeAssessmentId: number | null;
  employeeAssessmentPending: boolean;
  employeeAssessmentCreatedAt: Date | null;
}

export interface DialogStatusUpdate {
  chatId: number;
  dialogId: number;
  dialogClosedAt: Date | null;
  aiEnabled: boolean;
  employeeAssessmentId: number | null;
  employeeAssessmentPending: boolean;
}

export interface Attachment {
  id: number;
  mediaId: number;
  kind: 'image' | 'video';
  url: string;
  previewUrl: string | null;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  caption: string | null;
}

export interface UploadMediaResponse {
  status: string;
  mediaId: number;
  kind: 'image' | 'video';
  url: string;
  previewUrl: string | null;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
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
  attachments: Attachment[];
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
  avg_csat?: number | null;
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

export interface DashboardTopBinRaw {
  bin: string;
  requests: number;
}

export interface DashboardHeatmapPointRaw {
  day_of_week: number;
  hour: number;
  count: number;
}

export interface DashboardDialogMetricRaw {
  dialog_id: number;
  bin: string | null;
  is_open: boolean;
  is_ai_closed: boolean;
  response_time_minutes: number | null;
  csat_rating?: number | null;
  ai_csat_rating?: number | null;
  rated_by?: string | null;
  operator_name?: string | null;
}

export interface DashboardSummaryRaw {
  total_dialogs: number;
  open_dialogs: number;
  closed_dialogs: number;
  total_chats: number;
  total_messages?: number;
  total_incoming_messages?: number;
  total_outgoing_messages?: number;
  ai_closed_dialogs?: number;
  transferred_to_operator_dialogs?: number;
  avg_messages_before_transfer?: number | null;
  ai_messages_count?: number;
  requests_with_contract?: number;
  requests_without_contract?: number;
  recurring_requests_count?: number;
  recurring_requests_percentage?: number | null;
  sla_violations_count?: number;
  sla_compliance_percentage?: number | null;
  average_first_message_length?: number | null;
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
  top_bins_without_contract?: DashboardTopBinRaw[];
  top_bins_with_contract?: DashboardTopBinRaw[];
  peak_load_heatmap?: DashboardHeatmapPointRaw[];
  dialog_metrics?: DashboardDialogMetricRaw[];
  csat_average?: number | null;
  csat_count?: number;
  csat_distribution?: { rating: number; count: number }[];
  ai_csat_average?: number | null;
  ai_csat_count?: number;
  ai_csat_distribution?: { rating: number; count: number }[];
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
  avgCsat: number | null;
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

export interface DashboardTopBin {
  bin: string;
  requests: number;
}

export interface DashboardHeatmapPoint {
  dayOfWeek: number;
  hour: number;
  count: number;
}

export interface DashboardDialogMetric {
  dialogId: number;
  bin: string | null;
  isOpen: boolean;
  isAiClosed: boolean;
  responseTimeMinutes: number | null;
  csatRating: number | null;
  aiCsatRating: number | null;
  ratedBy: string | null;
  operatorName: string | null;
}

export interface DashboardSummary {
  totalDialogs: number;
  openDialogs: number;
  closedDialogs: number;
  totalChats: number;
  totalMessages: number;
  totalIncomingMessages: number;
  totalOutgoingMessages: number;
  aiClosedDialogs: number;
  transferredToOperatorDialogs: number;
  avgMessagesBeforeTransfer: number | null;
  aiMessagesCount: number;
  requestsWithContract: number;
  requestsWithoutContract: number;
  recurringRequestsCount: number;
  recurringRequestsPercentage: number | null;
  slaViolationsCount: number;
  slaCompliancePercentage: number | null;
  averageFirstMessageLength: number | null;
  averageMessagesPerDialog: number;
  avgDialogDurationMinutes: number | null;
  avgResponseTimeMinutes: number | null;
  responseTimeDialogs: DashboardResponseTimeDialog[];
  sectionBreakdown: DashboardSectionStat[];
  topQuestions: DashboardTopQuestion[];
  questionsBySection: DashboardSectionTopQuestions[];
  agentBreakdown: DashboardAgentStat[];
  recentActivity: DashboardActivityPoint[];
  topBinsWithoutContract: DashboardTopBin[];
  topBinsWithContract: DashboardTopBin[];
  peakLoadHeatmap: DashboardHeatmapPoint[];
  dialogMetrics: DashboardDialogMetric[];
  csatAverage: number | null;
  csatCount: number;
  csatDistribution: { rating: number; count: number }[];
  aiCsatAverage: number | null;
  aiCsatCount: number;
  aiCsatDistribution: { rating: number; count: number }[];
  updatedAt: Date;
}

export interface ReplyTemplateRaw {
  id: number;
  title: string;
  text: string;
  section?: string | null;
  section_title?: string | null;
  sort_order: number;
  created_by?: number | null;
  created_at: string;
}

export interface ReplyTemplate {
  id: number;
  title: string;
  text: string;
  section?: string | null;
  sectionTitle?: string | null;
  sortOrder: number;
  createdBy?: number | null;
  createdAt: Date;
}

export type HrRequestType = 'vacation' | 'advance' | 'sickLeave' | 'businessTrip' | 'certificate' | 'serviceLetter';
export type HrRequestStatus = 'new' | 'review' | 'needsInfo' | 'approved' | 'rejected' | 'archived';
export type HrRequestEventAction = HrRequestStatus | 'created';
export type HrTemplateStatus = 'active' | 'archived';

export interface HrTemplateRaw {
  id: number;
  title: string;
  type: HrRequestType;
  description: string;
  body: string;
  variables: string[];
  status: HrTemplateStatus;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
}

export interface HrTemplate {
  id: number;
  title: string;
  type: HrRequestType;
  description: string;
  body: string;
  variables: string[];
  status: HrTemplateStatus;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HrRequestEventRaw {
  id: number;
  request_id: number;
  action: HrRequestEventAction;
  actor_id?: number | null;
  actor_name: string;
  comment: string;
  created_at: string;
}

export interface HrRequestEvent {
  id: number;
  requestId: number;
  action: HrRequestEventAction;
  actorId: number | null;
  actorName: string;
  comment: string;
  createdAt: Date;
}

export interface HrSignatureRaw {
  signature: string;
  signed_payload: string;
  signed_at: string;
  certificate_subject?: string | null;
  certificate_serial?: string | null;
  certificate_pem?: string | null;
}

export interface HrSignature {
  signature: string;
  signedPayload: string;
  signedAt: string;
  certificateSubject: string | null;
  certificateSerial: string | null;
  certificatePem: string | null;
}

export interface HrRequestRaw {
  id: number;
  template_id?: number | null;
  template_title: string;
  type: HrRequestType;
  employee_id?: number | null;
  employee_name: string;
  department: string;
  status: HrRequestStatus;
  values: Record<string, unknown>;
  rendered_text: string;
  summary: string;
  period: string;
  submitted_at: string;
  updated_at: string;
  decided_at?: string | null;
  decided_by?: number | null;
  decided_by_name?: string | null;
  decision_comment: string;
  employee_signature?: HrSignatureRaw | null;
  hr_signature?: HrSignatureRaw | null;
  events?: HrRequestEventRaw[];
}

export interface HrRequest {
  id: number;
  templateId: number | null;
  templateTitle: string;
  type: HrRequestType;
  employeeId: number | null;
  employeeName: string;
  department: string;
  status: HrRequestStatus;
  values: Record<string, unknown>;
  renderedText: string;
  summary: string;
  period: string;
  submittedAt: Date;
  updatedAt: Date;
  decidedAt: Date | null;
  decidedBy: number | null;
  decidedByName: string | null;
  decisionComment: string;
  employeeSignature: HrSignature | null;
  hrSignature: HrSignature | null;
  events: HrRequestEvent[];
}






export type SurveyQuestionType = 'scale' | 'single_choice' | 'multi_choice' | 'text_comment' | 'employee_exclusion';
export type SurveyTemplateStatus = 'draft' | 'active' | 'archived';
export type SurveyTemplateAudience = 'client' | 'employee';
export type SurveyTriggerType = 'after_appeal_closed' | 'after_employee_csat' | 'periodic' | 'admin_manual';
export type SurveyCalendarSchedule = 'month_start' | 'quarter_end' | 'custom_dates';
export type SurveyQuestionAnonymityMode = 'inherit' | 'anonymous' | 'identified';

export interface SurveyLaunchRuleRaw {
  type: 'after_appeal_closed' | 'after_employee_csat' | 'calendar';
  schedule?: SurveyCalendarSchedule;
  dates?: string[];
}

export interface SurveyLaunchRule {
  type: 'after_appeal_closed' | 'after_employee_csat' | 'calendar';
  schedule?: SurveyCalendarSchedule;
  dates: string[];
}

export interface SurveyQuestionOption {
  id: string;
  label: string;
  score?: number | null;
}

export interface SurveyQuestionConfig {
  min?: number;
  max?: number;
  options?: SurveyQuestionOption[];
  presentation?: 'scale' | 'nps';
}

export interface SurveyQuestionRaw {
  id?: number;
  template_id?: number;
  sort_order?: number;
  question_type: SurveyQuestionType;
  text: string;
  topic?: string | null;
  required?: boolean;
  anonymity_mode?: SurveyQuestionAnonymityMode;
  config?: SurveyQuestionConfig;
  created_at?: string;
  updated_at?: string;
}

export interface SurveyQuestion {
  id?: number;
  templateId?: number;
  sortOrder: number;
  questionType: SurveyQuestionType;
  text: string;
  topic: string | null;
  required: boolean;
  anonymityMode: SurveyQuestionAnonymityMode;
  config: SurveyQuestionConfig;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface SurveyTemplateRaw {
  id: number;
  title: string;
  description: string;
  audience: SurveyTemplateAudience;
  status: SurveyTemplateStatus;
  trigger_type: SurveyTriggerType;
  periodic_interval?: string | null;
  scheduled_at?: string | null;
  launch_rules?: SurveyLaunchRuleRaw[];
  is_anonymous: boolean;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
  questions: SurveyQuestionRaw[];
}

export interface SurveyTemplate {
  id: number;
  title: string;
  description: string;
  audience: SurveyTemplateAudience;
  status: SurveyTemplateStatus;
  triggerType: SurveyTriggerType;
  periodicInterval: string | null;
  scheduledAt: string | null;
  launchRules: SurveyLaunchRule[];
  isAnonymous: boolean;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  questions: SurveyQuestion[];
}

export interface SurveySessionRaw {
  id: number;
  template_id: number;
  chat_id: number;
  dialog_id?: number | null;
  appeal_id?: number | null;
  bin?: string | null;
  status: string;
  trigger_source: string;
  current_question_id?: number | null;
  is_anonymous: boolean;
  started_at: string;
  completed_at?: string | null;
  updated_at: string;
}

export interface SurveySession {
  id: number;
  templateId: number;
  chatId: number;
  dialogId: number | null;
  appealId: number | null;
  bin: string | null;
  status: string;
  triggerSource: string;
  currentQuestionId: number | null;
  isAnonymous: boolean;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface SurveyAnalyticsTopItemRaw {
  label: string;
  count: number;
}

export interface SurveyQuestionAnalyticsRaw {
  question_id: number;
  question_text: string;
  question_type: SurveyQuestionType;
  topic?: string | null;
  sort_order: number;
  answer_count: number;
  average_score?: number | null;
  score_distribution: SurveyAnalyticsTopItemRaw[];
  top_answers: SurveyAnalyticsTopItemRaw[];
}

export interface SurveyAnalyticsAnswerRaw {
  id: number;
  session_id: number;
  template_id: number;
  template_title: string;
  question_id: number;
  question_text: string;
  question_type: SurveyQuestionType;
  topic?: string | null;
  numeric_score?: number | null;
  raw_text: string;
  selected_options: string[];
  selected_employee_name?: string | null;
  created_at: string;
  chat_id?: number | null;
  dialog_id?: number | null;
  appeal_id?: number | null;
  bin?: string | null;
  organization?: string | null;
  chat_title?: string | null;
  operators: string[];
  is_anonymous: boolean;
  effective_is_anonymous?: boolean;
  section?: string | null;
}

export interface SurveyAnalyticsRaw {
  average_score?: number | null;
  completed_survey_count?: number;
  answer_count?: number;
  score_count: number;
  positive_count: number;
  neutral_count: number;
  negative_count: number;
  positive_share: number;
  neutral_share: number;
  negative_share: number;
  top_client_requests: SurveyAnalyticsTopItemRaw[];
  top_training_wishes: SurveyAnalyticsTopItemRaw[];
  employee_remarks: SurveyAnalyticsTopItemRaw[];
  question_analytics?: SurveyQuestionAnalyticsRaw[];
  monthly_satisfaction: { month: string; average_score: number; count: number }[];
  answers: SurveyAnalyticsAnswerRaw[];
  answers_total_count?: number;
  answers_preview_limited?: boolean;
  updated_at: string;
}

export interface SurveyAnalyticsAnswer {
  id: number;
  sessionId: number;
  templateId: number;
  templateTitle: string;
  questionId: number;
  questionText: string;
  questionType: SurveyQuestionType;
  topic: string | null;
  numericScore: number | null;
  rawText: string;
  selectedOptions: string[];
  selectedEmployeeName: string | null;
  createdAt: Date;
  chatId: number | null;
  dialogId: number | null;
  appealId: number | null;
  bin: string | null;
  organization: string | null;
  chatTitle: string | null;
  operators: string[];
  isAnonymous: boolean;
  section: string | null;
}

export interface SurveyQuestionAnalytics {
  questionId: number;
  questionText: string;
  questionType: SurveyQuestionType;
  topic: string | null;
  sortOrder: number;
  answerCount: number;
  averageScore: number | null;
  scoreDistribution: SurveyAnalyticsTopItemRaw[];
  topAnswers: SurveyAnalyticsTopItemRaw[];
}

export interface SurveyAnalytics {
  averageScore: number | null;
  completedSurveyCount: number;
  answerCount: number;
  scoreCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  positiveShare: number;
  neutralShare: number;
  negativeShare: number;
  topClientRequests: SurveyAnalyticsTopItemRaw[];
  topTrainingWishes: SurveyAnalyticsTopItemRaw[];
  employeeRemarks: SurveyAnalyticsTopItemRaw[];
  questionAnalytics: SurveyQuestionAnalytics[];
  monthlySatisfaction: { month: string; averageScore: number; count: number }[];
  answers: SurveyAnalyticsAnswer[];
  answersPreviewLimited: boolean;
  updatedAt: Date;
}

export interface SurveyLaunchResult {
  started: { session_id: number; chat_id: number; dialog_id?: number | null; appeal_id?: number | null; bin?: string | null }[];
  skipped: { chat_id: number; dialog_id?: number | null; appeal_id?: number | null; bin?: string | null }[];
  started_count: number;
  skipped_count: number;
}

export interface RatingLedgerEntryRaw {
  rating_id: number;
  source_table: string;
  source_kind: string;
  appeal_id?: number | null;
  dialog_id?: number | null;
  chat_id?: number | null;
  client_id?: number | null;
  client_bin?: string | null;
  client_name?: string | null;
  organization?: string | null;
  section?: string | null;
  region?: string | null;
  rater_type: string;
  rater_id?: string | null;
  rater_name?: string | null;
  rated_object_type: string;
  rated_object_id?: string | null;
  rated_object_name?: string | null;
  employee_id?: number | null;
  employee_name?: string | null;
  rating_channel?: string | null;
  ai_involved: boolean;
  final_score?: number | null;
  comment?: string | null;
  low_score_reason?: string | null;
  parameter_details?: Record<string, unknown>;
  created_at: string;
  status: string;
  scenario?: string | null;
}

export interface RatingLedgerEntry {
  ratingId: number;
  sourceTable: string;
  sourceKind: string;
  appealId: number | null;
  dialogId: number | null;
  chatId: number | null;
  clientId: number | null;
  clientBin: string | null;
  clientName: string | null;
  organization: string | null;
  section: string | null;
  region: string | null;
  raterType: string;
  raterId: string | null;
  raterName: string | null;
  ratedObjectType: string;
  ratedObjectId: string | null;
  ratedObjectName: string | null;
  employeeId: number | null;
  employeeName: string | null;
  ratingChannel: string | null;
  aiInvolved: boolean;
  finalScore: number | null;
  comment: string | null;
  lowScoreReason: string | null;
  parameterDetails: Record<string, unknown>;
  createdAt: Date;
  status: string;
  scenario: string | null;
}

export interface RatingLedgerFilters {
  startDate?: string | null;
  endDate?: string | null;
  raterType?: string | null;
  ratedObjectType?: string | null;
  employeeId?: number | null;
  employeeName?: string | null;
  clientBin?: string | null;
  clientId?: number | null;
  section?: string | null;
  region?: string | null;
  organization?: string | null;
  aiInvolved?: boolean | null;
  channel?: string | null;
  limit?: number;
  offset?: number;
}

export interface RatingLedgerResponseRaw {
  items: RatingLedgerEntryRaw[];
  total: number;
  limit: number;
  offset: number;
  updated_at: string;
}

export interface RatingLedgerResponse {
  items: RatingLedgerEntry[];
  total: number;
  limit: number;
  offset: number;
  updatedAt: Date;
}

export interface RatingsSummaryEntityRaw {
  average_score?: number | null;
  rating_count?: number;
  high_score_share?: number;
  low_score_share?: number;
  average_resolution_minutes?: number | null;
  without_repeat_share?: number | null;
  without_escalation_share?: number | null;
  ai_assisted_share?: number | null;
  closure_correctness?: number | null;
  full_data_first_time_share?: number;
  assessment_count?: number;
  average_feedback_delay_hours?: number | null;
  repeated_request_share?: number;
  hindered_count?: number;
  interaction_quality_index?: number | null;
  ai_usage_share?: number | null;
  inaccurate_share?: number;
  manual_correction_share?: number | null;
  client_feedback_count?: number;
  employee_feedback_count?: number;
  not_available?: string[];
}

export interface RatingsSummaryEntity {
  averageScore: number | null;
  ratingCount: number;
  highScoreShare: number;
  lowScoreShare: number;
  averageResolutionMinutes: number | null;
  withoutRepeatShare: number | null;
  withoutEscalationShare: number | null;
  aiAssistedShare: number | null;
  closureCorrectness: number | null;
  fullDataFirstTimeShare: number;
  assessmentCount: number;
  averageFeedbackDelayHours: number | null;
  repeatedRequestShare: number;
  hinderedCount: number;
  interactionQualityIndex: number | null;
  aiUsageShare: number | null;
  inaccurateShare: number;
  manualCorrectionShare: number | null;
  clientFeedbackCount: number;
  employeeFeedbackCount: number;
  notAvailable: string[];
}

export interface RatingsSummaryRaw {
  employees: RatingsSummaryEntityRaw;
  clients: RatingsSummaryEntityRaw;
  ai: RatingsSummaryEntityRaw;
  missing_flows: string[];
  updated_at: string;
}

export interface RatingsSummary {
  employees: RatingsSummaryEntity;
  clients: RatingsSummaryEntity;
  ai: RatingsSummaryEntity;
  missingFlows: string[];
  updatedAt: Date;
}

export interface EmployeeRatingRowRaw {
  employee_id?: number | null;
  employee_name: string;
  average_score?: number | null;
  rated_appeals_count: number;
  high_score_share: number;
  low_score_share: number;
  average_resolution_minutes?: number | null;
  without_repeat_share?: number | null;
  without_escalation_share?: number | null;
  ai_assisted_share?: number | null;
  closure_correctness?: number | null;
  total_low_ratings: number;
}

export interface EmployeeRatingRow {
  employeeId: number | null;
  employeeName: string;
  averageScore: number | null;
  ratedAppealsCount: number;
  highScoreShare: number;
  lowScoreShare: number;
  averageResolutionMinutes: number | null;
  withoutRepeatShare: number | null;
  withoutEscalationShare: number | null;
  aiAssistedShare: number | null;
  closureCorrectness: number | null;
  totalLowRatings: number;
}

export interface EmployeeRatingsAnalyticsRaw {
  summary: RatingsSummaryEntityRaw;
  rows: EmployeeRatingRowRaw[];
  monthly_dynamics: { month: string; average_score?: number | null; rating_count: number }[];
  low_score_reasons: SurveyAnalyticsTopItemRaw[];
  ai_impact: { label: string; average_score?: number | null; rating_count: number }[];
  top_employees: EmployeeRatingRowRaw[];
  problem_employees: EmployeeRatingRowRaw[];
  updated_at: string;
}

export interface EmployeeRatingsAnalytics {
  summary: RatingsSummaryEntity;
  rows: EmployeeRatingRow[];
  monthlyDynamics: { month: string; averageScore: number | null; ratingCount: number }[];
  lowScoreReasons: SurveyAnalyticsTopItemRaw[];
  aiImpact: { label: string; averageScore: number | null; ratingCount: number }[];
  topEmployees: EmployeeRatingRow[];
  problemEmployees: EmployeeRatingRow[];
  updatedAt: Date;
}

export interface ClientRatingRowRaw {
  client_bin?: string | null;
  client_name: string;
  completed_appeals_count: number;
  average_score?: number | null;
  interaction_quality_index?: number | null;
  full_data_first_time_share: number;
  average_feedback_delay_hours?: number | null;
  repeated_request_share: number;
  hindered_count: number;
  recommendation?: string | null;
}

export interface ClientRatingRow {
  clientBin: string | null;
  clientName: string;
  completedAppealsCount: number;
  averageScore: number | null;
  interactionQualityIndex: number | null;
  fullDataFirstTimeShare: number;
  averageFeedbackDelayHours: number | null;
  repeatedRequestShare: number;
  hinderedCount: number;
  recommendation: string | null;
}

export interface ClientRatingsAnalyticsRaw {
  summary: RatingsSummaryEntityRaw;
  rows: ClientRatingRowRaw[];
  monthly_dynamics: { month: string; average_score?: number | null; interaction_quality_index?: number | null; count: number }[];
  low_score_reasons: SurveyAnalyticsTopItemRaw[];
  interaction_statuses: SurveyAnalyticsTopItemRaw[];
  interaction_flags: SurveyAnalyticsTopItemRaw[];
  request_repeat_statuses: SurveyAnalyticsTopItemRaw[];
  support_candidates: ClientRatingRowRaw[];
  recent_assessments: RecentEmployeeAssessmentRaw[];
  updated_at: string;
}

export interface ClientRatingsAnalytics {
  summary: RatingsSummaryEntity;
  rows: ClientRatingRow[];
  monthlyDynamics: { month: string; averageScore: number | null; interactionQualityIndex: number | null; count: number }[];
  lowScoreReasons: SurveyAnalyticsTopItemRaw[];
  interactionStatuses: SurveyAnalyticsTopItemRaw[];
  interactionFlags: SurveyAnalyticsTopItemRaw[];
  requestRepeatStatuses: SurveyAnalyticsTopItemRaw[];
  supportCandidates: ClientRatingRow[];
  recentAssessments: RecentEmployeeAssessment[];
  updatedAt: Date;
}

export interface AiRatingRowRaw {
  section?: string | null;
  average_score?: number | null;
  rating_count: number;
  low_score_share: number;
}

export interface AiRatingRow {
  section: string | null;
  averageScore: number | null;
  ratingCount: number;
  lowScoreShare: number;
}

export interface AiRatingsAnalyticsRaw {
  summary: RatingsSummaryEntityRaw;
  rows: AiRatingRowRaw[];
  monthly_dynamics: { month: string; average_score?: number | null; rating_count: number }[];
  low_score_reasons: SurveyAnalyticsTopItemRaw[];
  scenario_comparison: { scenario: string; label: string; cases_count: number; average_score?: number | null }[];
  top_useful_sections: AiRatingRowRaw[];
  review_required_sections: AiRatingRowRaw[];
  updated_at: string;
}

export interface AiRatingsAnalytics {
  summary: RatingsSummaryEntity;
  rows: AiRatingRow[];
  monthlyDynamics: { month: string; averageScore: number | null; ratingCount: number }[];
  lowScoreReasons: SurveyAnalyticsTopItemRaw[];
  scenarioComparison: { scenario: string; label: string; casesCount: number; averageScore: number | null }[];
  topUsefulSections: AiRatingRow[];
  reviewRequiredSections: AiRatingRow[];
  updatedAt: Date;
}

export interface MutualRatingMatrixCellRaw {
  code: string;
  rater_type: string;
  rated_object_type: string;
  label: string;
  count: number;
  average_score?: number | null;
  status: string;
}

export interface MutualRatingMatrixCell {
  code: string;
  raterType: string;
  ratedObjectType: string;
  label: string;
  count: number;
  averageScore: number | null;
  status: string;
}

export interface MutualRatingMatrixRaw {
  cells: MutualRatingMatrixCellRaw[];
  updated_at: string;
}

export interface MutualRatingMatrix {
  cells: MutualRatingMatrixCell[];
  updatedAt: Date;
}
