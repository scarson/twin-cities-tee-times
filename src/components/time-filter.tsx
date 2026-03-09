"use client";

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
      <input
        type="time"
        value={startTime}
        onChange={(e) => onStartChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <label className="text-sm text-gray-600">to</label>
      <input
        type="time"
        value={endTime}
        onChange={(e) => onEndChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
    </div>
  );
}
