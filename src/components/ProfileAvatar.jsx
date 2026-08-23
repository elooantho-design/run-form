import React, { useEffect, useMemo, useState } from "react";
import { getFrameVisualInset } from "@/lib/profileCosmetics";

function getInitial(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function getAssetUrl(asset) {
  return asset?.url || asset?.assetUrl || asset?.asset_url || "";
}

export default function ProfileAvatar({
  avatar = null,
  frame = null,
  name = "",
  size = 48,
  className = "",
  fallbackClassName = "",
}) {
  const avatarUrl = getAssetUrl(avatar);
  const frameUrl = avatarUrl ? getAssetUrl(frame) : "";
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const numericSize = Number(size) || 48;
  const insetPercent = useMemo(() => getFrameVisualInset(frame) * 100, [frame]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  useEffect(() => {
    setFrameFailed(false);
  }, [frameUrl]);

  if (!avatarUrl || avatarFailed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 font-bold text-cyan-100 ${fallbackClassName} ${className}`}
        style={{ width: numericSize, height: numericSize, fontSize: Math.max(11, Math.round(numericSize * 0.36)) }}
        aria-hidden="true"
      >
        {getInitial(name)}
      </div>
    );
  }

  return (
    <div
      className={`profile-avatar-root relative isolate shrink-0 overflow-visible ${className}`}
      style={{ width: numericSize, height: numericSize }}
      aria-hidden="true"
    >
      <div
        className="profile-avatar-avatar-layer absolute z-0 overflow-hidden rounded-full"
        style={{
          inset: frameUrl && !frameFailed ? `${insetPercent}%` : 0,
        }}
      >
        <img
          src={avatarUrl}
          alt=""
          className="profile-avatar-avatar-img h-full w-full object-cover"
          draggable="false"
          loading="lazy"
          decoding="async"
          onError={() => setAvatarFailed(true)}
        />
      </div>
      {frameUrl && !frameFailed ? (
        <img
          src={frameUrl}
          alt=""
          className="profile-avatar-frame-img pointer-events-none absolute inset-0 z-10 h-full w-full object-contain"
          draggable="false"
          loading="eager"
          decoding="async"
          onError={() => setFrameFailed(true)}
        />
      ) : null}
    </div>
  );
}
