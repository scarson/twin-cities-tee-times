"use client";

import { useState } from "react";

interface RefreshButtonProps {
  courseId: string;
  date: string;
  onRefreshed: () => void;
}

export function RefreshButton({ courseId, date, onRefreshed }: RefreshButtonProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/courses/${courseId}/refresh?date=${date}`, {
        method: "POST",
      });
      onRefreshed();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {refreshing ? "Refreshing..." : "Refresh now"}
    </button>
  );
}
