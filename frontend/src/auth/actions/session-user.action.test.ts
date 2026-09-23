import { describe, expect, it, vi, beforeEach } from "vitest";
import { appApi } from "@/api/appApi";
import { loginAction } from "./login.action";
import { checkAuthAction } from "./check-auth.action";

vi.mock("@/api/appApi", () => ({
  appApi: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Real /auth/login and /auth/check-status shape: identity lives only in the
// nested camelCase `user`; there are no flattened top-level fields.
const sessionPayload = {
  access_token: "header.eyJleHAiOjk5OTk5OTk5OTl9.sig",
  token_type: "bearer",
  expires_at: "2099-01-01T00:00:00Z",
  user: {
    id: "u-1",
    email: "test@example.com",
    username: "testuser",
    firstName: "Test",
    lastName: "User",
    identificationNumber: "TESTUSER123",
    birthDate: "1990-05-10",
    phone: "+54 376 1234567",
    isActive: true,
    isAdmin: false,
    permissions: [],
  },
};

const expectIdentityPreserved = (user: Record<string, unknown>) => {
  expect(user.firstName).toBe("Test");
  expect(user.lastName).toBe("User");
  expect(user.fullName).toBe("Test User");
  expect(user.identificationNumber).toBe("TESTUSER123");
  expect(user.birthDate).toBe("1990-05-10");
  expect(user.phone).toBe("+54 376 1234567");
};

describe("session user mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("token", sessionPayload.access_token);
  });

  it("loginAction keeps the nested user's identity fields", async () => {
    vi.mocked(appApi.post).mockResolvedValue({ data: sessionPayload });

    const result = await loginAction("testuser", "testpassword");

    expect(result.token).toBe(sessionPayload.access_token);
    expectIdentityPreserved(result.user as unknown as Record<string, unknown>);
  });

  it("checkAuthAction keeps the nested user's identity fields", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: sessionPayload });

    const result = await checkAuthAction();

    expectIdentityPreserved(result.user as unknown as Record<string, unknown>);
  });
});
