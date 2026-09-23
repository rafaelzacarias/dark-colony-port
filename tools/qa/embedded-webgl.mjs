export async function verifyEmbeddedWebGL() {
  const { RemapTable } = await import("/src/render/palette.ts");
  const api = await import("/src/render/indexed-webgl.ts");
  const remap = new RemapTable(Uint8Array.from({ length: 196608 }, (_, index) =>
    ((index >>> 16) * 71 + ((index >>> 8) & 255) * 13 + (index & 255)) & 255));
  const palette = Uint8Array.from({ length: 768 }, (_, index) => (index * 43 + 17) & 255);
  const tables = { remap, palette };
  const uploaded = api.preparePaletteUpload(tables);
  const source = {
    width: 7, height: 3,
    indices: Uint8Array.from({ length: 21 }, (_, index) => index * 11),
    coverage: { mode: "mask", bytes: Uint8Array.from({ length: 21 }, (_, index) => index % 4 ? 255 : 0) },
  };
  const prepared = api.prepareIndexedUpload(source);
  const canvas = document.createElement("canvas");
  canvas.width = 7;
  canvas.height = 3;
  const renderer = new api.IndexedWebGLRenderer(canvas, tables);
  const image = renderer.upload(source);
  const gl = canvas.getContext("webgl2");
  const pixels = new Uint8Array(7 * 3 * 4);
  let checkedPixels = 0;
  try {
    for (const bank of [0, 1, 2]) {
      for (let row = 0; row < 256; row += 1) {
        for (const mirrorX of [false, true]) {
          const lookup = bank === 1 ? { bank, row } : { bank, brightness: row >>> 3, selector: row & 7 };
          renderer.render([{ image, x: 0, y: 0, width: 7, height: 3, mirrorX, lookup }]);
          gl.readPixels(0, 0, 7, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          for (let y = 0; y < 3; y += 1) {
            for (let x = 0; x < 7; x += 1) {
              const expected = api.lookupIndexedPixel(prepared, uploaded, lookup, x, y, mirrorX);
              const offset = ((2 - y) * 7 + x) * 4;
              if (expected.some((value, channel) => pixels[offset + channel] !== value)) {
                throw new Error(`GPU mismatch bank=${bank} row=${row} mirror=${mirrorX} at ${x},${y}`);
              }
              checkedPixels += 1;
            }
          }
        }
      }
    }
  } finally {
    renderer.dispose();
  }
  if (renderer.ready) throw new Error("Renderer remained ready after disposal");
  return { passed: true, checkedPixels, bankRows: 768, mirrorStates: 2, coverage: "asymmetric-mask" };
}