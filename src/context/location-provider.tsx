"use client";
// ABOUTME: React context providing shared location state across pages.
// ABOUTME: Manages GPS, zip code lookup, radius selection, and localStorage persistence.

import { createContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { isValidZip, DEFAULT_RADIUS, DEFAULT_SORT_ORDER, type SortOrder } from "@/hooks/use-location";

export interface LocationState {
  lat: number;
  lng: number;
  label: string;
}

export interface LocationContextValue {
  location: LocationState | null;
  zip: string;
  radiusMiles: number;
  sortOrder: SortOrder;
  gpsLoading: boolean;
  gpsError: string | null;
  setZip: (zip: string) => Promise<void>;
  requestGps: () => void;
  setRadiusMiles: (r: number) => void;
  setSortOrder: (order: SortOrder) => void;
  clearLocation: () => void;
}

export const LocationContext = createContext<LocationContextValue | null>(null);

const LS_ZIP_KEY = "tct-zip";
const LS_RADIUS_KEY = "tct-radius";

function readStoredZip(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LS_ZIP_KEY) ?? "";
  } catch {
    return "";
  }
}

function readStoredRadius(): number {
  if (typeof window === "undefined") return DEFAULT_RADIUS;
  try {
    const val = localStorage.getItem(LS_RADIUS_KEY);
    if (!val) return DEFAULT_RADIUS;
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : DEFAULT_RADIUS;
  } catch {
    return DEFAULT_RADIUS;
  }
}

let zipCoordsCache: Record<string, [number, number]> | null = null;

async function loadZipCoords(): Promise<Record<string, [number, number]>> {
  if (zipCoordsCache) return zipCoordsCache;
  const res = await fetch("/zip-coords.json");
  if (!res.ok) throw new Error("Failed to load zip coordinates");
  zipCoordsCache = await res.json();
  return zipCoordsCache!;
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<LocationState | null>(null);
  const [zip, setZipState] = useState<string>(readStoredZip);
  const [radiusMiles, setRadiusState] = useState<number>(readStoredRadius);
  const [sortOrder, setSortOrderState] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // On mount, if we have a stored zip, resolve it to coordinates.
  // MUST be in useEffect, not during render.
  useEffect(() => {
    const storedZip = readStoredZip();
    if (isValidZip(storedZip)) {
      loadZipCoords().then((coords) => {
        const entry = coords[storedZip];
        if (entry) {
          setLocation({ lat: entry[0], lng: entry[1], label: storedZip });
        }
      }).catch(() => {
        // Zip coords failed to load — no location, that's fine
      });
    }
  }, []);

  const setZip = useCallback(async (newZip: string) => {
    if (!isValidZip(newZip)) return;
    try {
      const coords = await loadZipCoords();
      const entry = coords[newZip];
      if (!entry) {
        setGpsError(`Zip code ${newZip} not found`);
        return;
      }
      setZipState(newZip);
      setLocation({ lat: entry[0], lng: entry[1], label: newZip });
      setGpsError(null);
      localStorage.setItem(LS_ZIP_KEY, newZip);
    } catch {
      setGpsError("Failed to load zip code data");
    }
  }, []);

  const requestGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser");
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: "your location",
        });
        setGpsLoading(false);
        // GPS coordinates are NOT persisted — privacy constraint
      },
      (error) => {
        const messages: Record<number, string> = {
          [GeolocationPositionError.PERMISSION_DENIED]: "Location permission denied",
          [GeolocationPositionError.POSITION_UNAVAILABLE]: "Location unavailable",
          [GeolocationPositionError.TIMEOUT]: "Location request timed out",
        };
        setGpsError(messages[error.code] ?? "Failed to get location");
        setGpsLoading(false);
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  const setRadiusMiles = useCallback((r: number) => {
    setRadiusState(r);
    try {
      localStorage.setItem(LS_RADIUS_KEY, String(r));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const setSortOrder = useCallback((order: SortOrder) => {
    setSortOrderState(order);
  }, []);

  // Intentionally keeps radius in localStorage when clearing —
  // users shouldn't have to re-select their preferred radius each time.
  const clearLocation = useCallback(() => {
    setLocation(null);
    setZipState("");
    setGpsError(null);
    try {
      localStorage.removeItem(LS_ZIP_KEY);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return (
    <LocationContext.Provider
      value={{
        location,
        zip,
        radiusMiles,
        sortOrder,
        gpsLoading,
        gpsError,
        setZip,
        requestGps,
        setRadiusMiles,
        setSortOrder,
        clearLocation,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}
