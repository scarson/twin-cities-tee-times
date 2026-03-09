// ABOUTME: Time-of-day preset filter with named time blocks (Early, Morning, etc.).
// ABOUTME: Maps preset selections to startTime/endTime for the tee times API.
"use client";

const PRESETS = [
  { id: "any", label: "Any", start: "", end: "" },
  { id: "early", label: "Early", start: "05:00", end: "08:00" },
  { id: "morning", label: "Morning", start: "08:00", end: "11:00" },
  { id: "afternoon", label: "Afternoon", start: "11:00", end: "15:00" },
  { id: "late", label: "Late", start: "15:00", end: "" },
] as const;

interface TimeFilterProps {
  startTime: string;
  endTime: string;
  onChange: (times: { startTime: string; endTime: string }) => void;
}

export function TimeFilter({ startTime, endTime, onChange }: TimeFilterProps) {
  const activePreset =
    PRESETS.find((p) => p.start === startTime && p.end === endTime)?.id ??
    "any";

  return (
    <div className="flex gap-1 lg:gap-1.5">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          onClick={() =>
            onChange({ startTime: preset.start, endTime: preset.end })
          }
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors lg:px-4 lg:py-2 lg:text-sm ${
            activePreset === preset.id
              ? "bg-green-600 text-white"
              : "bg-stone-100 text-gray-700 hover:bg-stone-200"
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
