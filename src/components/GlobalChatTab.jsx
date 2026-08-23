import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownCircle,
  ImageIcon,
  Languages,
  Loader2,
  MessageCircle,
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
import ProfileAvatar from "@/components/ProfileAvatar";
import { usePortalLanguage } from "@/lib/portalLanguage";

const NativeEmojiPicker = lazy(() => import("emoji-picker-react"));

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

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥"];
const EMOJI_PICKER_CATEGORIES = [
  { category: "suggested", key: "recent", fallback: "Recently used" },
  { category: "smileys_people", key: "smileysPeople", fallback: "Smileys & people" },
  { category: "animals_nature", key: "animalsNature", fallback: "Animals & nature" },
  { category: "food_drink", key: "foodDrink", fallback: "Food & drink" },
  { category: "activities", key: "activities", fallback: "Activities" },
  { category: "travel_places", key: "travelPlaces", fallback: "Travel & places" },
  { category: "objects", key: "objects", fallback: "Objects" },
  { category: "symbols", key: "symbols", fallback: "Symbols" },
  { category: "flags", key: "flags", fallback: "Flags" },
];
const CONTEXT_MENU_WIDTH = 280;
const CONTEXT_MENU_HEIGHT = 320;
const CONTEXT_MENU_MARGIN = 12;
const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 12;

function clampMessageMenuPosition(x, y) {
  if (typeof window === "undefined") return { x, y };
  const maxX = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN);
  const maxY = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN);
  return {
    x: Math.min(Math.max(CONTEXT_MENU_MARGIN, x), maxX),
    y: Math.min(Math.max(CONTEXT_MENU_MARGIN, y), maxY),
  };
}

function isMessageContextExcludedTarget(target) {
  return Boolean(
    target?.closest?.(
      [
        "a",
        "button",
        "input",
        "textarea",
        "select",
        "option",
        "img",
        "video",
        "iframe",
        "[role='button']",
        "[data-chat-context-exclude='true']",
      ].join(","),
    ),
  );
}

function getEventPath(event) {
  return typeof event?.composedPath === "function" ? event.composedPath() : [];
}

function eventPathIncludesNode(event, node) {
  if (!node) return false;
  const path = getEventPath(event);
  return path.length ? path.includes(node) : node.contains(event?.target);
}

function eventPathHasChatPopoverRoot(event) {
  const path = getEventPath(event);
  if (path.length) {
    return path.some((node) => node?.dataset?.chatPopoverRoot === "true");
  }
  return Boolean(event?.target?.closest?.("[data-chat-popover-root='true']"));
}

function findGifAttachment(attachments) {
  return (attachments || []).find((attachment) => attachment?.attachmentType === "gif");
}

function formatDeletedReplyLabel(replyTo, t) {
  const authorName = replyTo?.author?.displayName || replyTo?.authorName || "";
  if (!authorName) {
    return t("chat.replyDeletedOriginal");
  }
  return t("chat.replyDeletedOriginalFrom").replace("{name}", authorName);
}

function normalizePickedEmoji(emojiData) {
  return typeof emojiData?.emoji === "string" ? emojiData.emoji.trim() : "";
}

function buildEmojiPickerCategories(t) {
  return EMOJI_PICKER_CATEGORIES.map((category) => ({
    category: category.category,
    name: t(`chat.emojiCategory.${category.key}`, category.fallback),
  }));
}

