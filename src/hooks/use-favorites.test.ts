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

    it("populates from localStorage after mount", async () => {
      mockedGetFavorites.mockReturnValue(["course-a"]);
      mockedGetFavoriteDetails.mockReturnValue([
        { id: "course-a", name: "Course A" },
      ]);

      const { result } = renderHook(() => useFavorites());

      // After effects run, should have localStorage data
      await waitFor(() => {
        expect(result.current.favorites).toEqual(["course-a"]);
      });
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

    it("mergeFavorites adds new courses to localStorage", async () => {
      mockedGetFavorites.mockReturnValue(["existing"]);
      mockedGetFavoriteDetails
        .mockReturnValueOnce([{ id: "existing", name: "Existing" }])
        .mockReturnValue([
          { id: "existing", name: "Existing" },
          { id: "new-a", name: "New A" },
          { id: "new-b", name: "New B" },
        ]);

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favorites).toContain("existing");
      });

      await act(async () => {
        await result.current.mergeFavorites([
          { id: "new-a", name: "New A" },
          { id: "new-b", name: "New B" },
        ]);
      });

      expect(mockedSetFavorites).toHaveBeenCalled();
      expect(result.current.favorites).toContain("new-a");
      expect(result.current.favorites).toContain("new-b");
      expect(result.current.favorites).toContain("existing");
    });

    it("mergeFavorites skips duplicates", async () => {
      mockedGetFavorites.mockReturnValue(["existing"]);
      mockedGetFavoriteDetails.mockReturnValue([
        { id: "existing", name: "Existing" },
      ]);

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favorites).toContain("existing");
      });

      await act(async () => {
        await result.current.mergeFavorites([
          { id: "existing", name: "Existing" },
        ]);
      });

      // Should not duplicate
      expect(result.current.favorites.filter((id: string) => id === "existing")).toHaveLength(1);
    });

    it("exposes favoritesReady as true after mount (anonymous)", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favoritesReady).toBe(true);
      });
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

    it("mergeFavorites calls server merge endpoint for logged-in users", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      // Initial server fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ favorites: [] }),
      });
      // Merge endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ merged: 2, total: 2 }),
      });

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites");
      });

      await act(async () => {
        await result.current.mergeFavorites([
          { id: "course-a", name: "Course A" },
          { id: "course-b", name: "Course B" },
        ]);
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: ["course-a", "course-b"] }),
      });
    });

    it("favoritesReady is false until server fetch completes", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);

      // Use a manually-resolved promise to control fetch timing
      let resolveFetch!: (value: unknown) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });
      mockFetch.mockReturnValueOnce(fetchPromise);

      const { result } = renderHook(() => useFavorites());

      // Before fetch resolves, favoritesReady must still be false
      expect(result.current.favoritesReady).toBe(false);

      // Resolve the fetch
      await act(async () => {
        resolveFetch({
          ok: true,
          json: async () => ({ favorites: [] }),
        });
      });

      // Now favoritesReady should be true
      expect(result.current.favoritesReady).toBe(true);
    });

    it("favoritesReady becomes true even when server fetch returns non-ok", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favoritesReady).toBe(true);
      });
    });

    it("favoritesReady becomes true when server fetch throws", async () => {
      mockedGetFavorites.mockReturnValue([]);
      mockedGetFavoriteDetails.mockReturnValue([]);
      mockFetch.mockRejectedValueOnce(new Error("network failure"));

      const { result } = renderHook(() => useFavorites());

      await waitFor(() => {
        expect(result.current.favoritesReady).toBe(true);
      });
    });
  });
});
