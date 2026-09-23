export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

export class NavigationGrid {
  readonly width: number;
  readonly height: number;
  readonly costs: Uint16Array;

  constructor(width: number, height: number, costs?: Uint16Array) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`invalid grid dimensions ${width}x${height}`);
    }
    const area = width * height;
    if (!Number.isSafeInteger(area)) throw new RangeError("grid area exceeds integer range");
    if (costs && costs.length !== area) {
      throw new RangeError(`cost grid needs ${area} entries; received ${costs.length}`);
    }
    this.width = width;
    this.height = height;
    this.costs = costs ? Uint16Array.from(costs) : new Uint16Array(area).fill(1);
  }

  index(x: number, y: number): number {
    if (!this.contains(x, y)) throw new RangeError(`grid coordinate is out of bounds: ${x},${y}`);
    return y * this.width + x;
  }

  point(index: number): GridPoint {
    if (!Number.isInteger(index) || index < 0 || index >= this.costs.length) {
      throw new RangeError(`grid index is out of bounds: ${index}`);
    }
    return { x: index % this.width, y: Math.floor(index / this.width) };
  }

  contains(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isPassable(x: number, y: number): boolean {
    return this.contains(x, y) && this.costs[y * this.width + x] > 0;
  }

  neighbors(index: number): readonly number[] {
    const { x, y } = this.point(index);
    const result: number[] = [];
    for (const [offsetX, offsetY] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (this.isPassable(nextX, nextY)) result.push(nextY * this.width + nextX);
    }
    return result;
  }
}
