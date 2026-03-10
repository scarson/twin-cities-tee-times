// @vitest-environment jsdom
// ABOUTME: Tests for useFavorites hook.
// ABOUTME: Covers anonymous localStorage mode and logged-in server-backed mode.

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockShowToast = vi.fn();
vi.mock("@/components/auth-provider", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/favorites", () => ({
  getFavorites: vi.fn().mockReturnValue([]),
  getFavoriteDetails: vi.fn().mockReturnValue([]),
  setFavorites: vi.fn(),
  toggleFavorite: vi.fn().mockReturnValue([]),
  isFavorite: vi.fn().mockReturnValue(false),
}));

import { useAuth } from "@/components/auth-provider";
import {
  getFavorites,
  getFavoriteDetails,
  setFavorites,
  toggleFavorite as localToggleFavorite,
} from "@/lib/favorites";
import { useFavorites } from "./use-favorites";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetFavorites = vi.mocked(getFavorites);
const mockedGetFavoriteDetails = vi.mocked(getFavoriteDetails);
const mockedSetFavorites = vi.mocked(setFavorites);
const mockedLocalToggleFavorite = vi.mocked(localToggleFavorite);

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

describe("useFavorites", () => {
  describe("anonymous mode", () => {
    beforeEach(() => {
      mockedUseAuth.mockReturnValue({
        user: null,
        isLoggedIn: false,
        isLoading: false,
        favoritesVersion: 0,
        showToast: mockShowToast,
        signOut: vi.fn(),
        deleteAccount: vi.fn(),
      });
    });

    it("delegates to localStorage functions with no fetch calls", () => {
      mockedGetFavorites.mockReturnValue(["course-a"]);
      mockedGetFavoriteDetails.mockReturnValue([
        { id: "course-a", name: "Course A" },
      ]);

      const { result } = renderHook(() => useFavorites());

      expect(result.current.favorites).toEqual(["course-a"]);
      expect(result.current.favoriteDetails).toEqual([
        { id: "course-a", name: "Course A" },
      ]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("toggleFavorite calls localToggleFavorite and updates state", () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      mockedLocalToggleFavorite.mockReturnValue(["course-a"]);
      // After toggle, getFavoriteDetails returns the new state
      mockedGetFavoriteDetails.mockReturnValueOnce([]).mockReturnValue([
        { id: "course-a", name: "Course A" },
      ]);

      const { result } = renderHook(() => useFavorites());

      act(() => {
        result.current.toggleFavorite("course-a", "Course A");
      });

      expect(mockedLocalToggleFavorite).toHaveBeenCalledWith(
        "course-a",
        "Course A"
      );
      expect(result.current.favorites).toEqual(["course-a"]);
    });

    it("isFavorite returns based on current favorites state", () => {
      mockedGetFavorites.mockReturnValue(["course-a"]);
      mockedGetFavoriteDetails.mockReturnValue([
        { id: "course-a", name: "Course A" },
      ]);

      const { result } = renderHook(() => useFavorites());

      expect(result.current.isFavorite("course-a")).toBe(true);
      expect(result.current.isFavorite("course-b")).toBe(false);
    });
  });

  describe("logged-in mode", () => {
    beforeEach(() => {
      mockedUseAuth.mockReturnValue({
        user: { userId: "u1", email: "a@b.com", name: "Sam" },
        isLoggedIn: true,
        isLoading: false,
        favoritesVersion: 0,
        showToast: mockShowToast,
        signOut: vi.fn(),
        deleteAccount: vi.fn(),
      });
    });

    it("reads localStorage instantly then fetches server favorites", async () => {
      mockedGetFavorites.mockReturnValue(["local-a"]);
      mockedGetFavoriteDetails.mockReturnValue([
        { id: "local-a", name: "Local A" },
      ]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          favorites: [
            { courseId: "server-a", courseName: "Server A" },
            { courseId: "server-b", courseName: "Server B" },
          ],
        }),
      });

      const { result } = renderHook(() => useFavorites());

      // Initially shows localStorage data
      expect(result.current.favorites).toEqual(["local-a"]);

      // After server response, updates to server data
      await waitFor(() => {
        expect(result.current.favorites).toEqual(["server-a", "server-b"]);
      });

      expect(result.current.favoriteDetails).toEqual([
        { id: "server-a", name: "Server A" },
        { id: "server-b", name: "Server B" },
      ]);

      // Should have synced server data to localStorage
      expect(mockedSetFavorites).toHaveBeenCalledWith([
        { id: "server-a", name: "Server A" },
        { id: "server-b", name: "Server B" },
      ]);

      expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites");
    });

    it("toggleFavorite adds optimistically and fires POST", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ favorites: [] }),
        })
        .mockResolvedValueOnce({ ok: true });

      const { result } = renderHook(() => useFavorites());

      // Wait for initial server fetch to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites");
      });

      await act(async () => {
        result.current.toggleFavorite("course-a", "Course A");
      });

      // Optimistically added
      expect(result.current.favorites).toContain("course-a");
      expect(mockedSetFavorites).toHaveBeenCalledWith(
        expect.arrayContaining([{ id: "course-a", name: "Course A" }])
      );

      // Fires POST
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites/course-a", {
          method: "POST",
        });
      });
    });

    it("toggleFavorite removes optimistically and fires DELETE", async () => {
      mockedGetFavorites.mockReturnValue(["course-a"]);
      mockedGetFavoriteDetails.mockReturnValue([
        { id: "course-a", name: "Course A" },
      ]);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            favorites: [{ courseId: "course-a", courseName: "Course A" }],
          }),
        })
        .mockResolvedValueOnce({ ok: true });

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favorites).toEqual(["course-a"]);
      });

      await act(async () => {
        result.current.toggleFavorite("course-a", "Course A");
      });

      // Optimistically removed
      expect(result.current.favorites).not.toContain("course-a");

      // Fires DELETE
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites/course-a", {
          method: "DELETE",
        });
      });
    });

    it("toggleFavorite rolls back and shows toast on failure", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ favorites: [] }),
        })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites");
      });

      await act(async () => {
        result.current.toggleFavorite("course-a", "Course A");
      });

      // After failure, should roll back
      await waitFor(() => {
        expect(result.current.favorites).not.toContain("course-a");
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        "Couldn\u2019t save \u2014 try again"
      );

      // localStorage should also be rolled back
      expect(mockedSetFavorites).toHaveBeenLastCalledWith([]);
    });
  });
});
