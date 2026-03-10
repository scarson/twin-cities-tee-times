// ABOUTME: Course detail page showing tee times for a single course.
// ABOUTME: Fetches course info and tee times, supports date selection and refresh.
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { DatePicker } from "@/components/date-picker";
import { TeeTimeList } from "@/components/tee-time-list";
import { CourseHeader } from "@/components/course-header";
import { todayCT } from "@/lib/format";

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [dates, setDates] = useState<string[]>(() => [todayCT()]);
  const [course, setCourse] = useState<{
    id: string;
    name: string;
    city: string;
    booking_url: string;
    last_polled: string | null;
  } | null>(null);
  const [teeTimes, setTeeTimes] = useState<
    { course_id: string; date: string; time: string; price: number | null; holes: number; open_slots: number; course_name: string; course_city: string; booking_url: string; fetched_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [courseRes, ...timesResults] = await Promise.all([
        fetch(`/api/courses/${id}`),
        ...dates.map((date) =>
          fetch(`/api/tee-times?date=${date}&courses=${id}`).then((r) => r.json())
        ),
      ]);
      const courseData: { course?: typeof course } = await courseRes.json();
      const merged = (timesResults as { teeTimes?: typeof teeTimes }[]).flatMap((r) => r.teeTimes ?? []);
      merged.sort((a: { date: string; time: string }, b: { date: string; time: string }) =>
        `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
      );

      setCourse(courseData.course ?? null);
      setTeeTimes(merged);
    } catch (err) {
      console.error("Failed to fetch course data:", err);
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
        <CourseHeader course={course} dates={dates} onRefreshed={() => fetchData(false)} />
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
