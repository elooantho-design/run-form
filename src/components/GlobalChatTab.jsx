import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownCircle,
  ImageIcon,
  Languages,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldAlert,
  Smile,
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

const EMOJI_CATEGORIES = [
  {
    key: "recent",
    label: "Recents",
    emojis: [],
  },
  {
    key: "smileys",
    label: "Smileys",
    emojis: ["😀", "😄", "😂", "🤣", "😊", "😍", "😎", "😭", "😅", "😬", "🙃", "😉", "😇", "🥳", "🤔", "🫡"],
  },
  {
    key: "gestures",
    label: "Gestes",
    emojis: ["👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "🤝", "👌", "✌️", "🤞", "🫶", "👋", "🖐️", "☝️", "👇"],
  },
  {
    key: "symbols",
    label: "Symboles",
    emojis: ["❤️", "🔥", "⭐", "✅", "❌", "⚠️", "💯", "✨", "🎯", "🏆", "💎", "🛡️", "⚔️", "🔁", "📌", "🚀"],
  },
];

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥"];
const RECENT_EMOJI_KEY = "portal-chat-recent-emojis";

function readRecentEmojis() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_EMOJI_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 18) : [];
  } catch {
    return [];
  }
}

function saveRecentEmoji(emoji) {
  if (typeof window === "undefined" || !emoji) return;
  const next = [emoji, ...readRecentEmojis().filter((item) => item !== emoji)].slice(0, 18);
  window.localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
}

function findGifAttachment(attachments) {
  return (attachments || []).find((attachment) => attachment?.attachmentType === "gif");
}

