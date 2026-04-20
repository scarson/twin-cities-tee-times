// ABOUTME: Pure display helper that merges sibling tee time rows into one card.
// ABOUTME: Rows with matching (course_id, date, time) collapse into a single DisplayTeeTime.
import type { TeeTimeItem } from "./tee-time-list";

export interface DisplayTeeTime extends TeeTimeItem {
  holesLabel: string;
  priceLabel: string | null;
}

function formatPrice(p: number): string {
  return `$${p.toFixed(2)}`;
}

function keyOf(item: TeeTimeItem): string {
  return `${item.course_id}|${item.date}|${item.time}`;
}

/**
 * Group sibling TeeTimeItems by (course_id, date, time) and produce one
 * DisplayTeeTime per group.
 *
 * Contract with adapters: adapters SHOULD emit one record per distinct
 * (course_id, date, time, holes) tuple. If duplicates with the same holes
 * value appear in the same group, this helper still runs without crashing
 * but produces an ugly label like "9 / 9 holes". Intentional — surfaces
 * adapter bugs visibly rather than masking them.
 */
export function mergeHoleVariants(items: TeeTimeItem[]): DisplayTeeTime[] {
  const groups = new Map<string, TeeTimeItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const k = keyOf(item);
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)!.push(item);
  }

  const out: DisplayTeeTime[] = [];
  for (const k of order) {
    const variants = groups.get(k)!.slice().sort((a, b) => a.holes - b.holes);

    if (variants.length === 1) {
      const v = variants[0];
      out.push({
        ...v,
        holesLabel: `${v.holes} holes`,
        priceLabel: v.price !== null ? formatPrice(v.price) : null,
      });
      continue;
    }

    const holesLabel = `${variants.map((v) => v.holes).join(" / ")} holes`;

    const knownPrices = variants
      .map((v) => v.price)
      .filter((p): p is number => p !== null);
    const priceLabel =
      knownPrices.length === 0 ? null : knownPrices.map(formatPrice).join(" / ");

    const openSlots = Math.min(...variants.map((v) => v.open_slots));

    const ninesValues = variants
      .map((v) => v.nines)
      .filter((n): n is string => !!n);
    const uniqueNines = Array.from(new Set(ninesValues));
    const nines = uniqueNines.length === 0 ? null : uniqueNines.join(", ");

    const first = variants[0];
    out.push({
      ...first,
      open_slots: openSlots,
      nines,
      holesLabel,
      priceLabel,
    });
  }

  return out;
}
