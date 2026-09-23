import assert from "node:assert/strict";
import test from "node:test";

import { classifyAsset } from "./classify";

test("classifies standard media and proprietary game formats", () => {
  assert.deepEqual(
    classifyAsset({ assetPath: "DC/AVI/INTRO.AVI", extension: ".avi", contentKind: "binary" }),
    {
      category: "video",
      probableRole: "Cinepak campaign or training cutscene",
      confidence: "high",
      proprietary: false,
    },
  );

  assert.equal(
    classifyAsset({ assetPath: "DC/SPRITES/GRAY.SPR", extension: ".spr", contentKind: "binary" })
      .probableRole,
    "proprietary indexed sprite archive",
  );
  assert.equal(
    classifyAsset({ assetPath: "DC/SCENARIO/HUMAN/HUMAN01.MAP", extension: ".map", contentKind: "binary" })
      .probableRole,
    "dimensioned terrain cell records",
  );
});

test("keeps numbered mission outcome text out of the video category", () => {
  const result = classifyAsset({
    assetPath: "DC/SCENARIO/HUMAN/HUMAN01.001",
    extension: ".001",
    contentKind: "text",
  });

  assert.equal(result.category, "scenario");
  assert.equal(result.probableRole, "mission outcome narrative text");
  assert.equal(result.confidence, "high");
});

test("separates bundled runtimes and CVS metadata from game assets", () => {
  assert.equal(
    classifyAsset({ assetPath: "DIRECTX/DDRAW.DLL", extension: ".dll", contentKind: "binary" })
      .category,
    "third-party-runtime",
  );
  assert.equal(
    classifyAsset({ assetPath: "DC/SPRITES/CVS/ENTRIES", extension: null, contentKind: "text" })
      .category,
    "development-metadata",
  );
});
