import { assetUrl } from "../asset-url";

export const ORIGINAL_HUD = {
  width: 640,
  height: 480,
  frameUrl: assetUrl("/assets/generated/interface/INTRFACE.GIF"),
  world: { x: 4, y: 4, width: 512, height: 452 },
  rightPanel: { x: 518, y: 4, width: 120, height: 396 },
  portrait: { x: 537, y: 113, width: 80, height: 120 },
  labels: [{ x: 49, y: 460 }, { x: 522, y: 405 }],
  message: { x: 132, y: 460 },
  radar: { x: 522, y: 4, width: 112, height: 98 },
} as const;