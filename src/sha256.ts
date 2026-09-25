import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest === "function") {
    return bytesToHex(new Uint8Array(await subtle.digest("SHA-256", Uint8Array.from(bytes).buffer)));
  }
  // Web Crypto is unavailable on plain HTTP LAN origins used by phones.
  return bytesToHex(sha256(bytes));
}
