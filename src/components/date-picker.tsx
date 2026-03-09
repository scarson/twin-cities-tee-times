// ABOUTME: Date selector showing the next 7 days as clickable buttons.
// ABOUTME: Displays day-of-week abbreviation and date for quick selection.
"use client";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildDays(): { value: string; dayName: string; dayNum: number }[] {
  const days: { value: string; dayName: string; dayNum: number }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push({
      value: d.toISOString().split("T")[0],
      dayName: i === 0 ? "Today" : DAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
    });
  }
  return days;
}

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const days = buildDays();

  return (
    <div className="flex gap-1">
      {days.map((day) => (
        <button
          key={day.value}
          onClick={() => onChange(day.value)}
          className={`flex flex-col items-center rounded px-2.5 py-1.5 text-xs transition-colors ${
            value === day.value
              ? "bg-green-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <span className="font-medium">{day.dayName}</span>
          <span className="text-[11px]">{day.dayNum}</span>
        </button>
      ))}
    </div>
  );
}
