"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { DatePicker } from "@/components/date-picker";
import { TeeTimeList } from "@/components/tee-time-list";
import { CourseHeader } from "@/components/course-header";
import { RefreshButton } from "@/components/refresh-button";

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [course, setCourse] = useState<any>(null);
  const [teeTimes, setTeeTimes] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRes, timesRes] = await Promise.all([
        fetch(`/api/courses/${id}`),
        fetch(`/api/tee-times?date=${date}&courses=${id}`),
      ]);
      const courseData = (await courseRes.json()) as any;
      const timesData = (await timesRes.json()) as any;

      setCourse(courseData.course ?? null);
      setTeeTimes(timesData.teeTimes ?? []);
    } catch {
      setTeeTimes([]);
    } finally {
      setLoading(false);
    }
  }, [id, date]);

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
        <DatePicker value={date} onChange={setDate} />
        {course && (
          <RefreshButton
            courseId={id}
            date={date}
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