function EmojiPicker({ onPick, onClose, compact = false, language = "fr", t }) {
  const rootRef = useRef(null);
  const [emojiData, setEmojiData] = useState(null);
  const [localeLoading, setLocaleLoading] = useState(false);
  const categories = useMemo(() => buildEmojiPickerCategories(t), [t, language]);

  useEffect(() => {
    let cancelled = false;
    if (language !== "fr") {
      setEmojiData(null);
      setLocaleLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLocaleLoading(true);
    import("emoji-picker-react/dist/data/emojis-fr.js")
      .then((module) => {
        if (!cancelled) setEmojiData(module.default || module);
      })
      .catch(() => {
        if (!cancelled) setEmojiData(null);
      })
      .finally(() => {
        if (!cancelled) setLocaleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (eventPathIncludesNode(event, rootRef.current) || eventPathHasChatPopoverRoot(event)) return;
      onClose?.();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const pickerWidth = compact ? "min(392px, calc(100vw - 24px))" : "min(400px, calc(100vw - 24px))";
  const pickerHeight = compact ? "min(440px, calc(100dvh - 120px))" : "min(460px, calc(100dvh - 120px))";
  const loadingLabel = t("chat.emojiLoading", "Chargement des emojis...");

  const loader = (
    <div className="flex h-48 items-center justify-center gap-2 text-sm text-zinc-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {loadingLabel}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="rounded-2xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl shadow-black/50"
      role="dialog"
      aria-label={t("chat.emojiPicker", "Selecteur emoji")}
      data-chat-popover-root="true"
      data-chat-context-exclude="true"
      onWheelCapture={(event) => event.stopPropagation()}
      onTouchMoveCapture={(event) => event.stopPropagation()}
      style={{
        width: pickerWidth,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: compact ? "calc(100dvh - 96px)" : "calc(100dvh - 72px)",
        boxSizing: "border-box",
        overflow: "visible",
        touchAction: "pan-y",
        "--portal-chat-emoji-picker-height": pickerHeight,
        "--epr-bg-color": "#09090b",
        "--epr-category-label-bg-color": "#09090b",
        "--epr-category-label-text-color": "#a1a1aa",
        "--epr-dark-search-input-bg-color": "#000000",
        "--epr-search-input-bg-color": "#000000",
        "--epr-search-input-bg-color-active": "#000000",
        "--epr-search-input-border-color": "#27272a",
        "--epr-search-input-text-color": "#f4f4f5",
        "--epr-search-input-placeholder-color": "#71717a",
        "--epr-search-border-color": "#27272a",
        "--epr-search-border-color-active": "rgba(34, 211, 238, 0.65)",
        "--epr-text-color": "#e4e4e7",
        "--epr-hover-bg-color": "rgba(39, 39, 42, 0.92)",
        "--epr-focus-bg-color": "rgba(34, 211, 238, 0.16)",
        "--epr-highlight-color": "#22d3ee",
        "--epr-category-icon-active-color": "#67e8f9",
        "--epr-picker-border-color": "#3f3f46",
        "--epr-skin-tone-picker-menu-color": "rgba(24, 24, 27, 0.98)",
        "--epr-horizontal-padding": "10px",
        "--epr-category-navigation-button-size": "28px",
        "--epr-emoji-size": "28px",
        "--epr-emoji-padding": "5px",
      }}
    >
      <style>{`
        .portal-chat-emoji-picker {
          border: 0 !important;
          box-shadow: none !important;
          height: var(--portal-chat-emoji-picker-height) !important;
          max-height: var(--portal-chat-emoji-picker-height) !important;
          max-width: 100% !important;
        }
        .portal-chat-emoji-picker .epr-body {
          min-height: 0 !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          scrollbar-width: none;
          -ms-overflow-style: none;
          overscroll-behavior: contain;
          touch-action: pan-y;
        }
        .portal-chat-emoji-picker .epr-body::-webkit-scrollbar {
          display: none;
        }
        .portal-chat-emoji-picker .epr-emoji-list {
          overflow-x: visible !important;
        }
        .portal-chat-emoji-picker .epr-category-nav {
          flex-wrap: wrap !important;
          gap: 2px !important;
          height: auto !important;
          overflow-x: hidden !important;
          padding-bottom: 6px !important;
        }
        .portal-chat-emoji-picker .epr-category-nav > button,
        .portal-chat-emoji-picker .epr-emoji-category-label {
          flex-shrink: 0;
        }
      `}</style>
      {language === "fr" && localeLoading && !emojiData ? (
        loader
      ) : (
        <Suspense fallback={loader}>
          <NativeEmojiPicker
            className="portal-chat-emoji-picker"
            width="100%"
            height={pickerHeight}
            theme="dark"
            emojiStyle="native"
            lazyLoadEmojis
            suggestedEmojisMode="recent"
            searchPlaceholder={t("chat.emojiSearch", "Chercher...")}
            searchClearButtonLabel={t("chat.emojiClearSearch", "Effacer la recherche")}
            categories={categories}
            emojiData={emojiData || undefined}
            previewConfig={{ showPreview: false }}
            skinTonePickerLocation="SEARCH"
            onEmojiClick={(emojiData) => {
              const emoji = normalizePickedEmoji(emojiData);
              if (!emoji) return;
              onPick?.(emoji);
            }}
          />
        </Suspense>
      )}
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

function MessageReactions({ message, onToggleReaction, pendingReactionKey }) {
  const reactions = Array.isArray(message.reactions) ? message.reactions : [];
  if (!reactions.length) return null;

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
    </div>
  );
}

function MessageContextMenu({
  menu,
  showOriginal,
  pendingReactionKey,
  language,
  onClose,
  onReply,
  onDelete,
  onToggleOriginal,
  onToggleReaction,
  t,
}) {
  const menuRef = useRef(null);
  const pickerRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStyle, setPickerStyle] = useState(null);

  useEffect(() => {
    setPickerOpen(false);
    setPickerStyle(null);
  }, [menu?.message?.id]);

  useEffect(() => {
    if (!menu) return undefined;

    function focusFirstItem() {
      const firstItem = menuRef.current?.querySelector("[role='menuitem']:not(:disabled)");
      firstItem?.focus?.();
    }

    const frame = window.requestAnimationFrame(focusFirstItem);
    return () => window.cancelAnimationFrame(frame);
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;

    function handlePointerDown(event) {
      if (eventPathIncludesNode(event, menuRef.current) || eventPathHasChatPopoverRoot(event)) return;
      onClose?.({ restoreFocus: false });
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (pickerOpen) {
          setPickerOpen(false);
          return;
        }
        onClose?.({ restoreFocus: true });
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll("[role='menuitem']:not(:disabled)") || [])];
      if (!items.length) return;
      event.preventDefault();
      const currentIndex = Math.max(0, items.indexOf(document.activeElement));
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (currentIndex + delta + items.length) % items.length;
      items[nextIndex]?.focus?.();
    }

    function handleWindowClose() {
      onClose?.({ restoreFocus: false });
    }

    function handleWindowScroll(event) {
      if (eventPathHasChatPopoverRoot(event)) return;
      onClose?.({ restoreFocus: false });
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowClose);
    window.addEventListener("scroll", handleWindowScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowClose);
      window.removeEventListener("scroll", handleWindowScroll, true);
    };
  }, [menu, onClose, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen || menu?.source === "touch") {
      setPickerStyle(null);
      return undefined;
    }

    function updatePickerPosition() {
      const menuNode = menuRef.current;
      const pickerNode = pickerRef.current;
      if (!menuNode || !pickerNode) return;

      const viewportMargin = 12;
      const gap = 8;
      const menuRect = menuNode.getBoundingClientRect();
      const pickerRect = pickerNode.getBoundingClientRect();
      const availableRight = window.innerWidth - menuRect.right - viewportMargin;
      const availableLeft = menuRect.left - viewportMargin;
      const openLeft = availableRight < pickerRect.width + gap && availableLeft >= pickerRect.width + gap;
      const left = openLeft ? -(pickerRect.width + gap) : menuRect.width + gap;
      const minTop = viewportMargin - menuRect.top;
      const maxTop = window.innerHeight - viewportMargin - menuRect.top - pickerRect.height;
      const top = Math.min(Math.max(0, minTop), maxTop);

      setPickerStyle({ left: `${left}px`, top: `${top}px` });
    }

    const frame = window.requestAnimationFrame(updatePickerPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [menu?.source, pickerOpen]);

  if (!menu?.message || menu.message.deleted || menu.message.deletedAt) return null;

  const { message } = menu;
  const canReact = Boolean(message.permissions?.canReact);
  const canDelete = Boolean(message.permissions?.canDelete);
  const hasTranslation = Boolean(message.canShowOriginal);
  const isTouchMenu = menu.source === "touch";
  const pickerPositionClass = isTouchMenu ? "mt-3" : "absolute top-0";
  const defaultPickerStyle = isTouchMenu ? undefined : { left: `${CONTEXT_MENU_WIDTH + 8}px`, top: "0px" };

  function runAction(action) {
    onClose?.({ restoreFocus: true });
    action?.();
  }

  const content = (
    <>
      <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        {t("chat.messageActions")}
      </div>
      {canReact ? (
        <div className="mb-2 grid grid-cols-4 gap-2 border-b border-zinc-800 pb-2">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              className="flex h-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-xl transition hover:bg-zinc-800 focus:bg-cyan-400/15 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 disabled:opacity-50"
              disabled={pendingReactionKey === `${message.id}:${emoji}`}
              aria-label={t("chat.reactWith").replace("{emoji}", emoji)}
              onClick={() => runAction(() => onToggleReaction(message, emoji))}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-1">
        {canReact ? (
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 focus:bg-cyan-400/15 focus:outline-none"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Smile className="h-4 w-4 text-zinc-400" />
            {t("chat.addReaction")}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 focus:bg-cyan-400/15 focus:outline-none"
          onClick={() => runAction(() => onReply(message))}
        >
          <Reply className="h-4 w-4 text-zinc-400" />
          {t("chat.reply")}
        </button>
        {hasTranslation ? (
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-900 focus:bg-cyan-400/15 focus:outline-none"
            onClick={() => runAction(() => onToggleOriginal(message.id))}
          >
            <Languages className="h-4 w-4 text-zinc-400" />
            {showOriginal ? t("chat.showTranslation") : t("chat.showOriginal")}
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10 focus:bg-red-500/15 focus:outline-none"
            onClick={() => runAction(() => onDelete(message))}
          >
            <Trash2 className="h-4 w-4 text-red-300" />
            {t("chat.delete")}
          </button>
        ) : null}
      </div>

      {pickerOpen ? (
        <div
          ref={pickerRef}
          className={`${pickerPositionClass} z-50`}
          style={pickerStyle || defaultPickerStyle}
          data-chat-popover-root="true"
          data-chat-context-exclude="true"
        >
          <EmojiPicker
            compact
            t={t}
            language={language}
            onClose={() => setPickerOpen(false)}
            onPick={(emoji) => {
              onToggleReaction(message, emoji);
              onClose?.({ restoreFocus: true });
            }}
          />
        </div>
      ) : null}
    </>
  );

  if (isTouchMenu) {
    return (
      <div
        ref={menuRef}
        className="fixed inset-x-3 bottom-3 z-50 max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-2xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl shadow-black/70"
        role="menu"
        aria-label={t("chat.messageActions")}
        data-chat-popover-root="true"
        data-chat-context-exclude="true"
      >
        {content}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-[280px] rounded-2xl border border-zinc-700 bg-zinc-950 p-2 shadow-2xl shadow-black/70"
      style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
      role="menu"
      aria-label={t("chat.messageActions")}
      data-chat-popover-root="true"
      data-chat-context-exclude="true"
    >
      {content}
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
  return (
    <ProfileAvatar
      avatar={author?.cosmetics?.avatar}
      frame={author?.cosmetics?.frame}
      name={author?.displayName || author?.initial || "?"}
      size={128}
    />
  );
}

function ChatMessage({
  message,
  language,
  onJumpToMessage,
  onOpenMenu,
  onToggleReaction,
  pendingReactionKey,
  showOriginal,
  highlighted,
  registerMessageRef,
  t,
}) {
  const articleRef = useRef(null);
  const longPressRef = useRef(null);
  const suppressContextMenuUntilRef = useRef(0);

  function clearLongPress() {
    if (longPressRef.current?.timer) {
      window.clearTimeout(longPressRef.current.timer);
    }
    longPressRef.current = null;
  }

  function openMenuAt(point) {
    if (!message.permissions || message.deleted || message.deletedAt) return;
    onOpenMenu?.(message, {
      x: point.x,
      y: point.y,
      source: point.source,
      triggerElement: articleRef.current,
    });
  }

  function handleContextMenu(event) {
    if (Date.now() < suppressContextMenuUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isMessageContextExcludedTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    clearLongPress();
    openMenuAt({ x: event.clientX, y: event.clientY, source: "mouse" });
  }

  function handlePointerDown(event) {
    if (event.pointerType !== "touch" || event.isPrimary === false || isMessageContextExcludedTarget(event.target)) return;
    clearLongPress();
    const startX = event.clientX;
    const startY = event.clientY;
    longPressRef.current = {
      startX,
      startY,
      timer: window.setTimeout(() => {
        document.getSelection?.()?.removeAllRanges?.();
        suppressContextMenuUntilRef.current = Date.now() + 900;
        openMenuAt({ x: startX, y: startY, source: "touch" });
        clearLongPress();
      }, LONG_PRESS_DELAY_MS),
    };
  }

  function handlePointerMove(event) {
    if (!longPressRef.current || event.pointerType !== "touch") return;
    const deltaX = Math.abs(event.clientX - longPressRef.current.startX);
    const deltaY = Math.abs(event.clientY - longPressRef.current.startY);
    if (deltaX > LONG_PRESS_MOVE_TOLERANCE || deltaY > LONG_PRESS_MOVE_TOLERANCE) clearLongPress();
  }

  function handleKeyDown(event) {
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenuAt({
        x: rect.left + Math.min(48, rect.width / 2),
        y: rect.top + Math.min(48, rect.height / 2),
        source: "keyboard",
      });
    }
  }

  useEffect(() => () => clearLongPress(), []);

  if (message.deleted || message.deletedAt) return null;

  const displayedBody = showOriginal
      ? message.bodyOriginal
      : message.body;
  const replyGif = findGifAttachment(message.replyTo?.attachments);
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
      ref={(node) => {
        articleRef.current = node;
        registerMessageRef?.(message.id, node);
      }}
      tabIndex={0}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onKeyDown={handleKeyDown}
      className={`rounded-2xl border bg-zinc-950/80 p-4 transition ${
        highlighted ? "border-cyan-300 shadow-[0_0_0_2px_rgba(103,232,249,0.25)]" : "border-zinc-800"
      } focus:outline-none focus:ring-2 focus:ring-cyan-400/30`}
    >
      <div className="flex items-start gap-4">
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

          {message.replyTo?.deleted ? (
            <div
              className="mt-2 flex max-w-full cursor-default items-center gap-2 rounded-lg px-1 py-1 text-left text-[11px] leading-4 text-zinc-500"
              title={t("chat.replyDeletedUnavailable")}
            >
              <span className="h-4 w-4 rounded-tl-md border-l-2 border-t-2 border-zinc-700" aria-hidden="true" />
              {message.replyTo.author?.cosmetics?.avatar ? (
                <ProfileAvatar
                  avatar={message.replyTo.author.cosmetics.avatar}
                  frame={message.replyTo.author.cosmetics.frame}
                  name={message.replyTo.author.displayName || message.replyTo.authorName}
                  size={20}
                />
              ) : null}
              <span className="min-w-0 truncate text-zinc-500">
                {formatDeletedReplyLabel(message.replyTo, t)}
              </span>
            </div>
          ) : message.replyTo ? (
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

          <MessageReactions
            message={message}
            pendingReactionKey={pendingReactionKey}
            onToggleReaction={onToggleReaction}
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
  const messageMenuTriggerRef = useRef(null);
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
  const [messageMenu, setMessageMenu] = useState(null);
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

  useEffect(() => {
    if (!messageMenu?.message?.id) return;
    const stillVisible = messages.some((message) => String(message.id) === String(messageMenu.message.id));
    if (!stillVisible) closeMessageMenu({ restoreFocus: false });
  }, [messages, messageMenu?.message?.id]);

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

  useEffect(() => {
    if (!emojiPickerOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setEmojiPickerOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [emojiPickerOpen]);

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

  function openMessageMenu(message, point = {}) {
    if (!message?.id || message.deleted || message.deletedAt) return;
    const position = clampMessageMenuPosition(Number(point.x || 0), Number(point.y || 0));
    messageMenuTriggerRef.current = point.triggerElement || null;
    setEmojiPickerOpen(false);
    setGifPickerOpen(false);
    setMessageMenu({
      message,
      x: position.x,
      y: position.y,
      source: point.source || "mouse",
    });
  }

  function closeMessageMenu(options = {}) {
    setMessageMenu(null);
    if (options.restoreFocus) {
      window.requestAnimationFrame(() => {
        messageMenuTriggerRef.current?.focus?.();
      });
    }
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
        <div
          ref={scrollRef}
          className="max-h-[62vh] min-h-[420px] space-y-3 overflow-y-auto p-4"
          onScroll={() => {
            if (messageMenu) closeMessageMenu({ restoreFocus: false });
          }}
        >
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
                onJumpToMessage={jumpToMessage}
                onOpenMenu={openMessageMenu}
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

        <MessageContextMenu
          menu={messageMenu}
          showOriginal={messageMenu?.message?.id ? showOriginalIds.has(messageMenu.message.id) : false}
          pendingReactionKey={pendingReactionKey}
          language={language}
          t={t}
          onClose={closeMessageMenu}
          onReply={setReplyTo}
          onDelete={deleteMessage}
          onToggleOriginal={toggleOriginal}
          onToggleReaction={toggleReaction}
        />

        <div className="border-t border-zinc-800 p-4">
          {replyTo ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                  {t("chat.replyingTo", "Reponse a")} {replyTo.author?.displayName || replyTo.authorName || "Joueur"}
                </div>
                <div className="mt-1 truncate text-cyan-50">
                  {replyTo.deleted ? t("chat.replyDeleted") : replyTo.body || replyTo.bodyOriginal || ""}
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
                    <EmojiPicker t={t} language={language} onPick={insertEmoji} onClose={() => setEmojiPickerOpen(false)} />
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
