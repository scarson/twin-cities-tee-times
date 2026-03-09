// ABOUTME: Date selector with quick 7-day buttons and a calendar for later dates.
// ABOUTME: Supports multi-select (quick buttons) and date range (calendar).
"use client";

import { useState, useRef, useEffect } from "react";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MAX_RANGE_DAYS = 14;

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function buildQuickDays(): { value: string; dayName: string; dayNum: number }[] {
  const days: { value: string; dayName: string; dayNum: number }[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push({
      value: toDateStr(d),
      dayName: i === 0 ? "Today" : DAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
    });
  }
  return days;
}

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (d <= endDate) {
    dates.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86400000;
  return Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / msPerDay
  );
}

interface CalendarProps {
  rangeStart: string | null;
  rangeEnd: string | null;
  onSelect: (date: string) => void;
  onClose: () => void;
}

function Calendar({ rangeStart, rangeEnd, onSelect, onClose }: CalendarProps) {
  const today = toDateStr(new Date());
  const [viewYear, setViewYear] = useState(() => {
    const d = rangeStart ? new Date(rangeStart + "T00:00:00") : new Date();
    return d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const d = rangeStart ? new Date(rangeStart + "T00:00:00") : new Date();
    return d.getMonth();
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  // Build calendar grid
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDow = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function isInRange(dateStr: string): boolean {
    if (!rangeStart || !rangeEnd) return false;
    return dateStr >= rangeStart && dateStr <= rangeEnd;
  }

  function isRangeEndpoint(dateStr: string): boolean {
    return dateStr === rangeStart || dateStr === rangeEnd;
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-10 mt-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="rounded p-1 text-gray-600 hover:bg-gray-100"
        >
          &larr;
        </button>
        <span className="text-sm font-medium">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          className="rounded p-1 text-gray-600 hover:bg-gray-100"
        >
          &rarr;
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-1 font-medium text-gray-400">
            {d.charAt(0)}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} />;
          }
          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isPast = dateStr < today;
          const inRange = isInRange(dateStr);
          const isEndpoint = isRangeEndpoint(dateStr);

          return (
            <button
              key={dateStr}
              disabled={isPast}
              onClick={() => onSelect(dateStr)}
              className={`rounded py-1 text-xs transition-colors ${
                isEndpoint
                  ? "bg-green-600 font-medium text-white"
                  : inRange
                    ? "bg-green-100 text-green-800"
                    : isPast
                      ? "text-gray-300"
                      : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {rangeStart && (
        <div className="mt-2 text-center text-[11px] text-gray-500">
          {rangeEnd
            ? `${rangeStart} to ${rangeEnd}`
            : "Pick an end date (max 14 days)"}
        </div>
      )}
    </div>
  );
}

interface DatePickerProps {
  selected: string[];
  onChange: (dates: string[]) => void;
}

export function DatePicker({ selected, onChange }: DatePickerProps) {
  const quickDays = buildQuickDays();
  const quickDateSet = new Set(quickDays.map((d) => d.value));

  // Calendar state
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  // Are we in calendar mode? (selected dates are outside the quick 7-day range)
  const inCalendarMode = selected.some((d) => !quickDateSet.has(d));

  function handleQuickToggle(date: string) {
    // Switch back to quick-select mode
    setCalendarOpen(false);
    setRangeStart(null);
    setRangeEnd(null);

    if (inCalendarMode) {
      // Coming from calendar mode — start fresh with this date
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

  function handleCalendarSelect(date: string) {
    if (!rangeStart || rangeEnd) {
      // Starting a new range
      setRangeStart(date);
      setRangeEnd(null);
      onChange([date]);
    } else {
      // Completing the range
      const [start, end] = date >= rangeStart
        ? [rangeStart, date]
        : [date, rangeStart];

      if (daysBetween(start, end) > MAX_RANGE_DAYS) {
        // Exceed max — start over with this date
        setRangeStart(date);
        setRangeEnd(null);
        onChange([date]);
        return;
      }

      setRangeStart(start);
      setRangeEnd(end);
      onChange(datesInRange(start, end));
    }
  }

  function handleMoreClick() {
    if (calendarOpen) {
      setCalendarOpen(false);
    } else {
      setCalendarOpen(true);
      // If we're not already in calendar mode, reset range state
      if (!inCalendarMode) {
        setRangeStart(null);
        setRangeEnd(null);
      }
    }
  }

  // Summary label for calendar mode
  const calendarLabel = inCalendarMode && rangeStart
    ? rangeEnd && rangeEnd !== rangeStart
      ? `${formatShortDate(rangeStart)} – ${formatShortDate(rangeEnd)}`
      : formatShortDate(rangeStart)
    : null;

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        {quickDays.map((day) => (
          <button
            key={day.value}
            onClick={() => handleQuickToggle(day.value)}
            className={`flex flex-col items-center rounded px-2.5 py-1.5 text-xs transition-colors ${
              !inCalendarMode && selected.includes(day.value)
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <span className="font-medium">{day.dayName}</span>
            <span className="text-[11px]">{day.dayNum}</span>
          </button>
        ))}
        <button
          onClick={handleMoreClick}
          className={`flex flex-col items-center rounded px-2.5 py-1.5 text-xs transition-colors ${
            inCalendarMode || calendarOpen
              ? "bg-green-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <span className="font-medium">More</span>
          <span className="text-[11px]">{calendarOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      {calendarLabel && !calendarOpen && (
        <div className="mt-1 text-xs text-gray-500">{calendarLabel}</div>
      )}

      {calendarOpen && (
        <Calendar
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onSelect={handleCalendarSelect}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
