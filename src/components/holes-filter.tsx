// ABOUTME: Hole-count filter with Any/9/18 buttons matching the TimeFilter visual pattern.
// ABOUTME: Maps the selected value to the holes API query parameter.
"use client";

const OPTIONS = [
  { value: "", label: "Any" },
  { value: "9", label: "9 holes" },
  { value: "18", label: "18 holes" },
] as const;

export type HolesFilterValue = "" | "9" | "18";

interface HolesFilterProps {
  value: HolesFilterValue;
  onChange: (value: HolesFilterValue) => void;
}

export function HolesFilter({ value, onChange }: HolesFilterProps) {
  return (
    <div className="flex gap-1 lg:gap-1.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value || "any"}
          onClick={() => onChange(opt.value)}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors lg:px-4 lg:py-2 lg:text-sm ${
            value === opt.value
              ? "bg-green-600 text-white"
              : "bg-stone-100 text-gray-700 hover:bg-stone-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
