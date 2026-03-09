"use client";

import { useState } from "react";

interface RefreshButtonProps {
  courseId: string;
  dates: string[];
  onRefreshed: () => void;
}

export function RefreshButton({ courseId, dates, onRefreshed }: RefreshButtonProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        dates.map((date) =>
          fetch(`/api/courses/${courseId}/refresh?date=${date}`, {
            method: "POST",
          })
        )
      );
      onRefreshed();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 lg:px-4 lg:py-1.5 lg:text-base"
    >
      {refreshing ? "Refreshing..." : "Refresh now"}
    </button>
  );
}
