export function worldYToScreen(worldY: number, cameraY: number, height: number, tileSize: number): number {
  return height / 2 + (cameraY - worldY) * tileSize;
}

export function screenYToWorld(screenY: number, cameraY: number, height: number, tileSize: number): number {
  return cameraY - (screenY - height / 2) / tileSize;
}