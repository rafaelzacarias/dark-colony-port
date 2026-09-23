import type { CampaignMissionData } from "../game-data";
import type { CampaignAiConfiguration } from "./campaign-ai";
import type { CampaignSessionInput } from "./campaign-session";
import type { NativeConstructionActor, NativeConstructionConfiguration } from "./native-construction-host";
import type { FinAnimationData } from "../render/fin-animation";

export interface SourceConstructionOptions {
  readonly scope: "source-separated-bounded";
  readonly constructionSources?: readonly NativeConstructionConfiguration[];
  readonly campaignAi?: CampaignAiConfiguration;
}

export type SourceConstructionMission = CampaignMissionData & {
  readonly sourceConstruction?: SourceConstructionOptions;
};

export type SourceConstructionFrame = Pick<CampaignSessionInput, "campaignAiRequest"> & {
  readonly constructionVisits: NonNullable<CampaignSessionInput["constructionVisits"]>;
};

export function sourceConstructionSources(mission: SourceConstructionMission) {
  const production = mission.sourceProduction?.production;
  const alias = mission.sourceConstruction?.constructionSources;
  if (mission.sourceConstruction && mission.sourceConstruction.scope !== "source-separated-bounded") {
    throw new TypeError("Construction view requires source-separated-bounded scope");
  }
  if (alias && production?.constructionSources && JSON.stringify(alias) !== JSON.stringify(production.constructionSources)) {
    throw new TypeError("Construction source alias disagrees with production.constructionSources");
  }
  const sources = production?.constructionSources ?? alias;
  if (mission.sourceConstruction && (!production || !sources?.length)) {
    throw new TypeError("Construction view requires source production and nonempty constructionSources");
  }
  return sources?.length ? sources : undefined;
}

export function sourceConstructionSample(animation: FinAnimationData, actor: NativeConstructionActor) {
  const state = animation.states.find(entry => entry.name === actor.animation.profile && entry.validRange !== false);
  if (!state) throw new TypeError(`Missing construction FIN state: ${actor.animation.profile}`);
  const count = state.lastTimelineIndex - state.firstTimelineIndex + 1;
  const frame = actor.animation.mode === 0 && actor.animation.frame >= count ? 0 : actor.animation.frame;
  const timelineIndex = state.firstTimelineIndex + frame;
  if (frame < 0 || frame >= count || !animation.timeline[timelineIndex]) {
    throw new TypeError(`Missing construction FIN frame: ${actor.animation.profile}:${frame}`);
  }
  return { timelineIndex, finished: actor.animation.mode === 2,
    children: actor.animation.mode === 2 ? [] : animation.timeline[timelineIndex].children };
}