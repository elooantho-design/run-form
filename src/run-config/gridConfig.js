export const BASTION_BG_URL = "/maps-actuelles/bastion.png";
export const TOUR_BG_URL = "/maps-actuelles/tour.png";

export const RUN_GRID_CONFIG = {
  tour: {
    key: "tour",
    label: "Tour",
    rows: 7,
    cols: 10,
    bgUrl: TOUR_BG_URL,
  },
  bastion: {
    key: "bastion",
    label: "Bastion",
    rows: 7,
    cols: 11,
    bgUrl: BASTION_BG_URL,
  },
};

export function getRunGridSpec(mode) {
  return RUN_GRID_CONFIG[mode] || RUN_GRID_CONFIG.tour;
}