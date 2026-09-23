import { lightingRow, RemapTable } from "./palette.js";

export const INDEXED_TEXTURE_LAYOUT = {
  indices: { internalFormat: "R8UI", format: "RED_INTEGER", channels: 1 },
  coverage: { internalFormat: "R8UI", format: "RED_INTEGER", channels: 1 },
  remap: { internalFormat: "R8UI", format: "RED_INTEGER", channels: 1, width: 256, height: 768 },
  palette: { internalFormat: "RGB8UI", format: "RGB_INTEGER", channels: 3, width: 256, height: 1 },
} as const;

export type PaletteLookup =
  | { bank: 0 | 2; brightness: number; selector: number }
  | { bank: 1; row: number };

export type SourceCoverage =
  | { mode: "opaque" | "source-zero" }
  | { mode: "mask"; bytes: Uint8Array };

export interface IndexedSource {
  width: number;
  height: number;
  indices: Uint8Array;
  coverage: SourceCoverage;
}

export interface IndexedUpload {
  width: number;
  height: number;
  indices: Uint8Array;
  coverage: Uint8Array;
}

export interface PaletteTables {
  remap: RemapTable;
  palette: Uint8Array;
}

export interface PaletteUpload {
  remap: Uint8Array;
  palette: Uint8Array;
}

export interface IndexedImage {
  readonly width: number;
  readonly height: number;
}

export interface IndexedLayer {
  image: IndexedImage;
  x: number;
  y: number;
  width: number;
  height: number;
  mirrorX: boolean;
  lookup: PaletteLookup;
}

function integer(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in ${minimum}..${maximum}`);
  }
}

export function resolvePaletteLookup(lookup: PaletteLookup): { bank: number; row: number } {
  if (lookup.bank === 1) {
    integer(lookup.row, 0, 255, "effect row");
    return { bank: 1, row: lookup.row };
  }
  if (lookup.bank !== 0 && lookup.bank !== 2) throw new RangeError("Unsupported RMP bank");
  return { bank: lookup.bank, row: lightingRow(lookup.brightness, lookup.selector) };
}

export function preparePaletteUpload(tables: PaletteTables): PaletteUpload {
  if (tables.palette.length !== 768) throw new RangeError("RGB8 palette must contain 768 bytes");
  return { remap: tables.remap.toTextureBytes(), palette: Uint8Array.from(tables.palette) };
}

export function prepareIndexedUpload(source: IndexedSource): IndexedUpload {
  integer(source.width, 1, 16384, "source width");
  integer(source.height, 1, 16384, "source height");
  const count = source.width * source.height;
  if (source.indices.length !== count) throw new RangeError("Index count must match source dimensions");
  let coverage: Uint8Array;
  switch (source.coverage.mode) {
    case "opaque": coverage = new Uint8Array(count).fill(255); break;
    case "source-zero": coverage = source.indices.map((index) => index === 0 ? 0 : 255); break;
    case "mask":
      if (source.coverage.bytes.length !== count) throw new RangeError("Mask count must match source dimensions");
      coverage = source.coverage.bytes.map((value) => value === 0 ? 0 : 255);
      break;
    default: throw new RangeError("Unsupported source coverage mode");
  }
  return { width: source.width, height: source.height, indices: Uint8Array.from(source.indices), coverage };
}

export function lookupIndexedPixel(
  source: IndexedUpload, tables: PaletteUpload, lookup: PaletteLookup,
  x: number, y: number, mirrorX: boolean,
): readonly [number, number, number, number] {
  integer(x, 0, source.width - 1, "source x");
  integer(y, 0, source.height - 1, "source y");
  const { bank, row } = resolvePaletteLookup(lookup);
  const offset = y * source.width + (mirrorX ? source.width - 1 - x : x);
  if (source.coverage[offset] === 0) return [0, 0, 0, 0];
  const output = tables.remap[(bank * 256 + row) * 256 + source.indices[offset]];
  const color = output * 3;
  return [tables.palette[color], tables.palette[color + 1], tables.palette[color + 2], 255];
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform ivec2 viewportSize;
uniform ivec4 destination;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 pixel = vec2(destination.xy) + corner * vec2(destination.zw);
  vec2 clip = pixel / vec2(viewportSize) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D indexTexture;
uniform highp usampler2D coverageTexture;
uniform highp usampler2D remapTexture;
uniform highp usampler2D paletteTexture;
uniform ivec2 viewportSize;
uniform ivec4 destination;
uniform ivec2 lookupAddress;
uniform bool mirrorX;
out vec4 outputColor;
void main() {
  ivec2 pixel = ivec2(int(gl_FragCoord.x), viewportSize.y - 1 - int(gl_FragCoord.y)) - destination.xy;
  ivec2 size = textureSize(indexTexture, 0);
  ivec2 source = ((2 * pixel + 1) * size) / (2 * destination.zw);
  if (mirrorX) source.x = size.x - 1 - source.x;
  if (texelFetch(coverageTexture, source, 0).r == 0u) discard;
  uint index = texelFetch(indexTexture, source, 0).r;
  uint mapped = texelFetch(remapTexture, ivec2(int(index), lookupAddress.x * 256 + lookupAddress.y), 0).r;
  uvec3 rgb = texelFetch(paletteTexture, ivec2(int(mapped), 0), 0).rgb;
  outputColor = vec4(vec3(rgb) / 255.0, 1.0);
}`;

interface ImageTextures { indices: WebGLTexture; coverage: WebGLTexture }
interface Resources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  remap: WebGLTexture;
  palette: WebGLTexture;
  uniforms: Record<string, WebGLUniformLocation>;
}

