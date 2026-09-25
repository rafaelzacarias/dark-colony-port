import { assetUrl } from "../asset-url";

// Button geometry and MAINBUT frames from raw INTRFACE/MAINE; keyed by the MAINE id that DEPEND.TXT stores as interfaceId.
export const MAINE_MENU_BUTTONS: Readonly<Record<number, readonly [x: number, y: number, frame: number, text: string]>> = {
  206: [577, 194, 129, "Exo-Ctr   2000"],
  80: [577, 235, 20, "Barracks  1000"],
  81: [577, 276, 21, "Sci-Pod   2000"],
  82: [577, 317, 22, "Robo-Ftr  2000"],
  83: [577, 358, 23, "Rsch-Bay  3000"],
  85: [577, 276, 26, "Sci-Pod + 2000"],
  86: [577, 317, 30, "Robo-Ftr+ 2000"],
  87: [518, 112, 8, "Exploiter 1500"],
  88: [518, 317, 10, "Firestorm  900"],
  89: [518, 153, 6, "Trooper    350"],
  90: [518, 194, 5, "Sentinel   450"],
  91: [518, 276, 11, "Reaper     600"],
  92: [518, 235, 9, "Osprey IV  600"],
  93: [518, 358, 7, "Barrager  1000"],
  94: [577, 112, 12, "S.A.R.G.E 1500"],
  135: [577, 153, 29, "Medi-craft 900"],
  205: [577, 194, 130, "Mind-Hive 2000"],
  41: [577, 235, 24, "War. Fold  1000"],
  42: [577, 276, 114, "Breed-Pod  2000"],
  43: [577, 317, 25, "Gene-Sac   2000"],
  44: [577, 358, 46, "Neur-Hive  3000"],
  97: [577, 276, 115, "Pod-Upgrd  2000"],
  98: [577, 317, 39, "Gene-Upgrd 2000"],
  46: [518, 112, 15, "Brozaar    1500"],
  47: [518, 317, 17, "Xenowort    900"],
  48: [518, 153, 13, "Gray        350"],
  49: [518, 235, 16, "Ortu        600"],
  50: [518, 276, 18, "Sy-Demon    600"],
  51: [518, 358, 14, "Atril      1000"],
  52: [577, 112, 19, "Gorrem     1500"],
  71: [518, 194, 116, "Slom        450"],
  134: [577, 153, 36, "Zisp       900"],
  110: [518, 112, 47, "Weapon +1 1000"],
  111: [518, 112, 27, "Weapon +2 2000"],
  112: [577, 112, 48, "Armor  +1 1000"],
  113: [577, 112, 90, "Armor  +2 2000"],
  114: [518, 194, 80, "Weapon +1 1000"],
  115: [518, 194, 31, "Weapon +2 2000"],
  116: [577, 194, 51, "Armor  +1 1000"],
  117: [577, 194, 93, "Armor  +2 2000"],
  118: [518, 153, 82, "Weapon +1 1000"],
  119: [518, 153, 33, "Weapon +2 2000"],
  120: [577, 153, 53, "Armor  +1 1000"],
  121: [577, 153, 95, "Armor  +2 2000"],
  122: [518, 235, 81, "Weapon +1 1000"],
  123: [518, 235, 32, "Weapon +2 2000"],
  124: [577, 235, 52, "Armor  +1 1000"],
  125: [577, 235, 94, "Armor  +2 2000"],
  126: [518, 276, 64, "Weapon +1 1000"],
  127: [518, 276, 28, "Weapon +2 2000"],
  128: [577, 276, 49, "Armor  +1 1000"],
  129: [577, 276, 91, "Armor  +2 2000"],
  130: [518, 317, 83, "Weapon +1 1000"],
  131: [518, 317, 35, "Napalm    2000"],
  132: [577, 317, 54, "Armor  +1 1000"],
  133: [577, 317, 96, "Armor  +2 2000"],
  55: [518, 235, 87, "Weapon +1  1000"],
  56: [518, 112, 84, "Weapon +1  1000"],
  57: [518, 194, 86, "Weapon +1  1000"],
  58: [518, 153, 88, "Weapon +1  1000"],
  59: [518, 276, 85, "Weapon +1  1000"],
  60: [518, 317, 89, "Psych +    1000"],
  66: [577, 235, 59, "Armor  +1  1000"],
  67: [577, 235, 101, "Armor  +2  2000"],
  68: [577, 112, 97, "Armor  +2  2000"],
  69: [577, 194, 58, "Armor  +1  1000"],
  72: [577, 153, 60, "Armor  +1  1000"],
  73: [577, 276, 56, "Armor  +1  1000"],
  74: [577, 317, 61, "Armor  +1  1000"],
  77: [518, 235, 42, "Weapon +2  2000"],
  78: [518, 316, 45, "Virus Sac  2000"],
  99: [577, 112, 55, "Armor  +1  1000"],
  100: [518, 112, 37, "Weapon +2  2000"],
  101: [518, 194, 41, "Weapon +2  2000"],
  102: [577, 194, 100, "Armor  +2  2000"],
  103: [518, 153, 43, "Weapon +2  2000"],
  104: [577, 153, 102, "Armor  +2  2000"],
  105: [518, 276, 38, "Weapon +2  2000"],
  106: [577, 276, 98, "Armor  +2  2000"],
  107: [577, 317, 103, "Armor  +2  2000"],
};

// Tab hotspots (pushb 0..2) and their MAINBUT indicator pictures 77..79 drawn at 521,96.
export const MAINE_TABS = [
  { id: "build", label: "Building Tab", x: 518, width: 40, frame: 77 },
  { id: "research", label: "Research Tab", x: 557, width: 41, frame: 78 },
  { id: "options", label: "Game Option Tab", x: 598, width: 40, frame: 79 },
] as const;
export type MaineTab = typeof MAINE_TABS[number]["id"];

export const MAINBUT_URL = assetUrl("/assets/generated/sprites/INTRFACE/MAINBUT.png");
export const MAINBUT_DIGIT_FRAME = 104;

export interface MainButtonAtlas { readonly frames: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[] }

let atlas: Promise<MainButtonAtlas> | undefined;
export function loadMainButtonAtlas(): Promise<MainButtonAtlas> {
  atlas ??= fetch(assetUrl("/assets/generated/sprites/INTRFACE/MAINBUT.json")).then(async response => {
    if (!response.ok) throw new Error(`MAINBUT metadata unavailable (${response.status})`);
    return await response.json() as MainButtonAtlas;
  });
  return atlas;
}

export function paintMainButtonFrame(element: HTMLElement, source: MainButtonAtlas, frame: number): void {
  const rect = source.frames[frame];
  if (!rect) throw new RangeError(`Missing MAINBUT frame ${frame}`);
  element.style.backgroundImage = `url("${MAINBUT_URL}")`;
  element.style.backgroundPosition = `-${rect.x}px -${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}
