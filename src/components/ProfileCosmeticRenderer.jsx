import React, { useMemo, useState } from "react";
import {
  getFrameRenderMetadata,
  getProfileFrameAnimationKey,
  PROFILE_FRAME_ANIMATION_INFERNAL_HORNS,
  PROFILE_FRAME_ANIMATION_SHARK_MOUTH,
} from "@/lib/profileCosmetics";

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
  const [failedAvatarUrl, setFailedAvatarUrl] = useState("");
  const [failedFrameUrl, setFailedFrameUrl] = useState("");
  const numericSize = Number(size) || 48;
  const frameMetadata = useMemo(() => getFrameRenderMetadata(frame), [frame]);
  const frameAnimationKey = useMemo(() => getProfileFrameAnimationKey(frame), [frame]);
  const avatarFailed = Boolean(avatarUrl && failedAvatarUrl === avatarUrl);
  const frameFailed = Boolean(frameUrl && failedFrameUrl === frameUrl);
  const hasFrame = Boolean(frameUrl && !frameFailed);
  const hasSharkMouthAnimation = hasFrame && frameAnimationKey === PROFILE_FRAME_ANIMATION_SHARK_MOUTH;
  const hasInfernalHornsAnimation = hasFrame && frameAnimationKey === PROFILE_FRAME_ANIMATION_INFERNAL_HORNS;

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
          onError={() => setFailedAvatarUrl(avatarUrl)}
        />
      </div>
      {hasFrame ? (
        <div
          className={`profile-avatar-frame-layer pointer-events-none absolute z-10 ${
            hasSharkMouthAnimation ? "profile-avatar-frame-layer--shark-mouth" : ""
          } ${hasInfernalHornsAnimation ? "profile-avatar-frame-layer--infernal-horns" : ""}`}
          data-frame-animation={frameAnimationKey || undefined}
          style={{
            left: toPercent(frameBox.x),
            top: toPercent(frameBox.y),
            width: toPercent(frameBox.width),
            height: toPercent(frameBox.height),
          }}
        >
          <img
            src={frameUrl}
            alt=""
            className="profile-avatar-frame-img absolute inset-0 object-contain"
            draggable="false"
            loading="eager"
            decoding="async"
            onError={() => setFailedFrameUrl(frameUrl)}
          />
          {hasSharkMouthAnimation ? (
            <>
              <img
                src={frameUrl}
                alt=""
                className="profile-avatar-shark-shimmer absolute inset-0 object-contain"
                draggable="false"
                loading="eager"
                decoding="async"
              />
              <span className="profile-avatar-shark-eyes absolute inset-0" />
              <span className="profile-avatar-shark-bubbles profile-avatar-shark-bubbles--left absolute" />
              <span className="profile-avatar-shark-bubbles profile-avatar-shark-bubbles--right absolute" />
            </>
          ) : null}
          {hasInfernalHornsAnimation ? (
            <>
              <span className="profile-avatar-infernal-lava-zone absolute inset-0">
                <img
                  src={frameUrl}
                  alt=""
                  className="profile-avatar-infernal-lava-scan absolute inset-0 object-contain"
                  draggable="false"
                  loading="eager"
                  decoding="async"
                />
              </span>
              <img
                src={frameUrl}
                alt=""
                className="profile-avatar-infernal-horn-tips absolute inset-0 object-contain"
                draggable="false"
                loading="eager"
                decoding="async"
              />
              <span className="profile-avatar-infernal-jewels absolute inset-0" />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
