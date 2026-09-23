export function rgba(indices: Uint8Array, palette: Uint8Array) {
  return Uint8ClampedArray.from({ length: indices.length * 4 }, (_, offset) =>
    offset % 4 === 3 ? 255 : palette[indices[Math.floor(offset / 4)] * 3 + offset % 4]);
}

export function canvas(pixels: Uint8ClampedArray, width: number) {
  const counts = { reads: 0, writes: 0, readPixels: 0 };
  const context = {
    globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData(left: number, top: number, spanWidth: number, spanHeight: number) {
      counts.reads++; counts.readPixels += spanWidth * spanHeight;
      const data = new Uint8ClampedArray(spanWidth * spanHeight * 4);
      for (let row = 0; row < spanHeight; row++) data.set(pixels.subarray(((top + row) * width + left) * 4,
        ((top + row) * width + left + spanWidth) * 4), row * spanWidth * 4);
      return { width: spanWidth, height: spanHeight, data };
    },
    putImageData(data: ImageData, left: number, top: number) {
      counts.writes++;
      for (let row = 0; row < data.height; row++) pixels.set(data.data.subarray(row * data.width * 4, (row + 1) * data.width * 4),
        ((top + row) * width + left) * 4);
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, counts };
}