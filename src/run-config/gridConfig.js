export const BASTION_BG_URL = "/maps-actuelles/bastion-11x8-20261025.png";
export const TOUR_BG_URL = "/maps-actuelles/tour-10x7-20261025.png";

export const RUN_GRID_CONFIG = {
  tour: {
    key: "tour",
    label: "Tour",
    rows: 7,
    cols: 10,
    bgUrl: TOUR_BG_URL,
    // Backgrounds are cropped to the playable grid; retain their pixel ratio.
    cellAspectRatio: "707 / 723",
    bgObjectFit: "fill",
    bgObjectPosition: "center",
  },
  bastion: {
    key: "bastion",
    label: "Bastion",
    rows: 8,
    cols: 11,
    bgUrl: BASTION_BG_URL,
    cellAspectRatio: "8048 / 8085",
    bgObjectFit: "fill",
    bgObjectPosition: "center",
  },
};

export function getRunGridSpec(mode) {
  return RUN_GRID_CONFIG[mode] || RUN_GRID_CONFIG.tour;
}
