export interface Section {
  id: string;
  title: string;
}

export interface ChatSummary {
  chatId: number;
  title: string;
  username: string | null;
  type: string;
  updatedAt: string;
  section: string | null;
  sectionTitle: string | null;
  bin: string | null;
  isFavorite: boolean;
}

export interface Message {
  id: number;
  chatId: number;
  text: string;
  direction: 'incoming' | 'outgoing';
  author: string | null;
  createdAt: string;
  createdAtLabel: string;
  sectionTitle: string | null;
}

export interface MessageNotification {
  chatId: number;
  chatTitle: string;
  createdAt: string;
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  login: string;
  createdAt: string;
  jobTitle: string;
  phone: string;
  bio: string;
  role: string;
  sections: string[];
  bins: string[];
  favoriteChatIds: number[];
}

export interface RoleInfo {
  id: string;
  title: string;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
}

export interface PaginatedUsers {
  items: UserProfile[];
}
