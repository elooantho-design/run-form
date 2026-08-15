export const BASTION_BG_URL = "/maps-actuelles/bastion-11x8-current.png";
export const TOUR_BG_URL = "/maps-actuelles/tour.png";

export const RUN_GRID_CONFIG = {
  tour: {
    key: "tour",
    label: "Tour",
    rows: 7,
    cols: 10,
    bgUrl: TOUR_BG_URL,
    bgObjectFit: "fill",
    bgObjectPosition: "center",
  },
  bastion: {
    key: "bastion",
    label: "Bastion",
    rows: 8,
    cols: 11,
    bgUrl: BASTION_BG_URL,
    bgObjectFit: "fill",
    bgObjectPosition: "center",
  },
};

export function getRunGridSpec(mode) {
  return RUN_GRID_CONFIG[mode] || RUN_GRID_CONFIG.tour;
}
