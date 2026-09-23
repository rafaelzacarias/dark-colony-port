export function assetUrl(path: string, base = (import.meta as ImportMeta & {
  readonly env?: { readonly BASE_URL?: string };
}).env?.BASE_URL ?? "/"): string {
  if (!path.startsWith("/assets/")) throw new TypeError("Expected an application asset path");
  return `${base.replace(/\/$/, "")}${path}`;
}