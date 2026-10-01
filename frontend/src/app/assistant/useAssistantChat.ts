import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthStore } from "@/auth/store/auth.store";
import { chatApi, chatErrorMessage, toHistory, type ChatMessage, type ChatMode } from "./chatApi";

const MAX_STORED_MESSAGES = 40;
const storageKey = (userId: string) => `assistant-chat:${userId}`;

function loadMessages(userId: string | undefined): ChatMessage[] {
  if (!userId) return [];
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey(userId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ChatMessage =>
        !!item &&
        typeof item.id === "string" &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    );
  } catch {
    return [];
  }
}

function saveMessages(userId: string | undefined, messages: ChatMessage[]) {
  if (!userId) return;
  try {
    if (messages.length === 0) sessionStorage.removeItem(storageKey(userId));
    else sessionStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // Storage may be unavailable or full: the conversation just stays in memory.
  }
}

let counter = 0;
const nextId = () => `m${Date.now()}-${(counter += 1)}`;

/** Conversation state (mount it with `key={userId}` so a user switch starts from that user's storage): in memory, mirrored to sessionStorage per user, stale answers discarded. */
export function useAssistantChat() {
  const userId = useAuthStore((state) => state.user?.id);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(userId));
  const [pending, setPending] = useState(false);
  const messagesRef = useRef(messages);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
    saveMessages(userId, messages);
  }, [messages, userId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(async (question: string, mode: ChatMode) => {
    const text = question.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const request = (requestRef.current += 1);
    const history = toHistory(messagesRef.current);
    const userMessage: ChatMessage = { id: nextId(), role: "user", content: text };
    messagesRef.current = [...messagesRef.current, userMessage];
    setMessages(messagesRef.current);
    setPending(true);
    let reply: ChatMessage;
    try {
      const response = await chatApi.ask({ question: text, mode, history }, controller.signal);
      reply = { id: nextId(), role: "assistant", content: response.answer, response };
    } catch (error) {
      reply = { id: nextId(), role: "assistant", content: chatErrorMessage(error), error: true };
    }
    if (request !== requestRef.current) return; // a newer question (or a reset) superseded this one
    messagesRef.current = [...messagesRef.current, reply];
    setMessages(messagesRef.current);
    setPending(false);
  }, []);

  const reset = useCallback(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    messagesRef.current = [];
    setMessages([]);
    setPending(false);
  }, []);

  return { messages, pending, send, reset };
}
