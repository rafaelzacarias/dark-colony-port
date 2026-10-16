import {
  parseSoundBindings,
  resolveAudioCandidates,
  type CueCatalog,
  type LegacySound,
  type MediaAudioIndex,
} from "./cues";
import { legacyCueCatalog } from "./legacy-cues";

export type AmbientBiomeProfile = "desert" | "jungle" | "atlantis";

export type LegacyCueCatalog = typeof legacyCueCatalog | CueCatalog | Pick<CueCatalog, "sounds">;

export interface AmbientRecord {
  readonly tod: 0 | 1;
  readonly btype: number;
  readonly soundIds: number[];
  readonly comment?: string;
}

export interface AmbientSourceDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface AmbientAudioData {
  readonly schemaVersion: 1;
  readonly sources: {
    readonly desert: AmbientSourceDigest;
    readonly jungle: AmbientSourceDigest;
    readonly atlantis: AmbientSourceDigest;
    readonly slist: AmbientSourceDigest;
  };
  readonly slistBindings: Readonly<Record<string, readonly number[]>>;
  readonly profiles: Readonly<Record<AmbientBiomeProfile, readonly AmbientRecord[]>>;
}

export interface ResolvedAmbientSoundCue {
  readonly soundId: number;
  readonly assetId: string;
  readonly source: string;
  readonly parameters: readonly number[];
  readonly sound: LegacySound;
  readonly candidates: readonly string[];
  readonly urls: readonly string[];
  readonly url: string;
  readonly priority: number;
}

export interface AmbientScheduleInput {
  readonly profile: AmbientBiomeProfile;
  readonly tick: number;
  readonly daylightPermille: number;
  readonly btypes?: readonly number[];
}

export interface ScheduledAmbientCue extends ResolvedAmbientSoundCue {
  readonly profile: AmbientBiomeProfile;
  readonly tick: number;
  readonly tod: 0 | 1;
  readonly daylightPermille: number;
  readonly btype: number;
  readonly comment?: string;
  readonly bindingSource: "amb" | "slist";
  readonly slistId?: 98 | 99;
}

export interface AmbientAudioSchedulerOptions {
  readonly intervalTicks?: number;
  readonly tickInterval?: number;
  readonly interval?: number;
  readonly data?: AmbientAudioData;
  readonly catalog?: LegacyCueCatalog;
  readonly mediaIndex?: MediaAudioIndex;
  readonly baseUrl?: string;
}

