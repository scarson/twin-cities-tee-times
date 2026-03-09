// ABOUTME: Time range filter using select dropdowns with 15-minute intervals.
// ABOUTME: Replaces native time inputs for better UX on mobile and desktop.
"use client";

const TIME_SLOTS = buildTimeSlots();

function buildTimeSlots(): { value: string; label: string }[] {
  const slots: { value: string; label: string }[] = [];
  for (let h = 5; h <= 20; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? "PM" : "AM";
      const label = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
      slots.push({ value, label });
    }
  }
  return slots;
}

interface TimeFilterProps {
  startTime: string;
  endTime: string;
  onStartChange: (time: string) => void;
  onEndChange: (time: string) => void;
}

export function TimeFilter({
  startTime,
  endTime,
  onStartChange,
  onEndChange,
}: TimeFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600">From</label>
      <select
        value={startTime}
        onChange={(e) => onStartChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1.5 text-sm"
      >
        <option value="">Any</option>
        {TIME_SLOTS.map((slot) => (
          <option key={slot.value} value={slot.value}>
            {slot.label}
          </option>
        ))}
      </select>
      <label className="text-sm text-gray-600">to</label>
      <select
        value={endTime}
        onChange={(e) => onEndChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1.5 text-sm"
      >
        <option value="">Any</option>
        {TIME_SLOTS.map((slot) => (
          <option key={slot.value} value={slot.value}>
            {slot.label}
          </option>
        ))}
      </select>
    </div>
  );
}
