const TRACK_UID = Buffer.from([0x73, 0xc5, 0x88]);
const TAG_TRACK_UID = Buffer.from([0x63, 0xc5, 0x88]);
const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

export class WebmFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebmFormatError";
  }
}

export function canonicalizeWebm(source: Uint8Array, identity: Uint8Array): Buffer {
  const output = Buffer.from(source);
  const identityBytes = Buffer.from(identity.buffer, identity.byteOffset, identity.byteLength);
  const clusterOffset = output.indexOf(CLUSTER);
  if (clusterOffset < 0) throw new WebmFormatError("WebM cluster element was not found");

  const tracks: { original: Buffer; replacement: Buffer }[] = [];
  let searchOffset = 0;
  while (searchOffset < clusterOffset) {
    const offset = output.indexOf(TRACK_UID, searchOffset);
    if (offset < 0 || offset >= clusterOffset) break;
    if (offset + 11 > output.length) throw new WebmFormatError("truncated WebM TrackUID");
    const original = Buffer.from(output.subarray(offset + 3, offset + 11));
    const replacementOffset = tracks.length * 8;
    if (replacementOffset + 8 > identityBytes.length) {
      throw new WebmFormatError("identity digest is too short for WebM tracks");
    }
    const replacement = Buffer.from(identityBytes.subarray(replacementOffset, replacementOffset + 8));
    replacement.copy(output, offset + 3);
    tracks.push({ original, replacement });
    searchOffset = offset + 11;
  }
  if (tracks.length === 0) throw new WebmFormatError("WebM contains no TrackUID elements");

  searchOffset = 0;
  while (searchOffset < output.length) {
    const offset = output.indexOf(TAG_TRACK_UID, searchOffset);
    if (offset < 0) break;
    if (offset + 11 > output.length) throw new WebmFormatError("truncated WebM TagTrackUID");
    const value = output.subarray(offset + 3, offset + 11);
    const track = tracks.find(({ original }) => value.equals(original));
    if (track) track.replacement.copy(output, offset + 3);
    searchOffset = offset + 11;
  }
  return output;
}