export const defaultAmbientMediaIndex: MediaAudioIndex = {
  entries: [
    {
      kind: "audio",
      source: "SOUND/A51.WAV",
      outputs: [
        { path: "audio/SOUND/A51.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/796b9d473c48ad3c0f13a6c274f9e1dbae8ff80e7b02ab801c91a05fe3aa6af4.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/BATWEA.WAV",
      outputs: [
        { path: "audio/SOUND/BATWEA.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/5a60c6b02aca566f5b608b1ba73b29119275fdf5e4910726a9af26a35e2aa1b9.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/BATWEA1.WAV",
      outputs: [
        { path: "audio/SOUND/BATWEA1.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/a7cfa6ca7222a8cce23bbb80b6378b7ea765061ac297d37c94b0ddd9db6362ac.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/BIRDCALL.WAV",
      outputs: [
        { path: "audio/SOUND/BIRDCALL.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/3975f9fd1b29b1040e5ce7a5a62bfbe7cb1ba53bf1a48f2f3a2a2b237007f2bd.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/BRTHWTR.WAV",
      outputs: [
        { path: "audio/SOUND/BRTHWTR.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/5c0bdcdbe7e011a9f093289a47177c045bdf9dc34369aa980ef37eec0bf46fe6.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/BUG.WAV",
      outputs: [
        { path: "audio/SOUND/BUG.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/f592fcd915c9dff002a6bd7c0705f8f05a6029c88a1ba034a123151d8f98bc08.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/CHIGGERS.WAV",
      outputs: [
        { path: "audio/SOUND/CHIGGERS.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/3c434f53809c768cb5d6c0b1bd1aa36f46b2f8c1baaaa59a697f1161fd43f5e2.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/CLICK.WAV",
      outputs: [
        { path: "audio/SOUND/CLICK.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/6bb0db9dd62015c9f0ef823e8b3da3a3ef13c7ae0696d58d21852a066a6b9bd9.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/CREEP.WAV",
      outputs: [
        { path: "audio/SOUND/CREEP.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/4ac0f0233947f8fc32ca6e75c8d491ae7a6fcbd0b9eeacd077bfda8fa339fe90.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/DAYCHIRP.WAV",
      outputs: [
        { path: "audio/SOUND/DAYCHIRP.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/f1d3af94fe2de4f0a44d17f1b9bd646215b8f707338aa26e8e3a722483081858.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/DCHIRP2.WAV",
      outputs: [
        { path: "audio/SOUND/DCHIRP2.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/aeada8885749c7322adf6d9f8248858d2d44b887c25ca631bf5bcfc05e0bb00c.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/DCHIRP3.WAV",
      outputs: [
        { path: "audio/SOUND/DCHIRP3.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/86956bf7c8039e47d8cb5c96d45896e11c05c15a6967e6c9cd68f326a7cf054c.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/DRAIN.WAV",
      outputs: [
        { path: "audio/SOUND/DRAIN.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/5c444dd93652673ef15a7c25c1f02a9074a6918d2d9d5cc8ca86da23d9f3c4de.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/GC2NDFI.WAV",
      outputs: [
        { path: "audio/SOUND/GC2NDFI.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/22e634f9a6f82eeecefd3f03d1d860c2df2a96aad3871ed9dd67c11e9d76b2d4.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/MONK.WAV",
      outputs: [
        { path: "audio/SOUND/MONK.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/532298343b435e524095d6ac29c0295c937ac4274e278560cc540c77a9f11b40.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/NIGHTBUG.WAV",
      outputs: [
        { path: "audio/SOUND/NIGHTBUG.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/940c73e01ba51df347f6909fdbb89ae16b302d79ba5b0f24da4f4caaa0060e40.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/OWL.WAV",
      outputs: [
        { path: "audio/SOUND/OWL.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/6f36489fc82df24a969869ea3a1d2194cd6e8f3a2b4cc4244b0d2f94436622f7.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/PIPSTEAM.WAV",
      outputs: [
        { path: "audio/SOUND/PIPSTEAM.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/8dfd42b4504950e84f1dafe188ed8ff6a33fb5e50b5fa4dc4f2cd2e580dc8d07.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/RNATWEA1.WAV",
      outputs: [
        { path: "audio/SOUND/RNATWEA1.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/e6886e0dfb625d4bf0a6eb3b509ce8014213d5a7d492535c6531b93acb5457ae.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/ROCK.WAV",
      outputs: [
        { path: "audio/SOUND/ROCK.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/9bf04887f1149e513d26793dcba17616e61b27341e2dd1bfcd37cf0842c5f9b2.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/SALWEA.WAV",
      outputs: [
        { path: "audio/SOUND/SALWEA.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/98404243961bef496688da7449fa0be1b009c490f9992e84205041376af33e8d.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/SALWEA1.WAV",
      outputs: [
        { path: "audio/SOUND/SALWEA1.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/a0287726574e4a7fbe307ae5f86a5cabca85c6cb34852873542e7baed9e74215.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/SPIDWEA.WAV",
      outputs: [
        { path: "audio/SOUND/SPIDWEA.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/4511e38b25cccf3a9e387f053d1c3c9052f69d8768df19d92a0a8a7310e4637d.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/SPIDWEA1.WAV",
      outputs: [
        { path: "audio/SOUND/SPIDWEA1.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/87579733cf74051f3e26a16e3073d77aacbc07865d7debcbd23ce15939bc7cde.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/WATER.WAV",
      outputs: [
        { path: "audio/SOUND/WATER.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/cb9c516aa5e9d0695ac9010f2f52e19bfef39a2a7571cce86fa0188c610b773c.wav", mimeType: "audio/wav" },
      ],
    },
    {
      kind: "audio",
      source: "SOUND/WHALE.WAV",
      outputs: [
        { path: "audio/SOUND/WHALE.ogg", mimeType: "audio/ogg" },
        { path: "effect-pcm/f06837b8ad0687bacb916a53c94305f813edf41851f5f874735649c5914244f9.wav", mimeType: "audio/wav" },
      ],
    },
  ],
};

export const ambientAudioData: AmbientAudioData = {
  schemaVersion: 1,
  sources: {
    desert: {
      path: "raw_cd/DC/SOUND/DESERT.AMB",
      sha256: "d843e85db42c8a1dfbb413aafe49e762d76dacef56d5a85afd0ca9dfabc64462",
    },
    jungle: {
      path: "raw_cd/DC/SOUND/JUNGLE.AMB",
      sha256: "6a8a29bbfb46a936dcd040297e0a0d603c7729db41a7983e4385a79b9f33f62f",
    },
    atlantis: {
      path: "raw_cd/DC/SOUND/ATLANTIS.AMB",
      sha256: "6627ff056bc827ed25018363d985380e4b5ce44852e8aac4bcb7840f72472c4c",
    },
    slist: {
      path: "raw_cd/DC/SOUND/SLIST.DAT",
      sha256: "8edca1e2e26e741a8d73a4e7987d51569d62a75d90038e59e19b155d240ec0cc",
    },
  },
  slistBindings: {
    "98": [60, 58, 59, 57],
    "99": [57, 58, 59],
  },
  profiles: {
    desert: [
      { tod: 0, btype: 3, soundIds: [20, 23, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 13, soundIds: [20, 23, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 14, soundIds: [20, 23, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 15, soundIds: [20, 23, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 16, soundIds: [20, 23, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 17, soundIds: [20, 23, 61, 61], comment: "%day water sounds" },
      { tod: 1, btype: 3, soundIds: [19, 170, 60, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 13, soundIds: [19, 170, 60, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 14, soundIds: [19, 170, 60, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 15, soundIds: [19, 170, 60, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 16, soundIds: [19, 170, 60, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 17, soundIds: [19, 170, 60, 61, 61, 61], comment: "%night water" },
      { tod: 0, btype: 7, soundIds: [58, 59, 57], comment: "%day buildings" },
      { tod: 1, btype: 7, soundIds: [58, 59, 57], comment: "%night buildings" },
      { tod: 0, btype: 1, soundIds: [20, 23, 25, 170], comment: "%day land" },
      { tod: 0, btype: 10, soundIds: [20, 23, 25, 170], comment: "%day land" },
      { tod: 0, btype: 11, soundIds: [20, 23, 25, 170], comment: "%day land" },
      { tod: 0, btype: 12, soundIds: [20, 23, 25, 170], comment: "%day land" },
      { tod: 0, btype: 18, soundIds: [20, 23, 25, 170], comment: "%day land" },
      { tod: 0, btype: 19, soundIds: [20, 23, 25, 170], comment: "%day land" },
      { tod: 0, btype: 20, soundIds: [20, 23, 25, 170], comment: "%day land" },
      { tod: 1, btype: 1, soundIds: [19, 60, 60, 60, 60, 60, 60], comment: "%night land" },
      { tod: 1, btype: 10, soundIds: [19, 60, 60, 60, 60, 60, 60], comment: "%night land" },
      { tod: 1, btype: 11, soundIds: [19, 60, 60, 60, 60, 60, 60], comment: "%night land" },
      { tod: 1, btype: 12, soundIds: [19, 60, 60, 60, 60, 60, 60], comment: "%night land" },
      { tod: 1, btype: 18, soundIds: [19, 60, 60, 60, 60, 60, 60], comment: "%night land" },
      { tod: 1, btype: 19, soundIds: [19, 60, 60, 60, 60, 60, 60], comment: "%night land" },
      { tod: 1, btype: 20, soundIds: [19, 60, 60, 60, 60, 60, 60], comment: "%night land" },
      { tod: 0, btype: 21, soundIds: [20, 171, 172], comment: "%day spider" },
      { tod: 0, btype: 22, soundIds: [20, 171, 172], comment: "%day spider" },
      { tod: 0, btype: 23, soundIds: [20, 171, 172], comment: "%day spider" },
      { tod: 1, btype: 21, soundIds: [60, 171, 172], comment: "%day spider" },
      { tod: 1, btype: 22, soundIds: [60, 171, 172], comment: "%day spider" },
      { tod: 1, btype: 23, soundIds: [60, 171, 172], comment: "%day spider" },
    ],
    jungle: [
      { tod: 0, btype: 3, soundIds: [26, 25, 23, 61, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 13, soundIds: [26, 25, 23, 61, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 14, soundIds: [26, 25, 23, 61, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 15, soundIds: [26, 25, 23, 61, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 16, soundIds: [26, 25, 23, 61, 61, 61], comment: "%day water sounds" },
      { tod: 0, btype: 17, soundIds: [26, 25, 23, 61, 61, 61], comment: "%day water sounds" },
      { tod: 1, btype: 3, soundIds: [178, 179, 180, 60, 61, 61, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 13, soundIds: [178, 179, 180, 60, 61, 61, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 14, soundIds: [178, 179, 180, 60, 61, 61, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 15, soundIds: [178, 179, 180, 60, 61, 61, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 16, soundIds: [178, 179, 180, 60, 61, 61, 61, 61, 61], comment: "%night water" },
      { tod: 1, btype: 17, soundIds: [178, 179, 180, 60, 61, 61, 61, 61, 61], comment: "%night water" },
      { tod: 0, btype: 7, soundIds: [58, 59, 57], comment: "%day buildings" },
      { tod: 1, btype: 7, soundIds: [58, 59, 57], comment: "%night buildings" },
      { tod: 0, btype: 1, soundIds: [26, 181, 23, 25, 178], comment: "%day land" },
      { tod: 0, btype: 10, soundIds: [26, 181, 23, 25, 178], comment: "%day land" },
      { tod: 0, btype: 11, soundIds: [26, 181, 23, 25, 178], comment: "%day land" },
      { tod: 0, btype: 12, soundIds: [26, 181, 23, 25, 178], comment: "%day land" },
      { tod: 0, btype: 18, soundIds: [26, 181, 23, 25, 178], comment: "%day land" },
      { tod: 0, btype: 19, soundIds: [26, 181, 23, 25, 178], comment: "%day land" },
      { tod: 0, btype: 20, soundIds: [26, 181, 23, 25, 178], comment: "%day land" },
      { tod: 1, btype: 1, soundIds: [180, 60, 181], comment: "%night land" },
      { tod: 1, btype: 10, soundIds: [180, 60, 181], comment: "%night land" },
      { tod: 1, btype: 11, soundIds: [180, 60, 181], comment: "%night land" },
      { tod: 1, btype: 12, soundIds: [180, 60, 181], comment: "%night land" },
      { tod: 1, btype: 18, soundIds: [180, 60, 181], comment: "%night land" },
      { tod: 1, btype: 19, soundIds: [180, 60, 181], comment: "%night land" },
      { tod: 1, btype: 20, soundIds: [180, 60, 181], comment: "%night land" },
      { tod: 0, btype: 21, soundIds: [26, 181, 23, 25, 178, 179, 178, 179], comment: "%day spider" },
      { tod: 0, btype: 22, soundIds: [26, 181, 23, 25, 178, 179, 178, 179], comment: "%day spider" },
      { tod: 0, btype: 23, soundIds: [26, 181, 23, 25, 178, 179, 178, 179], comment: "%day spider" },
      { tod: 1, btype: 21, soundIds: [180, 60, 181, 178, 179, 178, 179], comment: "%night spider" },
      { tod: 1, btype: 22, soundIds: [180, 60, 181, 178, 179, 178, 179], comment: "%night spider" },
      { tod: 1, btype: 23, soundIds: [180, 60, 181, 178, 179, 178, 179], comment: "%night spider" },
    ],
    atlantis: [
      { tod: 0, btype: 1, soundIds: [77, 41, 39, 77, 76, 76, 76], comment: "%day crypt" },
      { tod: 0, btype: 3, soundIds: [77, 41, 39, 77, 76, 76, 76], comment: "%day crypt" },
      { tod: 0, btype: 18, soundIds: [77, 41, 39, 77, 76, 76, 76], comment: "%day crypt" },
      { tod: 0, btype: 19, soundIds: [77, 41, 39, 77, 76, 76, 76], comment: "%day crypt" },
      { tod: 0, btype: 20, soundIds: [77, 41, 39, 77, 76, 76, 76], comment: "%day crypt" },
      { tod: 0, btype: 21, soundIds: [77, 41, 39, 77, 76, 76, 76], comment: "%day crypt" },
      { tod: 0, btype: 7, soundIds: [77, 133, 41, 77, 76, 27, 31], comment: "%day walls" },
      { tod: 0, btype: 10, soundIds: [77, 133, 41, 77, 76, 27, 31], comment: "%day walls" },
      { tod: 0, btype: 11, soundIds: [77, 133, 41, 77, 76, 27, 31], comment: "%day walls" },
      { tod: 0, btype: 12, soundIds: [77, 133, 41, 77, 76, 27, 31], comment: "%day walls" },
      { tod: 0, btype: 13, soundIds: [77, 133, 41, 77, 76, 27, 31], comment: "%day walls" },
      { tod: 0, btype: 17, soundIds: [77, 133, 41, 77, 76, 27, 31], comment: "%day walls" },
      { tod: 0, btype: 15, soundIds: [77, 133, 41, 77, 76, 27, 31], comment: "%day ground prob most popular" },
      { tod: 0, btype: 14, soundIds: [77, 133, 41, 77, 62, 62, 133, 133], comment: "%day Secret" },
      { tod: 0, btype: 16, soundIds: [77, 133, 41, 77], comment: "%day final" },
    ],
  },
};

export function parseAmbientFile(raw: string): AmbientRecord[] {
  const records: AmbientRecord[] = [];
  let currentComment: string | undefined;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("%")) {
      if (!/^%\s*tod\s+btype\b/i.test(line)) {
        currentComment = line;
      }
      continue;
    }
    if (!/^-?\d+(?:\s+-?\d+)*$/.test(line)) {
      throw new Error(`Invalid AMB row: ${line}`);
    }
    const values = line.split(/\s+/).map(Number);
    const [tod, btype, ...rest] = values;
    if (tod !== 0 && tod !== 1) {
      throw new Error(`Invalid AMB tod: ${line}`);
    }
    if (!Number.isSafeInteger(btype) || btype < 0) {
      throw new Error(`Invalid AMB btype: ${line}`);
    }
    const end = rest.indexOf(-1);
    if (end < 1 || rest.slice(0, end).some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`Invalid AMB terminator: ${line}`);
    }
    const soundIds = rest.slice(0, end);
    records.push(
      currentComment !== undefined
        ? { tod, btype, soundIds, comment: currentComment }
        : { tod, btype, soundIds },
    );
  }
  return records;
}

export function parseSlistAmbientBindings(raw: string): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const binding of parseSoundBindings(raw)) {
    if (binding.group === "AMB") {
      result[String(binding.id)] = [...binding.soundIds];
    }
  }
  return result;
}

function isMediaAudioIndex(value: unknown): value is MediaAudioIndex {
  return typeof value === "object" && value !== null && "entries" in value && !("sounds" in value);
}

export function resolveAmbientSoundCue(
  soundId: number,
  catalogOrMediaIndex?: LegacyCueCatalog | MediaAudioIndex,
  mediaIndex: MediaAudioIndex = defaultAmbientMediaIndex,
  baseUrl?: string,
): ResolvedAmbientSoundCue | undefined {
  if (!Number.isSafeInteger(soundId) || soundId < 0) return undefined;
  const catalog: LegacyCueCatalog = isMediaAudioIndex(catalogOrMediaIndex)
    ? legacyCueCatalog
    : (catalogOrMediaIndex ?? legacyCueCatalog);
  const resolvedMediaIndex: MediaAudioIndex = isMediaAudioIndex(catalogOrMediaIndex)
    ? catalogOrMediaIndex
    : mediaIndex;
  const sound = catalog.sounds.find((candidate) => candidate.id === soundId);
  if (!sound) return undefined;
  const candidates = resolveAudioCandidates(resolvedMediaIndex, sound.source, baseUrl);
  if (!candidates.length) return undefined;
  return {
    soundId: sound.id,
    assetId: sound.source,
    source: sound.source,
    parameters: [...sound.parameters],
    sound: { id: sound.id, source: sound.source, parameters: [...sound.parameters] },
    candidates,
    urls: candidates,
    url: candidates[0],
    priority: 20,
  };
}

interface CandidateAmbientBinding {
  readonly tod: 0 | 1;
  readonly btype: number;
  readonly soundIds: readonly number[];
  readonly comment?: string;
  readonly bindingSource: "amb" | "slist";
  readonly slistId?: 98 | 99;
}

export class AmbientAudioScheduler {
  readonly intervalTicks: number;
  readonly #data: AmbientAudioData;
  readonly #catalog: LegacyCueCatalog;
  readonly #mediaIndex: MediaAudioIndex;
  readonly #baseUrl: string | undefined;
  #lastEmittedTick: number | undefined;
  #lastProfile: AmbientBiomeProfile | undefined;
  #lastTod: (0 | 1) | undefined;
  readonly #counters = new Map<string, number>();

  constructor(optionsOrInterval: AmbientAudioSchedulerOptions | number = {}) {
    const options: AmbientAudioSchedulerOptions =
      typeof optionsOrInterval === "number" ? { intervalTicks: optionsOrInterval } : optionsOrInterval;
    const rawInterval = options.intervalTicks ?? options.tickInterval ?? options.interval ?? 60;
    if (!Number.isSafeInteger(rawInterval) || rawInterval < 1) {
      throw new RangeError("Ambient tick interval must be a positive safe integer");
    }
    this.intervalTicks = rawInterval;
    this.#data = options.data ?? ambientAudioData;
    this.#catalog = options.catalog ?? legacyCueCatalog;
    this.#mediaIndex = options.mediaIndex ?? defaultAmbientMediaIndex;
    this.#baseUrl = options.baseUrl;
  }

  #selectCandidates(
    profile: AmbientBiomeProfile,
    tod: 0 | 1,
    btypes?: readonly number[],
  ): readonly CandidateAmbientBinding[] {
    const profileRecords = this.#data.profiles[profile];
    if (!profileRecords) return [];
    const todRecords = profileRecords.filter((record) => record.tod === tod);
    const requestedBtypes = btypes?.filter((btype) => Number.isSafeInteger(btype) && btype >= 0) ?? [];

    if (requestedBtypes.length > 0) {
      const matched: CandidateAmbientBinding[] = [];
      for (const btype of requestedBtypes) {
        for (const record of todRecords) {
          if (record.btype === btype && record.soundIds.length > 0) {
            matched.push({
              tod,
              btype: record.btype,
              soundIds: record.soundIds,
              comment: record.comment,
              bindingSource: "amb",
            });
          }
        }
        if (btype === 98 || btype === 99) {
          const slistSounds = this.#data.slistBindings[String(btype)];
          if (slistSounds?.length) {
            matched.push({
              tod,
              btype,
              soundIds: slistSounds,
              comment: `%slist AMB ${btype}`,
              bindingSource: "slist",
              slistId: btype,
            });
          }
        }
      }
      if (matched.length > 0) return matched;
    } else if (todRecords.length > 0) {
      return todRecords
        .filter((record) => record.soundIds.length > 0)
        .map((record) => ({
          tod,
          btype: record.btype,
          soundIds: record.soundIds,
          comment: record.comment,
          bindingSource: "amb" as const,
        }));
    }

    // Fallback to SLIST AMB carrier bindings (99 for day, 98 for night) when a profile/btype has no direct AMB rows for `tod` (e.g., Atlantis at night).
    const slistId: 98 | 99 = tod === 1 ? 98 : 99;
    const slistSounds = this.#data.slistBindings[String(slistId)] ?? this.#data.slistBindings["98"];
    if (!slistSounds?.length) return [];
    return [
      {
        tod,
        btype: slistId,
        soundIds: slistSounds,
        comment: `%slist AMB ${slistId}`,
        bindingSource: "slist",
        slistId,
      },
    ];
  }

  step(input: AmbientScheduleInput): ScheduledAmbientCue | undefined {
    const { profile, tick, daylightPermille, btypes } = input;
    if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isFinite(daylightPermille)) {
      return undefined;
    }
    const tod: 0 | 1 = daylightPermille >= 500 ? 0 : 1;
    const contextChanged = this.#lastProfile !== undefined && (this.#lastProfile !== profile || this.#lastTod !== tod);

    if (
      this.#lastEmittedTick !== undefined &&
      tick >= this.#lastEmittedTick &&
      !contextChanged &&
      tick - this.#lastEmittedTick < this.intervalTicks
    ) {
      return undefined;
    }

    const candidates = this.#selectCandidates(profile, tod, btypes);
    if (!candidates.length) return undefined;

    const counterKey = `${profile}:${tod}`;
    const stepIndex = this.#counters.get(counterKey) ?? 0;
    this.#counters.set(counterKey, stepIndex + 1);

    const chosenBinding = candidates[stepIndex % candidates.length];
    const soundId = chosenBinding.soundIds[stepIndex % chosenBinding.soundIds.length];
    const resolved = resolveAmbientSoundCue(soundId, this.#catalog, this.#mediaIndex, this.#baseUrl);
    if (!resolved) return undefined;

    this.#lastEmittedTick = tick;
    this.#lastProfile = profile;
    this.#lastTod = tod;

    return {
      ...resolved,
      profile,
      tick,
      tod,
      daylightPermille,
      btype: chosenBinding.btype,
      ...(chosenBinding.comment !== undefined ? { comment: chosenBinding.comment } : {}),
      bindingSource: chosenBinding.bindingSource,
      ...(chosenBinding.slistId !== undefined ? { slistId: chosenBinding.slistId } : {}),
    };
  }

  update(input: AmbientScheduleInput): ScheduledAmbientCue | undefined {
    return this.step(input);
  }

  schedule(input: AmbientScheduleInput): ScheduledAmbientCue | undefined {
    return this.step(input);
  }

  reset(): void {
    this.#lastEmittedTick = undefined;
    this.#lastProfile = undefined;
    this.#lastTod = undefined;
    this.#counters.clear();
  }
}
