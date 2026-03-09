// @vitest-environment jsdom
// ABOUTME: Tests for AuthProvider context.
// ABOUTME: Covers login detection, post-login merge, sign-out, and account deletion.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth-provider";

vi.mock("@/lib/favorites", () => ({
  getFavorites: vi.fn().mockReturnValue([]),
  getFavoriteDetails: vi.fn().mockReturnValue([]),
  setFavorites: vi.fn(),
}));

import { getFavorites, setFavorites } from "@/lib/favorites";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function TestConsumer() {
  const { user, isLoggedIn, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="logged-in">{String(isLoggedIn)}</span>
      <span data-testid="user">{user ? JSON.stringify(user) : "null"}</span>
    </div>
  );
}

function SignOutConsumer() {
  const { signOut, isLoggedIn } = useAuth();
  return (
    <div>
      <span data-testid="logged-in">{String(isLoggedIn)}</span>
      <button data-testid="sign-out" onClick={() => signOut()}>
        Sign Out
      </button>
    </div>
  );
}

function DeleteAccountConsumer() {
  const { deleteAccount, isLoggedIn } = useAuth();
  return (
    <div>
      <span data-testid="logged-in">{String(isLoggedIn)}</span>
      <button data-testid="delete" onClick={() => deleteAccount()}>
        Delete
      </button>
    </div>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(getFavorites).mockReturnValue([]);
  vi.mocked(setFavorites).mockClear();
  // Reset location to default
  Object.defineProperty(window, "location", {
    value: {
      ...window.location,
      search: "",
      href: "http://localhost/",
      pathname: "/",
    },
    writable: true,
    configurable: true,
  });
});

describe("AuthProvider", () => {
  it("sets user and isLoggedIn on successful /me fetch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          userId: "u1",
          email: "test@example.com",
          name: "Test",
        }),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("true");
    });
    expect(screen.getByTestId("user").textContent).toContain("u1");
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/me");
  });

  it("sets isLoggedIn false on 401 from /me", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("logged-in").textContent).toBe("false");
    expect(screen.getByTestId("user").textContent).toBe("null");
  });

  it("signOut calls POST /api/auth/logout and clears user", async () => {
    // First call: /me succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          userId: "u1",
          email: "test@example.com",
          name: "Test",
        }),
    });

    render(
      <AuthProvider>
        <SignOutConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("true");
    });

    // Set up logout response
    mockFetch.mockResolvedValueOnce({ ok: true });

    fireEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("false");
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
  });

  it("deleteAccount calls DELETE /api/user/account, clears favorites, and clears user", async () => {
    // /me succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          userId: "u1",
          email: "test@example.com",
          name: "Test",
        }),
    });

    // Capture location.href assignment
    const locationAssignments: string[] = [];
    Object.defineProperty(window, "location", {
      value: new Proxy(window.location, {
        set(_target, prop, value) {
          if (prop === "href") locationAssignments.push(value);
          return true;
        },
        get(target, prop) {
          if (prop === "search") return "";
          if (prop === "href") return "http://localhost/";
          if (prop === "pathname") return "/";
          return Reflect.get(target, prop);
        },
      }),
      writable: true,
      configurable: true,
    });

    render(
      <AuthProvider>
        <DeleteAccountConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("true");
    });

    // Set up delete response
    mockFetch.mockResolvedValueOnce({ ok: true });

    fireEvent.click(screen.getByTestId("delete"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/user/account", {
        method: "DELETE",
      });
    });
    expect(setFavorites).toHaveBeenCalledWith([]);
    expect(locationAssignments).toContain("/");
  });

  it("merges favorites on justSignedIn when localStorage has favorites", async () => {
    vi.mocked(getFavorites).mockReturnValue(["c1", "c2"]);

    Object.defineProperty(window, "location", {
      value: {
        ...window.location,
        search: "?justSignedIn=true",
        href: "http://localhost/?justSignedIn=true",
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    const replaceStateSpy = vi.spyOn(history, "replaceState");

    // /me succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          userId: "u1",
          email: "test@example.com",
          name: "Test",
        }),
    });

    // merge response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ merged: 2 }),
    });

    // GET favorites response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          favorites: [
            { courseId: "c1", courseName: "Course 1" },
            { courseId: "c2", courseName: "Course 2" },
          ],
        }),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: ["c1", "c2"] }),
      });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/user/favorites");
    });

    expect(setFavorites).toHaveBeenCalledWith([
      { id: "c1", name: "Course 1" },
      { id: "c2", name: "Course 2" },
    ]);

    // Toast should be shown
    await waitFor(() => {
      expect(
        screen.getByText("Synced 2 favorites from this device")
      ).toBeTruthy();
    });

    expect(replaceStateSpy).toHaveBeenCalled();
    replaceStateSpy.mockRestore();
  });

  it("skips merge on justSignedIn when localStorage is empty", async () => {
    vi.mocked(getFavorites).mockReturnValue([]);

    Object.defineProperty(window, "location", {
      value: {
        ...window.location,
        search: "?justSignedIn=true",
        href: "http://localhost/?justSignedIn=true",
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    const replaceStateSpy = vi.spyOn(history, "replaceState");

    // /me succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          userId: "u1",
          email: "test@example.com",
          name: "Test",
        }),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("true");
    });

    // merge should NOT have been called
    expect(mockFetch).not.toHaveBeenCalledWith(
      "/api/user/favorites/merge",
      expect.anything()
    );

    // URL should still be cleaned
    expect(replaceStateSpy).toHaveBeenCalled();
    replaceStateSpy.mockRestore();
  });

  it("strips justSignedIn param from URL via history.replaceState", async () => {
    Object.defineProperty(window, "location", {
      value: {
        ...window.location,
        search: "?justSignedIn=true&other=keep",
        href: "http://localhost/?justSignedIn=true&other=keep",
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    const replaceStateSpy = vi.spyOn(history, "replaceState");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          userId: "u1",
          email: "test@example.com",
          name: "Test",
        }),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(replaceStateSpy).toHaveBeenCalled();
    });

    const lastCall =
      replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1];
    const replacedUrl = lastCall[2] as string;
    expect(replacedUrl).not.toContain("justSignedIn");
    expect(replacedUrl).toContain("other=keep");

    replaceStateSpy.mockRestore();
  });
});
