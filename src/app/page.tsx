"use client";

import { useState, useEffect } from "react";
import { DatePicker } from "@/components/date-picker";
import { TimeFilter } from "@/components/time-filter";
import { TeeTimeList } from "@/components/tee-time-list";
import { getFavorites } from "@/lib/favorites";

export default function Home() {
  const [date, setDate] = useState(() =>
    new Date().toISOString().split("T")[0],
  );
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [teeTimes, setTeeTimes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeeTimes = async () => {
      setLoading(true);
      const params = new URLSearchParams({ date });

      const favorites = getFavorites();
      if (favorites.length > 0) {
        params.set("courses", favorites.join(","));
      }
      if (startTime) params.set("startTime", startTime);
      if (endTime) params.set("endTime", endTime);

      try {
        const res = await fetch(`/api/tee-times?${params}`);
        const data: { teeTimes?: never[] } = await res.json();
        setTeeTimes(data.teeTimes ?? []);
      } catch {
        setTeeTimes([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTeeTimes();
  }, [date, startTime, endTime]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-2xl font-bold">Twin Cities Tee Times</h1>
      <p className="mt-1 text-sm text-gray-500">
        Find available tee times across Twin Cities golf courses
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <DatePicker value={date} onChange={setDate} />
        <TimeFilter
          startTime={startTime}
          endTime={endTime}
          onStartChange={setStartTime}
          onEndChange={setEndTime}
        />
      </div>

      <div className="mt-6">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
  );
}
