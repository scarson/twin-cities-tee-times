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
  const { isLoggedIn, showToast } = useAuth();

  const [favorites, setFavorites] = useState<string[]>(() => localGetFavorites());
  const [favoriteDetails, setFavoriteDetails] = useState<FavoriteEntry[]>(
    () => localGetFavoriteDetails()
  );

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
      }
    }

    fetchServerFavorites();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

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

  return { favorites, favoriteDetails, toggleFavorite, isFavorite };
}
