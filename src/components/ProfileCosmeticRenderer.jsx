import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  getFrameRenderMetadata,
  getProfileAvatarMediaInfo,
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

const EMPTY_ANIMATION_LAYERS = [];

function getLayerDelayMs(layer) {
  return Math.max(0, Number(layer?.delayMs) || 0);
}

function AnimationLayer({ layer, onStatusChange }) {
  const delayMs = getLayerDelayMs(layer);
  const [layerVisible, setLayerVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return undefined;

    const timerId = window.setTimeout(() => {
      setLayerVisible(true);
    }, delayMs);

    return () => window.clearTimeout(timerId);
  }, [delayMs, layer.id, layer.url]);

  return (
    <span
      className="profile-avatar-animation-layer absolute"
      data-animation-layer-id={layer.id}
      data-animation-layer-visible={layerVisible ? "true" : "false"}
      style={{
        left: toPercent(layer.x),
        top: toPercent(layer.y),
        width: toPercent(layer.width),
        height: toPercent(layer.height),
        zIndex: layer.zIndex,
        pointerEvents: "none",
        opacity: layerVisible ? layer.opacity : 0,
        mixBlendMode: layer.blendMode === "normal" ? undefined : layer.blendMode,
        transform: `${layer.flipX ? "scaleX(-1) " : ""}rotate(${layer.rotation}deg)`,
      }}
      title={layer.label || layer.id}
    >
      <img
        src={layer.url}
        alt=""
        className="profile-avatar-animation-layer-img h-full w-full object-contain"
        draggable="false"
        loading="eager"
        decoding="async"
        onLoad={(event) =>
          onStatusChange?.(layer.id, "loaded", {
            naturalWidth: event.currentTarget.naturalWidth,
            naturalHeight: event.currentTarget.naturalHeight,
          })
        }
        onError={() => onStatusChange?.(layer.id, "error")}
      />
    </span>
  );
}

function usePrefersReducedMotion(previewAnimations) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  });

  useEffect(() => {
    if (previewAnimations || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(Boolean(mediaQuery.matches));
    update();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener?.(update);
    return () => mediaQuery.removeListener?.(update);
  }, [previewAnimations]);

  return previewAnimations ? false : prefersReducedMotion;
}

function useAvatarVideoPlayback({ enabled, previewAnimations }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const prefersReducedMotion = usePrefersReducedMotion(previewAnimations);
  const [isVisible, setIsVisible] = useState(true);
  const hasIntersectionObserver =
    typeof window !== "undefined" && typeof window.IntersectionObserver === "function";
  const shouldPlay = Boolean(enabled && !prefersReducedMotion && (!hasIntersectionObserver || isVisible));

  useEffect(() => {
    if (!enabled || !hasIntersectionObserver) {
      return undefined;
    }

    const node = rootRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.08 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, hasIntersectionObserver]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return undefined;

    if (!shouldPlay) {
      video.pause();
      return undefined;
    }

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }

    return undefined;
  }, [enabled, shouldPlay]);

  return { rootRef, videoRef, shouldPlay };
}

export default function ProfileCosmeticRenderer({
  avatar = null,
  frame = null,
  name = "",
  size = 48,
  className = "",
  fallbackClassName = "",
  previewAnimations = false,
  onAnimationLayerStatusChange = null,
}) {
  const avatarUrl = getAssetUrl(avatar);
  const frameUrl = avatarUrl ? getAssetUrl(frame) : "";
  const avatarMedia = useMemo(() => getProfileAvatarMediaInfo(avatar), [avatar]);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState("");
  const [failedFrameUrl, setFailedFrameUrl] = useState("");
  const numericSize = Number(size) || 48;
  const frameMetadata = useMemo(() => getFrameRenderMetadata(frame), [frame]);
  const frameAnimationKey = useMemo(() => getProfileFrameAnimationKey(frame), [frame]);
  const avatarFailed = Boolean(avatarUrl && failedAvatarUrl === avatarUrl);
  const frameFailed = Boolean(frameUrl && failedFrameUrl === frameUrl);
  const hasFrame = Boolean(frameUrl && !frameFailed);
  const avatarIsVideo = Boolean(avatarUrl && !avatarFailed && avatarMedia.isVideo);
  const { rootRef, videoRef, shouldPlay: videoShouldPlay } = useAvatarVideoPlayback({
    enabled: avatarIsVideo,
    previewAnimations,
  });
  const hasSharkMouthAnimation = hasFrame && frameAnimationKey === PROFILE_FRAME_ANIMATION_SHARK_MOUTH;
  const hasInfernalHornsAnimation = hasFrame && frameAnimationKey === PROFILE_FRAME_ANIMATION_INFERNAL_HORNS;
  const animationLayers =
    hasFrame && Array.isArray(frameMetadata.animation_layers) ? frameMetadata.animation_layers : EMPTY_ANIMATION_LAYERS;

  if ((!avatarUrl || avatarFailed) && !hasFrame) {
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
  const avatarStyle = {
    objectFit: hasFrame ? frameMetadata.avatar_fit : "cover",
    objectPosition: avatarPosition,
  };

  return (
    <div
      ref={rootRef}
      className={`profile-avatar-root relative isolate shrink-0 overflow-visible ${
        previewAnimations ? "profile-avatar-root--preview-animations" : ""
      } ${className}`}
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
        {!avatarUrl || avatarFailed ? (
          <div
            className={`flex h-full w-full items-center justify-center bg-cyan-400/10 font-bold text-cyan-100 ${fallbackClassName}`}
            style={{ fontSize: Math.max(11, Math.round(numericSize * 0.36)) }}
          >
            {getInitial(name)}
          </div>
        ) : avatarIsVideo ? (
          <video
            ref={videoRef}
            src={avatarUrl}
            className="profile-avatar-avatar-img profile-avatar-avatar-video h-full w-full"
            style={avatarStyle}
            autoPlay={videoShouldPlay}
            muted
            loop
            playsInline
            controls={false}
            disablePictureInPicture
            preload="metadata"
            draggable="false"
            onError={() => setFailedAvatarUrl(avatarUrl)}
          />
        ) : (
          <img
            src={avatarUrl}
            alt=""
            className="profile-avatar-avatar-img h-full w-full"
            style={avatarStyle}
            draggable="false"
            loading="lazy"
            decoding="async"
            onError={() => setFailedAvatarUrl(avatarUrl)}
          />
        )}
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
          {animationLayers.map((layer) => (
            <AnimationLayer
              key={`${layer.id}:${layer.url || ""}:${getLayerDelayMs(layer)}`}
              layer={layer}
              onStatusChange={onAnimationLayerStatusChange}
            />
          ))}
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
