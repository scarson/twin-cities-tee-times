// ABOUTME: Date selector with quick 14-day buttons (two rows) and a calendar for later dates.
// ABOUTME: Supports multi-select (quick buttons) and date range (calendar).
"use client";

import { useState, useRef, useEffect } from "react";
import { DayPicker, getDefaultClassNames, DateRange } from "react-day-picker";
import "react-day-picker/style.css";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_RANGE_DAYS = 14;

// Central Time date string. All courses are in the Twin Cities metro.
export function toDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

// Noon UTC avoids timezone drift: noon UTC is the same calendar date
// in all timezones from UTC-12 to UTC+12, including Central Time.
export function fromDateStr(s: string): Date {
  return new Date(s + "T12:00:00Z");
}

export function buildQuickDays(): { value: string; dayName: string; dayNum: number }[] {
  const days: { value: string; dayName: string; dayNum: number }[] = [];
  const today = fromDateStr(toDateStr(new Date()));
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    days.push({
      value: toDateStr(d),
      dayName: i === 0 ? "Today" : DAY_NAMES[d.getUTCDay()],
      dayNum: d.getUTCDate(),
    });
  }
  return days;
}

export function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = fromDateStr(start);
  const endDate = fromDateStr(end);
  while (d <= endDate) {
    dates.push(toDateStr(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

export function formatShortDate(dateStr: string): string {
  const d = fromDateStr(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

interface DatePickerProps {
  selected: string[];
  onChange: (dates: string[]) => void;
}

export function DatePicker({ selected, onChange }: DatePickerProps) {
  const quickDays = buildQuickDays();
  const quickDateSet = new Set(quickDays.map((d) => d.value));
  const today = new Date();

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>();
  const calendarRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const inCalendarMode = selected.some((d) => !quickDateSet.has(d));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        calendarRef.current && !calendarRef.current.contains(target) &&
        moreButtonRef.current && !moreButtonRef.current.contains(target)
      ) {
        setCalendarOpen(false);
      }
    }
    if (calendarOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [calendarOpen]);

  function handleQuickToggle(date: string) {
    setCalendarOpen(false);
    setRange(undefined);

    if (inCalendarMode) {
      onChange([date]);
      return;
    }

    if (selected.includes(date)) {
      if (selected.length > 1) {
        onChange(selected.filter((d) => d !== date));
      }
    } else {
      onChange([...selected, date].sort());
    }
  }

  function handleRangeSelect(newRange: DateRange | undefined) {
    setRange(newRange);
    if (newRange?.from) {
      if (newRange.to) {
        const start = toDateStr(newRange.from);
        const end = toDateStr(newRange.to);
        onChange(datesInRange(start, end));
      } else {
        onChange([toDateStr(newRange.from)]);
      }
    }
  }

  function handleMoreClick() {
    if (calendarOpen) {
      setCalendarOpen(false);
    } else {
      setCalendarOpen(true);
      if (!inCalendarMode) {
        setRange(undefined);
      }
    }
  }

  // Label for calendar mode
  const calendarLabel =
    inCalendarMode && selected.length > 0
      ? selected.length === 1
        ? formatShortDate(selected[0])
        : `${formatShortDate(selected[0])} – ${formatShortDate(selected[selected.length - 1])}`
      : null;

  const defaultClassNames = getDefaultClassNames();

  const week1 = quickDays.slice(0, 7);
  const week2 = quickDays.slice(7);

  return (
    <div className="relative">
      <div className="flex items-center gap-1 lg:gap-1.5">
        {week1.map((day) => (
          <button
            key={day.value}
            onClick={() => handleQuickToggle(day.value)}
            className={`flex flex-col items-center rounded px-2.5 py-1.5 text-xs transition-colors lg:px-3 lg:py-2 lg:text-sm ${
              !inCalendarMode && selected.includes(day.value)
                ? "bg-green-600 text-white"
                : "bg-stone-100 text-gray-700 hover:bg-stone-200"
            }`}
          >
            <span className="font-medium">{day.dayName}</span>
            <span className="text-[11px] lg:text-xs">{day.dayNum}</span>
          </button>
        ))}
        {/* Hidden while quick buttons cover the full polling range (MAX_HORIZON=14).
           Re-enable when MAX_HORIZON increases beyond the quick button count. */}
        {false && <button
          ref={moreButtonRef}
          onClick={handleMoreClick}
          className={`flex items-center rounded px-2.5 py-1.5 text-xs font-medium transition-colors lg:px-3 lg:py-2 lg:text-sm ${
            inCalendarMode || calendarOpen
              ? "bg-green-600 text-white"
              : "bg-stone-100 text-gray-700 hover:bg-stone-200"
          }`}
        >
          More Dates
        </button>}
      </div>
      <div className="mt-1 flex items-center gap-1 lg:gap-1.5">
        {week2.map((day) => (
          <button
            key={day.value}
            onClick={() => handleQuickToggle(day.value)}
            className={`flex flex-col items-center rounded px-2 py-1 text-[11px] transition-colors lg:px-2.5 lg:py-1.5 lg:text-xs ${
              !inCalendarMode && selected.includes(day.value)
                ? "bg-green-600 text-white"
                : "bg-stone-100 text-gray-700 hover:bg-stone-200"
            }`}
          >
            <span className="font-medium">{day.dayName}</span>
            <span className="text-[10px] lg:text-[11px]">{day.dayNum}</span>
          </button>
        ))}
      </div>

      {/* Reserve space so content below doesn't jump */}
      <div className="h-5 mt-1">
        {calendarLabel && !calendarOpen && (
          <span className="text-xs text-gray-500 lg:text-sm">{calendarLabel}</span>
        )}
      </div>

      {calendarOpen && (
        <div
          ref={calendarRef}
          className="absolute left-0 top-full z-10 rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <DayPicker
            mode="range"
            selected={range}
            onSelect={handleRangeSelect}
            disabled={{ before: today }}
            max={MAX_RANGE_DAYS}
            classNames={{
              today: "border-2 border-green-500 rounded",
              selected: "bg-green-600 text-white rounded",
              range_start: "bg-green-600 text-white rounded-l",
              range_end: "bg-green-600 text-white rounded-r",
              range_middle: "bg-green-100 text-green-800",
              root: `${defaultClassNames.root} p-3`,
              chevron: `${defaultClassNames.chevron} fill-green-600`,
            }}
          />
        </div>
      )}
    </div>
  );
}
