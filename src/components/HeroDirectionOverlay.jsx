import React from "react";
import { getHeroDirectionOverlayConfig } from "@/lib/heroDirectionOverlay";

export default function HeroDirectionOverlay({ direction, className = "", style = null }) {
  const overlay = getHeroDirectionOverlayConfig(direction);
  if (!overlay) return null;

  return (
    <img
      src={overlay.src}
      alt=""
      aria-hidden="true"
      className={`pointer-events-none absolute select-none ${className}`}
      style={{
        width: overlay.width,
        height: overlay.height,
        objectFit: "contain",
        left: overlay.left,
        top: overlay.top,
        transform: overlay.transform,
        ...style,
      }}
      draggable={false}
    />
  );
}
