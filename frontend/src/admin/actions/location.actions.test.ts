import { beforeEach, describe, expect, it, vi } from "vitest";

import { appApi } from "@/api/appApi";
import {
  createCityAction,
  createStateAction,
  updateCityAction,
  updateCountryAction,
} from "./location.actions";

vi.mock("@/api/appApi", () => ({
  appApi: {
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

describe("location action write contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends create payloads with backend snake_case keys", async () => {
    await createStateAction({ name: "Mendoza", country_id: "country-1", is_active: true });
    await createCityAction({ name: "Godoy Cruz", postal_code: "5501", state_id: "state-1", is_active: true });

    expect(appApi.post).toHaveBeenNthCalledWith(1, "/location/states/", {
      name: "Mendoza",
      country_id: "country-1",
      is_active: true,
    });
    expect(appApi.post).toHaveBeenNthCalledWith(2, "/location/cities/", {
      name: "Godoy Cruz",
      postal_code: "5501",
      state_id: "state-1",
      is_active: true,
    });
  });

  it("sends update payloads with backend snake_case keys", async () => {
    await updateCountryAction({ id: "country-1", data: { is_active: false } });
    await updateCityAction({
      id: "city-1",
      data: { postal_code: "5501", state_id: "state-1", is_active: false },
    });

    expect(appApi.put).toHaveBeenNthCalledWith(1, "/location/countries/country-1", {
      is_active: false,
    });
    expect(appApi.put).toHaveBeenNthCalledWith(2, "/location/cities/city-1", {
      postal_code: "5501",
      state_id: "state-1",
      is_active: false,
    });
  });
});
