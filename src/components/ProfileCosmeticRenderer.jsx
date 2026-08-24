import React, { useEffect, useMemo, useState } from "react";
import { getFrameRenderMetadata } from "@/lib/profileCosmetics";

function getInitial(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function getAssetUrl(asset) {
  return asset?.url || asset?.assetUrl || asset?.asset_url || "";
}

function toPercent(value) {
  return `${Number(value || 0) * 100}%`;
}

export default function ProfileCosmeticRenderer({
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
  const frameMetadata = useMemo(() => getFrameRenderMetadata(frame), [frame]);
  const hasFrame = Boolean(frameUrl && !frameFailed);

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

  const contentBox = hasFrame ? frameMetadata.content_box : { x: 0, y: 0, width: 1, height: 1 };
  const frameBox = frameMetadata.frame_box;
  const avatarRadius = hasFrame ? `${frameMetadata.content_radius * 100}%` : "9999px";
  const avatarPosition = `${toPercent(frameMetadata.avatar_position.x)} ${toPercent(frameMetadata.avatar_position.y)}`;

  return (
    <div
      className={`profile-avatar-root relative isolate shrink-0 overflow-visible ${className}`}
      style={{ width: numericSize, height: numericSize }}
      aria-hidden="true"
    >
      <div
        className="profile-avatar-avatar-layer absolute z-0 overflow-hidden"
        style={{
          left: toPercent(contentBox.x),
          top: toPercent(contentBox.y),
          width: toPercent(contentBox.width),
          height: toPercent(contentBox.height),
          borderRadius: avatarRadius,
        }}
      >
        <img
          src={avatarUrl}
          alt=""
          className="profile-avatar-avatar-img h-full w-full"
          style={{
            objectFit: hasFrame ? frameMetadata.avatar_fit : "cover",
            objectPosition: avatarPosition,
          }}
          draggable="false"
          loading="lazy"
          decoding="async"
          onError={() => setAvatarFailed(true)}
        />
      </div>
      {hasFrame ? (
        <img
          src={frameUrl}
          alt=""
          className="profile-avatar-frame-img pointer-events-none absolute z-10 object-contain"
          style={{
            left: toPercent(frameBox.x),
            top: toPercent(frameBox.y),
            width: toPercent(frameBox.width),
            height: toPercent(frameBox.height),
          }}
          draggable="false"
          loading="eager"
          decoding="async"
          onError={() => setFrameFailed(true)}
        />
      ) : null}
    </div>
  );
}
