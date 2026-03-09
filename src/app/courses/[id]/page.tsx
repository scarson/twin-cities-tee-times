"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { DatePicker } from "@/components/date-picker";
import { TeeTimeList } from "@/components/tee-time-list";
import { CourseHeader } from "@/components/course-header";
import { RefreshButton } from "@/components/refresh-button";

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [dates, setDates] = useState<string[]>(() => [
    new Date().toISOString().split("T")[0],
  ]);
  const [course, setCourse] = useState<any>(null);
  const [teeTimes, setTeeTimes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRes, ...timesResults] = await Promise.all([
        fetch(`/api/courses/${id}`),
        ...dates.map((date) =>
          fetch(`/api/tee-times?date=${date}&courses=${id}`).then((r) => r.json())
        ),
      ]);
      const courseData = (await courseRes.json()) as any;
      const merged = (timesResults as any[]).flatMap((r) => r.teeTimes ?? []);
      merged.sort((a: { date: string; time: string }, b: { date: string; time: string }) =>
        `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
      );

      setCourse(courseData.course ?? null);
      setTeeTimes(merged);
    } catch {
      setTeeTimes([]);
    } finally {
      setLoading(false);
    }
  }, [id, dates]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!course && !loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <p className="text-gray-500">Course not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {course && <CourseHeader course={course} />}

      <div className="mt-4 flex items-center gap-4">
        <DatePicker selected={dates} onChange={setDates} />
        {course && (
          <RefreshButton
            courseId={id}
            dates={dates}
            onRefreshed={fetchData}
          />
        )}
      </div>

      <div className="mt-6">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
  );
}
