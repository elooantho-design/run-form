import React, { useMemo, useState } from "react";
import { getHeroPortraitImageSources } from "@/lib/heroPortraits";

export default function HeroPortraitImage({
  heroName,
  championDisplayMap,
  alt,
  className = "",
  draggable = false,
  fallback = null,
}) {
  const imageSources = useMemo(
    () => getHeroPortraitImageSources(heroName, championDisplayMap),
    [championDisplayMap, heroName],
  );
  const sourceKey = imageSources.join("|");
  const [fallbackState, setFallbackState] = useState({ sourceKey: "", index: 0 });

  const sourceIndex = fallbackState.sourceKey === sourceKey ? fallbackState.index : 0;
  const src = imageSources[sourceIndex] || "";
  if (!src) return fallback;

  return (
    <img
      src={src}
      alt={alt || heroName || ""}
      className={className}
      draggable={draggable}
      onError={() => {
        setFallbackState((current) => {
          const currentIndex = current.sourceKey === sourceKey ? current.index : 0;
          return {
            sourceKey,
            index: currentIndex + 1 < imageSources.length ? currentIndex + 1 : imageSources.length,
          };
        });
      }}
    />
  );
}
