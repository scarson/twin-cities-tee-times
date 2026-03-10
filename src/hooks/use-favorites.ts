"use client";
// ABOUTME: React hook for favorites management that works in both anonymous and logged-in modes.
// ABOUTME: Anonymous mode uses localStorage directly; logged-in mode syncs with server API.

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  getFavorites as localGetFavorites,
  getFavoriteDetails as localGetFavoriteDetails,
  setFavorites as localSetFavorites,
  toggleFavorite as localToggleFavorite,
} from "@/lib/favorites";
import type { FavoriteEntry } from "@/lib/favorites";

export function useFavorites() {
  const { isLoggedIn, isLoading, favoritesVersion, showToast } = useAuth();

  // Initialize empty for SSR hydration safety — localStorage is read in useEffect
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteDetails, setFavoriteDetails] = useState<FavoriteEntry[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);

  // Populate from localStorage after mount (avoids React #418 hydration mismatch)
  useEffect(() => {
    setFavorites(localGetFavorites());
    setFavoriteDetails(localGetFavoriteDetails());
  }, []);

  // Mark favorites ready once auth resolves for anonymous users
  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      setFavoritesReady(true);
    }
  }, [isLoading, isLoggedIn]);

  // Logged-in mode: fetch server favorites and overwrite local state + localStorage
  useEffect(() => {
    if (!isLoggedIn) return;

    let cancelled = false;

    async function fetchServerFavorites() {
      try {
        const res = await fetch("/api/user/favorites");
        if (!res.ok || cancelled) return;

        const { favorites: serverFavs } = (await res.json()) as {
          favorites: { courseId: string; courseName: string }[];
        };

        const details: FavoriteEntry[] = serverFavs.map((f) => ({
          id: f.courseId,
          name: f.courseName,
        }));

        if (cancelled) return;

        setFavoriteDetails(details);
        setFavorites(details.map((d) => d.id));
        localSetFavorites(details);
      } catch {
        // Keep localStorage data on fetch failure
      } finally {
        if (!cancelled) {
          setFavoritesReady(true);
        }
      }
    }

    fetchServerFavorites();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, favoritesVersion]);

  const toggleFavorite = useCallback(
    (courseId: string, courseName?: string) => {
      if (!isLoggedIn) {
        // Anonymous mode: delegate to localStorage
        const newIds = localToggleFavorite(courseId, courseName);
        setFavorites(newIds);
        setFavoriteDetails(localGetFavoriteDetails());
        return;
      }

      // Logged-in mode: optimistic update
      const prevFavorites = favorites;
      const prevDetails = favoriteDetails;
      const wasAlreadyFavorite = favorites.includes(courseId);

      let nextDetails: FavoriteEntry[];
      let nextFavorites: string[];

      if (wasAlreadyFavorite) {
        nextDetails = prevDetails.filter((d) => d.id !== courseId);
        nextFavorites = prevFavorites.filter((id) => id !== courseId);
      } else {
        const entry: FavoriteEntry = {
          id: courseId,
          name: courseName ?? courseId,
        };
        nextDetails = [...prevDetails, entry];
        nextFavorites = [...prevFavorites, courseId];
      }

      // Optimistic update state + localStorage
      setFavorites(nextFavorites);
      setFavoriteDetails(nextDetails);
      localSetFavorites(nextDetails);

      // Fire API call
      const method = wasAlreadyFavorite ? "DELETE" : "POST";
      fetch(`/api/user/favorites/${courseId}`, { method }).then((res) => {
        if (!res.ok) {
          // Rollback on failure
          setFavorites(prevFavorites);
          setFavoriteDetails(prevDetails);
          localSetFavorites(prevDetails);
          showToast("Couldn\u2019t save \u2014 try again");
        }
      }).catch(() => {
        // Rollback on network error
        setFavorites(prevFavorites);
        setFavoriteDetails(prevDetails);
        localSetFavorites(prevDetails);
        showToast("Couldn\u2019t save \u2014 try again");
      });
    },
    [isLoggedIn, favorites, favoriteDetails, showToast]
  );

  const isFavorite = useCallback(
    (courseId: string) => favorites.includes(courseId),
    [favorites]
  );

  const mergeFavorites = useCallback(
    async (entries: FavoriteEntry[]) => {
      // Deduplicate against current favorites
      const newEntries = entries.filter(
        (e) => !favorites.includes(e.id)
      );
      if (newEntries.length === 0) return;

      // Update local state + localStorage
      const merged = [...favoriteDetails, ...newEntries];
      setFavoriteDetails(merged);
      setFavorites(merged.map((d) => d.id));
      localSetFavorites(merged);

      // Logged-in: also sync to server
      if (isLoggedIn) {
        try {
          await fetch("/api/user/favorites/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseIds: newEntries.map((e) => e.id) }),
          });
        } catch {
          // localStorage already updated; server will catch up on next login
        }
      }
    },
    [isLoggedIn, favorites, favoriteDetails]
  );

  return { favorites, favoriteDetails, toggleFavorite, isFavorite, mergeFavorites, favoritesReady };
}
