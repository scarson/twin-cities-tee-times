"use client";
// ABOUTME: Lightweight toast notification for transient messages.
// ABOUTME: Auto-dismisses after 5 seconds, used for merge confirmations and errors.

import { useEffect } from "react";

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (message === null) return;

    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (message === null) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-gray-800 px-4 py-2 text-sm text-white shadow-lg">
      {message}
    </div>
  );
}
