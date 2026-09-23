import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function installSourceRender() {
  const root = new URL("../../../public/", import.meta.url);
  const images = new Set<string>();
  const warnings: string[] = [];
  let spriteDraws = 0, imageDraws = 0, enabled = true;
  const drawing = new Proxy({
    drawImage: (image: { palette?: boolean }) => {
      imageDraws += 1;
      if (image.palette) spriteDraws += 1;
    },
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    measureText: () => ({ width: 0 }),
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
  const canvas = () => ({ width: 512, height: 452, palette: true,
    getContext: (type: string) => type === "2d" && enabled ? drawing : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }),
  }) as unknown as HTMLCanvasElement;
  const originals = ["Image", "document"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const warn = console.warn;
  class SourceImage {
    width = 0;
    height = 0;
    listeners = new Map<string, () => void>();
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    set src(url: string) {
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
      const bytes = readFileSync(new URL(url.slice(1), root));
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      this.width = bytes.readUInt32BE(16); this.height = bytes.readUInt32BE(20);
      assert.ok(this.width > 0 && this.height > 0);
      images.add(url);
      queueMicrotask(() => this.listeners.get("load")?.());
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: SourceImage });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: canvas } });
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  return {
    canvas,
    setEnabled(value: boolean) { enabled = value; },
    evidence: () => ({ spriteDraws, imageDraws, images: [...images].sort(), warnings: [...warnings] }),
    dispose() {
      console.warn = warn;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}