export class IndexedWebGLUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexedWebGLUnavailableError";
  }
}

export class IndexedWebGLRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #images = new Map<IndexedImage, ImageTextures>();
  #resources: Resources | null = null;
  #disposed = false;

  readonly #onLost = (event: Event): void => {
    event.preventDefault();
    this.#resources = null;
    this.#images.clear();
  };

  constructor(canvas: HTMLCanvasElement, tables: PaletteTables) {
    this.#canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new IndexedWebGLUnavailableError("WebGL2 is unavailable; owner must select a fallback canvas");
    this.#gl = gl;
    this.reinitialize(tables);
    canvas.addEventListener("webglcontextlost", this.#onLost);
  }

  get ready(): boolean {
    return !this.#disposed && this.#resources !== null && !this.#gl.isContextLost();
  }

  #requireReady(): Resources {
    if (!this.ready) throw new IndexedWebGLUnavailableError("Renderer disposed, context lost, or reinitialization required");
    return this.#resources!;
  }

  #texture(width: number, height: number, bytes: Uint8Array, palette = false): WebGLTexture {
    const gl = this.#gl;
    const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (width > maximum || height > maximum) throw new RangeError("Texture exceeds device MAX_TEXTURE_SIZE");
    const texture = gl.createTexture();
    if (!texture) throw new IndexedWebGLUnavailableError("Texture allocation failed");
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const layout = palette ? INDEXED_TEXTURE_LAYOUT.palette : INDEXED_TEXTURE_LAYOUT.indices;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl[layout.internalFormat], width, height, 0,
      gl[layout.format], gl.UNSIGNED_BYTE, bytes);
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) {
      gl.deleteTexture(texture);
      throw new IndexedWebGLUnavailableError("Indexed texture upload failed");
    }
    return texture;
  }

  reinitialize(tables: PaletteTables): void {
    const gl = this.#gl;
    if (this.#disposed || gl.isContextLost()) throw new IndexedWebGLUnavailableError("Cannot reinitialize disposed or lost context");
    const upload = preparePaletteUpload(tables);
    this.#release();
    const shaders: WebGLShader[] = [];
    const textures: WebGLTexture[] = [];
    const program = gl.createProgram();
    const vao = gl.createVertexArray();
    try {
      if (!program || !vao) throw new IndexedWebGLUnavailableError("Program allocation failed");
      for (const [type, code] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new IndexedWebGLUnavailableError("Shader allocation failed");
        shaders.push(shader);
        gl.shaderSource(shader, code);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new IndexedWebGLUnavailableError(gl.getShaderInfoLog(shader) ?? "Shader compilation failed");
        }
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new IndexedWebGLUnavailableError(gl.getProgramInfoLog(program) ?? "Program linking failed");
      }
      const uniforms: Record<string, WebGLUniformLocation> = {};
      for (const name of ["viewportSize", "destination", "lookupAddress", "mirrorX",
        "indexTexture", "coverageTexture", "remapTexture", "paletteTexture"]) {
        const location = gl.getUniformLocation(program, name);
        if (location === null) throw new IndexedWebGLUnavailableError(`Missing shader uniform ${name}`);
        uniforms[name] = location;
      }
      const remap = this.#texture(256, 768, upload.remap);
      textures.push(remap);
      const palette = this.#texture(256, 1, upload.palette, true);
      textures.push(palette);
      this.#resources = { program, vao, remap, palette, uniforms };
    } catch (error) {
      textures.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteVertexArray(vao);
      throw error;
    } finally {
      for (const shader of shaders) {
        if (program && this.#resources?.program === program) gl.detachShader(program, shader);
        gl.deleteShader(shader);
      }
      if (this.#resources?.program !== program) gl.deleteProgram(program);
    }
  }

  upload(source: IndexedSource): IndexedImage {
    this.#requireReady();
    const upload = prepareIndexedUpload(source);
    const indices = this.#texture(upload.width, upload.height, upload.indices);
    try {
      const coverage = this.#texture(upload.width, upload.height, upload.coverage);
      const image = Object.freeze({ width: upload.width, height: upload.height });
      this.#images.set(image, { indices, coverage });
      return image;
    } catch (error) {
      this.#gl.deleteTexture(indices);
      throw error;
    }
  }

  releaseImage(image: IndexedImage): void {
    const textures = this.#images.get(image);
    if (!textures) return;
    this.#gl.deleteTexture(textures.indices);
    this.#gl.deleteTexture(textures.coverage);
    this.#images.delete(image);
  }

  render(layers: readonly IndexedLayer[]): void {
    const resources = this.#requireReady();
    const gl = this.#gl;
    integer(gl.drawingBufferWidth, 1, 16384, "canvas width");
    integer(gl.drawingBufferHeight, 1, 16384, "canvas height");
    const draws = layers.map((layer) => {
      const textures = this.#images.get(layer.image);
      if (!textures) throw new RangeError("Image is foreign, released, or invalidated by reinitialization");
      integer(layer.x, -16384, 16384, "destination x");
      integer(layer.y, -16384, 16384, "destination y");
      integer(layer.width, 1, 16384, "destination width");
      integer(layer.height, 1, 16384, "destination height");
      if (typeof layer.mirrorX !== "boolean") throw new TypeError("mirrorX must be explicitly supplied");
      return { layer, textures, lookup: resolvePaletteLookup(layer.lookup) };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    for (const capability of [gl.BLEND, gl.DITHER, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.RASTERIZER_DISCARD]) {
      gl.disable(capability);
    }
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(resources.program);
    gl.bindVertexArray(resources.vao);
    const uniforms = resources.uniforms;
    gl.uniform2i(uniforms.viewportSize, gl.drawingBufferWidth, gl.drawingBufferHeight);
    for (const { layer, textures, lookup } of draws) {
      const bindings = [textures.indices, textures.coverage, resources.remap, resources.palette];
      const names = ["indexTexture", "coverageTexture", "remapTexture", "paletteTexture"];
      bindings.forEach((texture, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindSampler(unit, null);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniforms[names[unit]], unit);
      });
      gl.uniform4i(uniforms.destination, layer.x, layer.y, layer.width, layer.height);
      gl.uniform2i(uniforms.lookupAddress, lookup.bank, lookup.row);
      gl.uniform1i(uniforms.mirrorX, Number(layer.mirrorX));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) {
      throw new IndexedWebGLUnavailableError("Indexed draw failed; owner must select a fallback");
    }
  }

  #release(): void {
    for (const image of this.#images.keys()) this.releaseImage(image);
    if (this.#resources) {
      this.#gl.deleteTexture(this.#resources.remap);
      this.#gl.deleteTexture(this.#resources.palette);
      this.#gl.deleteVertexArray(this.#resources.vao);
      this.#gl.deleteProgram(this.#resources.program);
      this.#resources = null;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#canvas.removeEventListener("webglcontextlost", this.#onLost);
    this.#release();
    this.#disposed = true;
  }
}