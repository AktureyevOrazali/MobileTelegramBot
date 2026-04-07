import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { ApiClient } from '../api/ApiClient';
import type { ChatSummary, Message, ReplyTemplate } from '../types';
import { extractErrorMessage } from '../utils/errors';

interface SendChatMessageOptions {
  attachmentIds?: number[];
  errorMessage?: string;
  onSent?: () => void;
}

interface UseChatConversationOptions {
  apiClient: ApiClient;
  chat: ChatSummary | null;
  maxTextareaHeight?: number;
}

interface UseChatConversationResult {
  canReply: boolean;
  error: string | null;
  input: string;
  loading: boolean;
  messages: Message[];
  scrollRef: RefObject<HTMLDivElement>;
  sending: boolean;
  setError: Dispatch<SetStateAction<string | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  templates: ReplyTemplate[];
  textareaRef: RefObject<HTMLTextAreaElement>;
  autosizeTextarea: (element: HTMLTextAreaElement) => void;
  handlePresetClick: (text: string) => void;
  loadMessages: () => Promise<void>;
  scrollToBottom: (smooth?: boolean) => void;
  sendMessage: (options?: SendChatMessageOptions) => Promise<boolean>;
}

const DEFAULT_FETCH_ERROR = 'Не удалось загрузить сообщения.';
const DEFAULT_SEND_ERROR = 'Не удалось отправить сообщение.';
const MESSAGE_FETCH_LIMIT = 100;
const MESSAGE_RELOAD_DEBOUNCE_MS = 120;

export const useChatConversation = ({
  apiClient,
  chat,
  maxTextareaHeight = 176,
}: UseChatConversationOptions): UseChatConversationResult => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inflightLoadRef = useRef<Promise<void> | null>(null);
  const reloadTimerRef = useRef<number | null>(null);

  const canReply = Boolean(apiClient.currentUser?.canReply);

  const scrollToBottom = useCallback((smooth = false) => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const top = element.scrollHeight;
    if (smooth) {
      element.scrollTo({ top, behavior: 'smooth' });
      return;
    }

    element.scrollTop = top;
  }, []);

  const autosizeTextarea = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, maxTextareaHeight)}px`;
  }, [maxTextareaHeight]);

  const loadMessages = useCallback(async () => {
    if (!chat) {
      setMessages([]);
      setError(null);
      return;
    }

    if (inflightLoadRef.current) {
      await inflightLoadRef.current;
      return;
    }

    const task = (async () => {
      try {
        setLoading(true);
        const data = await apiClient.fetchMessages(chat.chatId, MESSAGE_FETCH_LIMIT, chat.dialogId);
        setMessages(data);
        setError(null);
      } catch (err) {
        setError(extractErrorMessage(err, DEFAULT_FETCH_ERROR));
      } finally {
        setLoading(false);
        requestAnimationFrame(() => scrollToBottom(false));
      }
    })();

    inflightLoadRef.current = task;
    try {
      await task;
    } finally {
      inflightLoadRef.current = null;
    }
  }, [apiClient, chat, scrollToBottom]);

  const scheduleLoadMessages = useCallback((delay = MESSAGE_RELOAD_DEBOUNCE_MS) => {
    if (!chat || reloadTimerRef.current !== null) {
      return;
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void loadMessages();
    }, delay);
  }, [chat, loadMessages]);

  useEffect(() => () => {
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setInput('');
    setTemplates([]);
    if (reloadTimerRef.current !== null) {
      window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
  }, [chat?.chatId, chat?.dialogId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!chat || !canReply) {
      setTemplates([]);
      return;
    }

    let cancelled = false;
    apiClient.fetchReplyTemplates(chat.section)
      .then((data) => {
        if (!cancelled) {
          setTemplates(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, canReply, chat]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => scrollToBottom(true));
    return () => cancelAnimationFrame(frameId);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (textareaRef.current) {
      autosizeTextarea(textareaRef.current);
    }
  }, [autosizeTextarea, input]);

  useEffect(() => {
    if (!chat) {
      return undefined;
    }

    const cleanup = apiClient.connectToStream({
      onMessage: (message) => {
        if (message.chat_id !== chat.chatId) {
          return;
        }
        if (typeof message.dialog_id === 'number' && message.dialog_id !== chat.dialogId) {
          return;
        }
        scheduleLoadMessages();
      },
    });

    return cleanup;
  }, [apiClient, chat, scheduleLoadMessages]);

  const handlePresetClick = useCallback((text: string) => {
    setInput(text);
    if (textareaRef.current) {
      textareaRef.current.focus();
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          autosizeTextarea(textareaRef.current);
        }
      });
    }
  }, [autosizeTextarea]);

  const sendMessage = useCallback(async (options: SendChatMessageOptions = {}) => {
    if (!chat) {
      return false;
    }

    const trimmed = input.trim();
    const attachmentIds = options.attachmentIds ?? [];
    if (!trimmed && attachmentIds.length === 0) {
      return false;
    }

    setSending(true);
    try {
      await apiClient.sendMessage(chat.chatId, trimmed, chat.dialogId, attachmentIds);
      setInput('');
      options.onSent?.();
      scheduleLoadMessages(80);
      setError(null);
      return true;
    } catch (err) {
      setError(extractErrorMessage(err, options.errorMessage ?? DEFAULT_SEND_ERROR));
      return false;
    } finally {
      setSending(false);
    }
  }, [apiClient, chat, input, scheduleLoadMessages]);

  return {
    canReply,
    error,
    input,
    loading,
    messages,
    scrollRef: scrollRef as RefObject<HTMLDivElement>,
    sending,
    setError,
    setInput,
    templates,
    textareaRef: textareaRef as RefObject<HTMLTextAreaElement>,
    autosizeTextarea,
    handlePresetClick,
    loadMessages,
    scrollToBottom,
    sendMessage,
  };
};
