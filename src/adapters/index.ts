// ABOUTME: Platform adapter registry mapping platform IDs to adapter instances.
// ABOUTME: Used by the poller to look up the correct adapter for each course.
import type { PlatformAdapter } from "@/types";
import { CpsGolfAdapter } from "./cps-golf";
import { ForeUpAdapter } from "./foreup";

const adapters: PlatformAdapter[] = [
  new CpsGolfAdapter(),
  new ForeUpAdapter(),
];

const adapterMap = new Map(adapters.map((a) => [a.platformId, a]));

export function getAdapter(platformId: string): PlatformAdapter | undefined {
  return adapterMap.get(platformId);
}
