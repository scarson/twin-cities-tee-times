// ABOUTME: Platform adapter registry mapping platform IDs to adapter instances.
// ABOUTME: Used by the poller to look up the correct adapter for each course.
import type { PlatformAdapter } from "@/types";
import { ChronogolfAdapter } from "./chronogolf";
import { CpsGolfAdapter } from "./cps-golf";
import { EagleClubAdapter } from "./eagle-club";
import { ForeUpAdapter } from "./foreup";
import { TeeItUpAdapter } from "./teeitup";

const adapters: PlatformAdapter[] = [
  new CpsGolfAdapter(),
  new ForeUpAdapter(),
  new TeeItUpAdapter(),
  new ChronogolfAdapter(),
  new EagleClubAdapter(),
];

const adapterMap = new Map(adapters.map((a) => [a.platformId, a]));

export function getAdapter(platformId: string): PlatformAdapter | undefined {
  return adapterMap.get(platformId);
}
