import { describe, expect, it } from "vitest";

import { profileSchema } from "./profile.schema";

describe("profileSchema", () => {
  it("keeps generic identity fields and strips obsolete fiscal input", () => {
    const result = profileSchema.parse({
      email: "user@example.com",
      username: "user",
      firstName: "Ada",
      lastName: "Lovelace",
      identificationTypeId: "dni",
      identificationNumber: "12345678",
      taxTypeId: "obsolete",
    });

    expect(result.identificationTypeId).toBe("dni");
    expect(result).not.toHaveProperty("taxTypeId");
  });
});
