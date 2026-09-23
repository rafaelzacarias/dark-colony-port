# Phase 2 extractors

Implemented decoders:

- `sprites/`: all 284 SPR archives, raw and signed-control compressed variants,
  deterministic RGBA PNG atlases, and frame JSON;
- `animations/`: 164 standard FIN files, including named states, timelines,
  events, and child sprite placements.
- `maps/`: all four keyed BTS tile banks and all 108 MAP/MTG/PTH bundles,
  preserving unknown layers as typed binary data.
- `media/`: deterministic Ogg Opus audio plus VP9/Opus WebM and H.264/AAC MP4
    video fallbacks.
- `disc/`: Alcohol MDS geometry parsing and subchannel-free Red Book CDDA
    extraction.

The 11 compact lighting FIN variants are indexed as unsupported. Two corrupt or
debug FIN files are indexed as invalid rather than silently dropped.

Each Phase 2 decoder belongs in its own directory with:

- a documented binary layout and versioned JSON output schema;
- strict bounds checks and actionable errors;
- a minimal legally redistributable synthetic fixture;
- a golden-output test;
- deterministic output with no timestamps or host paths.

Decoders read user-owned files under `raw_cd/` and emit browser-ready content
only under `public/assets/generated/`.
