// ABOUTME: Course detail page showing tee times for a single course.
// ABOUTME: Fetches course info and tee times, supports date selection and refresh.
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { DatePicker } from "@/components/date-picker";
import { TeeTimeList } from "@/components/tee-time-list";
import { CourseHeader } from "@/components/course-header";

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
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!course && !loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-8">
        <p className="text-gray-500">Course not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-3xl lg:py-8">
      {course && (
        <CourseHeader course={course} dates={dates} onRefreshed={fetchData} />
      )}

      <div className="mt-4">
        <DatePicker selected={dates} onChange={setDates} />
      </div>

      <div className="mt-6">
        <TeeTimeList teeTimes={teeTimes} loading={loading} />
      </div>
    </main>
  );
}
