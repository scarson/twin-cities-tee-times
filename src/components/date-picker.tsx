"use client";

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const today = new Date().toISOString().split("T")[0];
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 6);
  const max = maxDate.toISOString().split("T")[0];

  return (
    <input
      type="date"
      value={value}
      min={today}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-gray-300 px-3 py-2 text-sm"
    />
  );
}
