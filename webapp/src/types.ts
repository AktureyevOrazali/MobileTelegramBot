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
  sections: string[];
  bins: string[];
  favorite_dialog_ids: number[];
}

export interface AuthSessionRaw {
  token: string;
  user: UserProfileRaw;
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
  sections: string[];
  bins: string[];
  favoriteDialogIds: number[];
  isAdmin: boolean;
  canReply: boolean;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
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