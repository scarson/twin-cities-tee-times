"use client";
// ABOUTME: React hook for location state management with zip and GPS input.
// ABOUTME: Persists zip and radius to localStorage; GPS coordinates are ephemeral.

import { useContext } from "react";
import { LocationContext } from "@/context/location-provider";

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const DEFAULT_RADIUS = 25;

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip);
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return ctx;
}
