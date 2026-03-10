"use client";
// ABOUTME: Auth UI area for the nav bar showing sign-in or user dropdown.
// ABOUTME: Reads auth state from AuthProvider context.

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

export function NavAuthArea() {
  const { user, isLoggedIn, isLoading, signOut, deleteAccount } = useAuth();
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
        setConfirmingDelete(false);
      }
    }

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

  if (isLoading) {
    return <div className="h-8 w-8" />;
  }

  if (!isLoggedIn) {
    const signInUrl = `/api/auth/google?returnTo=${encodeURIComponent(pathname)}`;
    return (
      <a href={signInUrl} className="text-sm text-white hover:underline">
        Sign in
      </a>
    );
  }

  const initial = user?.name?.charAt(0).toUpperCase() ?? "?";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          setDropdownOpen(!dropdownOpen);
          setConfirmingDelete(false);
        }}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white text-sm font-medium text-gray-900"
        aria-label="User menu"
      >
        {initial}
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-gray-200 bg-white py-2 shadow-lg">
          <div className="px-4 py-2">
            <div className="text-sm font-medium text-gray-900">
              {user?.name}
            </div>
            <div className="text-sm text-gray-500">{user?.email}</div>
          </div>

          <div className="my-1 border-t border-gray-100" />

          {confirmingDelete ? (
            <div className="px-4 py-2">
              <p className="mb-3 text-sm text-gray-700">
                Delete your account? Your favorites and booking history will be
                permanently removed.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    setConfirmingDelete(false);
                    deleteAccount();
                  }}
                  className="rounded px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  signOut();
                }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
              >
                Sign out
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Delete account
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
