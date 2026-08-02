import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownCircle,
  Languages,
  Loader2,
  MessageCircle,
  RefreshCw,
  Reply,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePortalLanguage } from "@/lib/portalLanguage";

function getApiBase() {
  if (typeof window === "undefined") return "";
  const configuredBase = import.meta.env?.VITE_API_BASE_URL;
  if (configuredBase) return configuredBase.replace(/\/$/, "");
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "";
}

function isLeaderSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return Boolean(session?.isLeader || session?.leader || role === "leader");
}

function formatChatTime(value, language) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(language === "en" ? "en-US" : "fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function createClientMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function mergeMessages(previous, incoming) {
  const map = new Map();
  for (const message of previous || []) {
    if (message?.id && !message.deleted && !message.deletedAt) map.set(String(message.id), message);
  }
  for (const message of incoming || []) {
    if (message?.id && !message.deleted && !message.deletedAt) map.set(String(message.id), message);
  }
  return [...map.values()].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
}

function ChatAvatar({ author }) {
  if (author?.avatarUrl) {
    return (
      <img
        src={author.avatarUrl}
        alt=""
        className="h-10 w-10 rounded-full border border-cyan-400/30 object-cover"
        draggable="false"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-sm font-bold text-cyan-100">
      {author?.initial || "?"}
    </div>
  );
}

function ChatMessage({ message, language, onReply, onDelete, showOriginal, onToggleOriginal, t }) {
  if (message.deleted || message.deletedAt) return null;

  const displayedBody = showOriginal
      ? message.bodyOriginal
      : message.body;
  const replyDeletedLabel = t("chat.replyDeleted", "Le message a ete supprime.");
  const hasTranslation = Boolean(message.canShowOriginal);
  const translationNotice =
    !message.isTranslated && message.translationStatus === "disabled"
      ? t("chat.translationDisabled", "Traduction automatique non configuree.")
      : !message.isTranslated && message.translationStatus === "pending"
        ? t("chat.translationPending", "Traduction en preparation.")
      : message.translationStatus === "failed"
        ? t("chat.translationFailed", "Traduction indisponible.")
        : "";

  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="flex items-start gap-3">
        <ChatAvatar author={message.author} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-50">{message.author?.displayName || "Joueur"}</span>
            <span className="text-xs text-zinc-500">{formatChatTime(message.createdAt, language)}</span>
            {message.isTranslated ? (
              <Badge className="rounded-full border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
                <Languages className="mr-1 h-3 w-3" />
                {t("chat.translation", "Traduction")}
              </Badge>
            ) : null}
          </div>

          {message.replyTo ? (
            <button
              type="button"
              className="mt-2 flex max-w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-[11px] leading-4 text-zinc-500 transition hover:bg-zinc-900/60 hover:text-zinc-300"
              onClick={() => onReply(message.replyTo)}
            >
              <span className="h-4 w-4 rounded-tl-md border-l-2 border-t-2 border-zinc-700" aria-hidden="true" />
              <span className="shrink-0 font-semibold text-zinc-400">@{message.replyTo.authorName}</span>
              <span className={`min-w-0 truncate ${message.replyTo.deleted ? "italic text-zinc-600" : ""}`}>
                {message.replyTo.deleted ? replyDeletedLabel : message.replyTo.body}
              </span>
            </button>
          ) : null}

          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">
            {displayedBody}
          </p>

          {translationNotice ? (
            <p className="mt-2 text-xs text-amber-300/80">{translationNotice}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hasTranslation ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 hover:bg-zinc-800"
                onClick={() => onToggleOriginal(message.id)}
              >
                {showOriginal ? t("chat.showTranslation", "Voir la traduction") : t("chat.showOriginal", "Voir l'original")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 hover:bg-zinc-800"
              onClick={() => onReply(message)}
            >
              <Reply className="mr-1 h-3.5 w-3.5" />
              {t("chat.reply", "Repondre")}
            </Button>
            {message.permissions?.canDelete ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg border-red-500/35 bg-red-500/10 px-2 text-xs text-red-200 hover:bg-red-500/20"
                onClick={() => onDelete(message)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t("chat.delete", "Supprimer")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function GlobalChatTab({ session }) {
  const { language, t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const isLeader = isLeaderSession(session);
  const latestCursorRef = useRef("");
  const mountedRef = useRef(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [composer, setComposer] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [beforeCursor, setBeforeCursor] = useState("");
  const [showOriginalIds, setShowOriginalIds] = useState(() => new Set());
  const [config, setConfig] = useState({ maxLength: 1000, pollingMs: 4000 });

  const maxLength = Number(config.maxLength || 1000);
  const trimmedComposer = composer.trim();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const latest = messages.length ? messages[messages.length - 1]?.createdAt || "" : "";
    latestCursorRef.current = latest;
  }, [messages]);

  async function parsePayload(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || t("chat.errorLoad", "Chargement du chat impossible."));
    return payload;
  }

  async function loadInitial(options = {}) {
    if (!isLeader) return;
    if (!options.silent) setLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch(
        `${apiBase}/api/portal-chat?action=list&targetLanguage=${encodeURIComponent(language)}`,
        { method: "GET", credentials: "include" },
      );
      const payload = await parsePayload(response);
      if (!mountedRef.current) return;
      setMessages(mergeMessages([], payload.messages || []));
      setHasMore(Boolean(payload.page?.hasMore));
      setBeforeCursor(payload.page?.before || "");
      setConfig((previous) => ({ ...previous, ...(payload.config || {}) }));
      setShowOriginalIds(new Set());
    } catch (error) {
      if (mountedRef.current) setErrorMessage(error?.message || t("chat.errorLoad", "Chargement du chat impossible."));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function loadOlder() {
    if (!isLeader || !beforeCursor || olderLoading) return;
    setOlderLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch(
        `${apiBase}/api/portal-chat?action=list&targetLanguage=${encodeURIComponent(language)}&before=${encodeURIComponent(beforeCursor)}`,
        { method: "GET", credentials: "include" },
      );
      const payload = await parsePayload(response);
      if (!mountedRef.current) return;
      setMessages((previous) => mergeMessages(payload.messages || [], previous));
      setHasMore(Boolean(payload.page?.hasMore));
      setBeforeCursor(payload.page?.before || "");
    } catch (error) {
      if (mountedRef.current) setErrorMessage(error?.message || t("chat.errorLoad", "Chargement du chat impossible."));
    } finally {
      if (mountedRef.current) setOlderLoading(false);
    }
  }

  async function loadUpdates() {
    const after = latestCursorRef.current;
    if (!isLeader || !after) return;

    try {
      const response = await fetch(
        `${apiBase}/api/portal-chat?action=updates&targetLanguage=${encodeURIComponent(language)}&after=${encodeURIComponent(after)}`,
        { method: "GET", credentials: "include" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !mountedRef.current) return;
      if (Array.isArray(payload.messages) && payload.messages.length) {
        setMessages((previous) => mergeMessages(previous, payload.messages));
      }
    } catch {
      // Polling stays quiet; manual refresh keeps the visible error path.
    }
  }

  useEffect(() => {
    void loadInitial();
  }, [isLeader, language]);

  useEffect(() => {
    if (!isLeader) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadUpdates();
    }, Number(config.pollingMs || 4000));

    return () => window.clearInterval(interval);
  }, [config.pollingMs, isLeader, language]);

  async function sendMessage() {
    if (!trimmedComposer || sending) return;
    if (trimmedComposer.length > maxLength) {
      setErrorMessage(t("chat.tooLong", "Message trop long."));
      return;
    }

    setSending(true);
    setErrorMessage("");

    try {
      const response = await fetch(`${apiBase}/api/portal-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          body: trimmedComposer,
          targetLanguage: language,
          clientMessageId: createClientMessageId(),
          replyToMessageId: replyTo?.id || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("chat.errorSend", "Envoi impossible."));
      if (payload.message) setMessages((previous) => mergeMessages(previous, [payload.message]));
      setComposer("");
      setReplyTo(null);
    } catch (error) {
      setErrorMessage(error?.message || t("chat.errorSend", "Envoi impossible."));
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(message) {
    if (!message?.id) return;
    setErrorMessage("");

    try {
      const response = await fetch(`${apiBase}/api/portal-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          messageId: message.id,
          targetLanguage: language,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("chat.errorDelete", "Suppression impossible."));
      const deletedMessageId = String(payload.deletedMessageId || message.id);
      setMessages((previous) => (previous || []).filter((item) => String(item.id) !== deletedMessageId));
      setShowOriginalIds((previous) => {
        const next = new Set(previous);
        next.delete(deletedMessageId);
        return next;
      });
      if (replyTo?.id === message.id) setReplyTo(null);
    } catch (error) {
      setErrorMessage(error?.message || t("chat.errorDelete", "Suppression impossible."));
    }
  }

  function toggleOriginal(messageId) {
    setShowOriginalIds((previous) => {
      const next = new Set(previous);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  if (!isLeader) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-100">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5" />
          <div className="font-semibold">{t("chat.leaderOnly", "Ce chat est reserve au leader.")}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-300">
              <MessageCircle className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-[0.22em]">{t("chat.title", "Chat general")}</span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-50">{t("chat.title", "Chat general")}</h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              {t(
                "chat.description",
                "Discussion partagee leader-only, avec cache de traduction pret pour les prochaines langues.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full border-cyan-400/25 bg-cyan-400/10 text-cyan-200">
              <RefreshCw className="mr-1 h-3 w-3" />
              {t("chat.polling", "Actualisation par polling")}
            </Badge>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => loadInitial({ silent: true })}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("chat.refresh", "Rafraichir")}
            </Button>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {errorMessage}
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <div className="max-h-[62vh] min-h-[420px] space-y-3 overflow-y-auto p-4">
          {hasMore ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-zinc-700 bg-zinc-900 text-zinc-200"
                onClick={loadOlder}
                disabled={olderLoading}
              >
                {olderLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowDownCircle className="mr-2 h-4 w-4" />}
                {t("chat.loadOlder", "Charger les anciens messages")}
              </Button>
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-[260px] items-center justify-center text-zinc-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {t("chat.loading", "Chargement des messages...")}
            </div>
          ) : messages.length ? (
            messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                language={language}
                t={t}
                showOriginal={showOriginalIds.has(message.id)}
                onToggleOriginal={toggleOriginal}
                onReply={setReplyTo}
                onDelete={deleteMessage}
              />
            ))
          ) : (
            <div className="flex min-h-[260px] items-center justify-center text-zinc-500">
              {t("chat.empty", "Aucun message pour le moment.")}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 p-4">
          {replyTo ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                  {t("chat.replyingTo", "Reponse a")} {replyTo.author?.displayName || replyTo.authorName || "Joueur"}
                </div>
                <div className="mt-1 truncate text-cyan-50">
                  {replyTo.deleted ? t("chat.replyDeleted", "Le message a ete supprime.") : replyTo.body || replyTo.bodyOriginal || ""}
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-cyan-100 hover:bg-cyan-300/10"
                onClick={() => setReplyTo(null)}
                aria-label={t("chat.cancelReply", "Annuler la reponse")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block">
              <span className="sr-only">{t("chat.placeholder", "Ecris un message...")}</span>
              <textarea
                value={composer}
                maxLength={maxLength}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={t("chat.placeholder", "Ecris un message...")}
                className="min-h-[92px] w-full resize-y rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10"
              />
              <span className={`mt-1 block text-right text-xs ${composer.length > maxLength ? "text-red-300" : "text-zinc-600"}`}>
                {composer.length} / {maxLength}
              </span>
            </label>
            <Button
              type="button"
              className="h-12 rounded-2xl bg-cyan-500 px-5 text-sm font-semibold text-zinc-950 hover:bg-cyan-400"
              onClick={sendMessage}
              disabled={sending || !trimmedComposer || trimmedComposer.length > maxLength}
            >
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {sending ? t("chat.sending", "Envoi...") : t("chat.send", "Envoyer")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