function EmojiPicker({ onPick, onClose, compact = false, t }) {
  const rootRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("recent");
  const recent = useMemo(() => readRecentEmojis(), []);
  const categories = useMemo(
    () => EMOJI_CATEGORIES.map((category) => (category.key === "recent" ? { ...category, emojis: recent } : category)),
    [recent],
  );
  const available = useMemo(() => {
    const source = query
      ? categories.flatMap((category) => category.emojis)
      : categories.find((category) => category.key === activeCategory)?.emojis || [];
    const unique = [...new Set(source)];
    return query ? unique.filter((emoji) => emoji.includes(query.trim())) : unique;
  }, [activeCategory, categories, query]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) onClose?.();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className={`${compact ? "w-72" : "w-[min(360px,calc(100vw-2rem))]"} rounded-2xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl shadow-black/50`}
      role="dialog"
      aria-label={t("chat.emojiPicker", "Selecteur emoji")}
    >
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("chat.emojiSearch", "Chercher...")}
          className="h-10 w-full rounded-xl border border-zinc-800 bg-black pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/60"
        />
      </label>
      <div className="mt-3 flex gap-1 overflow-x-auto">
        {categories.map((category) => (
          <button
            key={category.key}
            type="button"
            className={`shrink-0 rounded-lg px-2 py-1 text-xs ${
              activeCategory === category.key ? "bg-cyan-400/20 text-cyan-100" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
            onClick={() => setActiveCategory(category.key)}
          >
            {t(`chat.emojiCategory.${category.key}`, category.label)}
          </button>
        ))}
      </div>
      <div className="mt-3 grid max-h-52 grid-cols-8 gap-1 overflow-y-auto">
        {available.length ? (
          available.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-xl hover:bg-zinc-800 focus:bg-cyan-400/15 focus:outline-none"
              onClick={() => {
                saveRecentEmoji(emoji);
                onPick?.(emoji);
              }}
            >
              {emoji}
            </button>
          ))
        ) : (
          <div className="col-span-8 py-5 text-center text-xs text-zinc-500">
            {t("chat.emojiEmpty", "Aucun emoji.")}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatAttachmentList({ attachments, compact = false }) {
  const gif = findGifAttachment(attachments);
  if (!gif?.mediaUrl && !gif?.previewUrl) return null;

  return (
    <div className={compact ? "mt-1" : "mt-3"}>
      <img
        src={gif.mediaUrl || gif.previewUrl}
        alt={gif.title || "GIF"}
        loading="lazy"
        decoding="async"
        draggable="false"
        className={`${compact ? "h-12 max-w-24" : "max-h-72 max-w-full sm:max-w-md"} rounded-xl border border-zinc-800 object-contain`}
      />
    </div>
  );
}

function updateMessageReactions(message, serverReactions) {
  if (!message) return message;
  return { ...message, reactions: Array.isArray(serverReactions) ? serverReactions : [] };
}

function MessageReactions({ message, onToggleReaction, pendingReactionKey, t }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {reactions.map((reaction) => {
        const key = `${message.id}:${reaction.emoji}`;
        return (
          <button
            key={reaction.emoji}
            type="button"
            className={`rounded-full border px-2 py-1 text-xs transition ${
              reaction.reactedByMe
                ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
                : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            }`}
            disabled={pendingReactionKey === key}
            onClick={() => onToggleReaction(message, reaction.emoji)}
          >
            <span className="mr-1 text-sm">{reaction.emoji}</span>
            {reaction.count}
          </button>
        );
      })}
      {message.permissions?.canReact ? (
        <div className="relative">
          <button
            type="button"
            className="flex h-8 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-300 hover:bg-zinc-800"
            onClick={() => setPickerOpen((open) => !open)}
            aria-label={t("chat.addReaction", "Ajouter une reaction")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {pickerOpen ? (
            <div className="absolute bottom-full left-0 z-30 mb-2">
              <EmojiPicker
                compact
                t={t}
                onClose={() => setPickerOpen(false)}
                onPick={(emoji) => {
                  setPickerOpen(false);
                  onToggleReaction(message, emoji);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GifPicker({ apiBase, language, config, onPick, onClose, t }) {
  const rootRef = useRef(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const enabled = Boolean(config?.features?.gif?.enabled);

  async function loadGifs({ next = false, search = query } = {}) {
    if (!enabled) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        action: "gif-search",
        targetLanguage: language,
        limit: "12",
      });
      if (search.trim()) params.set("query", search.trim());
      if (next && cursor) params.set("cursor", cursor);
      const response = await fetch(`${apiBase}/api/portal-chat?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("chat.gifError", "Recherche GIF indisponible."));
      setItems((previous) => (next ? [...previous, ...(payload.items || [])] : payload.items || []));
      setCursor(payload.nextCursor || "");
    } catch (fetchError) {
      setError(fetchError?.message || t("chat.gifError", "Recherche GIF indisponible."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) onClose?.();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  useEffect(() => {
    if (enabled) void loadGifs({ search: "" });
  }, [enabled, language]);

  return (
    <div
      ref={rootRef}
      className="w-[min(520px,calc(100vw-2rem))] rounded-2xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl shadow-black/50"
      role="dialog"
      aria-label={t("chat.gifPicker", "Selecteur GIF")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-zinc-100">{t("chat.gifPicker", "GIF")}</div>
        <button type="button" className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {!enabled ? (
        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {t("chat.gifDisabled", "Le fournisseur GIF n'est pas configure.")}
        </div>
      ) : (
        <>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setCursor("");
              void loadGifs({ search: query });
            }}
          >
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("chat.gifSearch", "Chercher un GIF...")}
                className="h-10 w-full rounded-xl border border-zinc-800 bg-black pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/60"
              />
            </label>
            <Button type="submit" variant="outline" className="h-10 rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100">
              {t("chat.search", "Chercher")}
            </Button>
          </form>
          {error ? <div className="mt-3 text-sm text-red-200">{error}</div> : null}
          <div className="mt-3 grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {items.map((item) => (
              <button
                key={`${item.provider}:${item.providerItemId}`}
                type="button"
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left hover:border-cyan-400/50"
                onClick={() => {
                  onPick(item);
                  onClose?.();
                }}
              >
                <img
                  src={item.previewUrl || item.mediaUrl}
                  alt={item.title || "GIF"}
                  loading="lazy"
                  decoding="async"
                  className="aspect-video w-full object-cover"
                />
              </button>
            ))}
            {!items.length && !loading ? (
              <div className="col-span-2 py-8 text-center text-sm text-zinc-500 sm:col-span-3">
                {t("chat.gifEmpty", "Aucun GIF.")}
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500">
              {config?.features?.gif?.attribution ? t("chat.gifPoweredBy", "Resultats fournis par") + ` ${config.features.gif.attribution}` : ""}
            </span>
            {cursor ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100"
                onClick={() => loadGifs({ next: true })}
                disabled={loading}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("chat.loadMore", "Plus")}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
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

function ChatMessage({
  message,
  language,
  onReply,
  onDelete,
  onJumpToMessage,
  onToggleReaction,
  pendingReactionKey,
  showOriginal,
  onToggleOriginal,
  highlighted,
  registerMessageRef,
  t,
}) {
  if (message.deleted || message.deletedAt) return null;

  const displayedBody = showOriginal
      ? message.bodyOriginal
      : message.body;
  const replyGif = findGifAttachment(message.replyTo?.attachments);
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
    <article
      ref={(node) => registerMessageRef?.(message.id, node)}
      className={`rounded-2xl border bg-zinc-950/80 p-4 transition ${
        highlighted ? "border-cyan-300 shadow-[0_0_0_2px_rgba(103,232,249,0.25)]" : "border-zinc-800"
      }`}
    >
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

          {message.replyTo && !message.replyTo.deleted ? (
            <button
              type="button"
              className="mt-2 flex max-w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-[11px] leading-4 text-zinc-500 transition hover:bg-zinc-900/60 hover:text-zinc-300"
              onClick={() => onJumpToMessage(message.replyTo)}
            >
              <span className="h-4 w-4 rounded-tl-md border-l-2 border-t-2 border-zinc-700" aria-hidden="true" />
              <span className="shrink-0 font-semibold text-zinc-400">@{message.replyTo.authorName}</span>
              <span className="min-w-0 truncate">
                {message.replyTo.body || (replyGif ? t("chat.replyGif", "GIF") : "")}
              </span>
              {replyGif?.previewUrl || replyGif?.mediaUrl ? (
                <img
                  src={replyGif.previewUrl || replyGif.mediaUrl}
                  alt={replyGif.title || "GIF"}
                  className="h-8 w-10 rounded object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </button>
          ) : null}

          {displayedBody ? (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">
              {displayedBody}
            </p>
          ) : null}

          <ChatAttachmentList attachments={message.attachments} />

          {translationNotice ? (
            <p className="mt-2 text-xs text-amber-300/80">{translationNotice}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {message.permissions?.canReact ? (
              QUICK_REACTIONS.map((emoji) => (
                <Button
                  key={emoji}
                  type="button"
                  variant="outline"
                  className="h-8 rounded-lg border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 hover:bg-zinc-800"
                  disabled={pendingReactionKey === `${message.id}:${emoji}`}
                  onClick={() => onToggleReaction(message, emoji)}
                >
                  {emoji}
                </Button>
              ))
            ) : null}
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
          <MessageReactions
            message={message}
            pendingReactionKey={pendingReactionKey}
            onToggleReaction={onToggleReaction}
            t={t}
          />
        </div>
      </div>
    </article>
  );
}

export default function GlobalChatTab({ session }) {
  const { language, t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const isLeader = isLeaderSession(session);
  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const messageRefs = useRef(new Map());
  const messagesRef = useRef([]);
  const latestCursorRef = useRef("");
  const mountedRef = useRef(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [composer, setComposer] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [selectedGif, setSelectedGif] = useState(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [pendingReactionKey, setPendingReactionKey] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [beforeCursor, setBeforeCursor] = useState("");
  const [showOriginalIds, setShowOriginalIds] = useState(() => new Set());
  const [config, setConfig] = useState({ maxLength: 1000, pollingMs: 4000 });

  const maxLength = Number(config.maxLength || 1000);
  const trimmedComposer = composer.trim();
  const canSend = Boolean(trimmedComposer || selectedGif) && !sending && trimmedComposer.length <= maxLength;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
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
      const ids = messagesRef.current.map((message) => message.id).filter(Boolean);
      if (ids.length) void refreshReactionState(ids);
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
    if (!canSend) return;
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
          attachment: selectedGif
            ? {
                type: "gif",
                provider: selectedGif.provider,
                providerItemId: selectedGif.providerItemId,
              }
            : null,
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
      setSelectedGif(null);
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

  function registerMessageRef(messageId, node) {
    if (!messageId) return;
    const key = String(messageId);
    if (node) messageRefs.current.set(key, node);
    else messageRefs.current.delete(key);
  }

  function scrollToMessage(messageId) {
    const node = messageRefs.current.get(String(messageId || ""));
    if (!node) return false;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(String(messageId));
    window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === String(messageId) ? "" : current));
    }, 2200);
    return true;
  }

  async function jumpToMessage(target) {
    if (!target?.id) return;
    setNoticeMessage("");

    if (target.deleted) {
      setNoticeMessage(t("chat.originalUnavailable", "Le message d'origine n'est plus disponible."));
      return;
    }

    if (scrollToMessage(target.id)) return;

    try {
      const params = new URLSearchParams({
        action: "context",
        messageId: target.id,
        targetLanguage: language,
      });
      const response = await fetch(`${apiBase}/api/portal-chat?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("chat.originalUnavailable", "Le message d'origine n'est plus disponible."));
      setMessages((previous) => mergeMessages(previous, payload.messages || []));
      window.setTimeout(() => {
        if (!scrollToMessage(payload.targetMessageId || target.id)) {
          setNoticeMessage(t("chat.originalUnavailable", "Le message d'origine n'est plus disponible."));
        }
      }, 80);
    } catch (error) {
      setNoticeMessage(error?.message || t("chat.originalUnavailable", "Le message d'origine n'est plus disponible."));
    }
  }

  function insertEmoji(emoji) {
    const input = textareaRef.current;
    const start = input?.selectionStart ?? composer.length;
    const end = input?.selectionEnd ?? composer.length;
    const next = `${composer.slice(0, start)}${emoji}${composer.slice(end)}`;
    setComposer(next);
    setEmojiPickerOpen(false);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const position = start + emoji.length;
      textareaRef.current?.setSelectionRange(position, position);
    });
  }

  async function refreshReactionState(messageIds) {
    const ids = [...new Set((messageIds || []).filter(Boolean))].slice(0, 100);
    if (!ids.length) return;
    try {
      const response = await fetch(`${apiBase}/api/portal-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reaction-state", messageIds: ids }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.reactionsByMessageId) return;
      const deletedIds = new Set((payload.deletedMessageIds || []).map(String));
      setMessages((previous) =>
        previous
          .filter((message) => !deletedIds.has(String(message.id)))
          .map((message) =>
            payload.reactionsByMessageId[message.id]
              ? updateMessageReactions(message, payload.reactionsByMessageId[message.id])
              : message,
          ),
      );
      if (replyTo?.id && deletedIds.has(String(replyTo.id))) setReplyTo(null);
    } catch {
      // Reaction polling is best-effort.
    }
  }

  async function toggleReaction(message, emoji) {
    if (!message?.id || !emoji) return;
    const key = `${message.id}:${emoji}`;
    if (pendingReactionKey === key) return;
    setPendingReactionKey(key);
    setErrorMessage("");

    const previousMessages = messages;
    setMessages((current) =>
      current.map((item) => {
        if (item.id !== message.id) return item;
        const reactions = Array.isArray(item.reactions) ? [...item.reactions] : [];
        const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
        if (index >= 0) {
          const reaction = reactions[index];
          const nextReacted = !reaction.reactedByMe;
          const nextCount = Math.max(0, Number(reaction.count || 0) + (nextReacted ? 1 : -1));
          if (nextCount <= 0) reactions.splice(index, 1);
          else reactions[index] = { ...reaction, count: nextCount, reactedByMe: nextReacted };
        } else {
          reactions.push({ emoji, count: 1, reactedByMe: true });
        }
        return { ...item, reactions };
      }),
    );

    try {
      const response = await fetch(`${apiBase}/api/portal-chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle-reaction", messageId: message.id, emoji }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("chat.reactionError", "Reaction impossible."));
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? updateMessageReactions(item, payload.reactions || []) : item)),
      );
    } catch (error) {
      setMessages(previousMessages);
      setErrorMessage(error?.message || t("chat.reactionError", "Reaction impossible."));
    } finally {
      setPendingReactionKey("");
    }
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
      {noticeMessage ? (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          {noticeMessage}
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <div ref={scrollRef} className="max-h-[62vh] min-h-[420px] space-y-3 overflow-y-auto p-4">
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
                onJumpToMessage={jumpToMessage}
                onToggleReaction={toggleReaction}
                pendingReactionKey={pendingReactionKey}
                highlighted={highlightedMessageId === String(message.id)}
                registerMessageRef={registerMessageRef}
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

          {selectedGif ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src={selectedGif.previewUrl || selectedGif.mediaUrl}
                  alt={selectedGif.title || "GIF"}
                  className="h-20 w-28 rounded-lg object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">GIF</div>
                  <div className="truncate text-sm font-semibold text-zinc-100">{selectedGif.title || "GIF"}</div>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800"
                onClick={() => setSelectedGif(null)}
                aria-label={t("chat.removeGif", "Retirer le GIF")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-end">
            <div className="flex gap-2">
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-2xl border-zinc-700 bg-zinc-900 px-3 text-zinc-200 hover:bg-zinc-800"
                  onClick={() => setEmojiPickerOpen((open) => !open)}
                  aria-label={t("chat.openEmojiPicker", "Ouvrir les emojis")}
                >
                  <Smile className="h-4 w-4" />
                </Button>
                {emojiPickerOpen ? (
                  <div className="absolute bottom-full left-0 z-40 mb-2">
                    <EmojiPicker t={t} onPick={insertEmoji} onClose={() => setEmojiPickerOpen(false)} />
                  </div>
                ) : null}
              </div>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-2xl border-zinc-700 bg-zinc-900 px-3 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                  onClick={() => setGifPickerOpen((open) => !open)}
                  disabled={!config?.features?.gif?.enabled}
                  aria-label={t("chat.openGifPicker", "Ouvrir les GIF")}
                  title={
                    config?.features?.gif?.enabled
                      ? t("chat.openGifPicker", "Ouvrir les GIF")
                      : t("chat.gifDisabled", "Le fournisseur GIF n'est pas configure.")
                  }
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
                {gifPickerOpen ? (
                  <div className="absolute bottom-full left-0 z-40 mb-2">
                    <GifPicker
                      apiBase={apiBase}
                      language={language}
                      config={config}
                      t={t}
                      onPick={setSelectedGif}
                      onClose={() => setGifPickerOpen(false)}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <label className="block">
              <span className="sr-only">{t("chat.placeholder", "Ecris un message...")}</span>
              <textarea
                ref={textareaRef}
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
              disabled={!canSend}
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
