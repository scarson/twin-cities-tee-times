"use client";
// ABOUTME: React context provider for authentication state.
// ABOUTME: Manages login detection, post-login merge, sign-out, and account deletion.

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { getFavorites, setFavorites } from "@/lib/favorites";
import { Toast } from "./toast";

interface User {
  userId: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  favoritesVersion: number;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  showToast: (message: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [favoritesVersion, setFavoritesVersion] = useState(0);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          setUser(null);
          setIsLoading(false);
          return;
        }

        const userData: User = await res.json();
        setUser(userData);
        setIsLoading(false);

        const params = new URLSearchParams(window.location.search);
        if (params.get("justSignedIn") === "true") {
          const localFavorites = getFavorites();

          if (localFavorites.length > 0) {
            const mergeRes = await fetch("/api/user/favorites/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ courseIds: localFavorites }),
            });

            if (mergeRes.ok) {
              const { merged } = (await mergeRes.json()) as { merged: number };

              const favRes = await fetch("/api/user/favorites");
              if (favRes.ok) {
                const { favorites } = (await favRes.json()) as {
                  favorites: { courseId: string; courseName: string }[];
                };
                setFavorites(
                  favorites.map((f: { courseId: string; courseName: string }) => ({
                    id: f.courseId,
                    name: f.courseName,
                  }))
                );
              }

              if (merged > 0) {
                showToast(`Synced ${merged} favorites from this device`);
              }
            } else {
              showToast("Couldn\u2019t sync favorites \u2014 they\u2019ll sync next time");
            }
          }

          setFavoritesVersion((v) => v + 1);
          const url = new URL(window.location.href);
          url.searchParams.delete("justSignedIn");
          history.replaceState({}, "", url.pathname + url.search);
        } else {
          setFavoritesVersion((v) => v + 1);
        }
      } catch {
        setUser(null);
        setIsLoading(false);
      }
    }

    init();
  }, [showToast]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/user/account", { method: "DELETE" });
      if (!res.ok) {
        showToast("Failed to delete account — try again");
        return;
      }
      setFavorites([]);
      setUser(null);
      window.location.href = "/";
    } catch {
      showToast("Failed to delete account — try again");
    }
  }, [showToast]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoggedIn: user !== null,
      isLoading,
      favoritesVersion,
      signOut,
      deleteAccount,
      showToast,
    }),
    [user, isLoading, favoritesVersion, signOut, deleteAccount, showToast]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
