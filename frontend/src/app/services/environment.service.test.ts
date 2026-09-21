import { beforeEach, describe, expect, it, vi } from "vitest";

import { appApi } from "@/api/appApi";
import { environmentService } from "./environment.service";

vi.mock("@/api/appApi", () => ({
  appApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("environmentService environment transport", () => {
  beforeEach(() => {
    vi.mocked(appApi.get).mockReset();
    vi.mocked(appApi.post).mockReset();
    vi.mocked(appApi.put).mockReset();
    vi.mocked(appApi.patch).mockReset();
    vi.mocked(appApi.delete).mockReset();
  });

  it("maps reads without exposing legacy Mercado Pago metadata", async () => {
    vi.mocked(appApi.get).mockResolvedValue({
      data: {
        id: "env-1",
        name: "Sucursal Centro",
        address: "Calle 123",
        location: "-31,-64",
        description: "Principal",
        city_id: "city-1",
        type_id: "type-1",
        is_active: true,
        owner_id: "owner-1",
        mp_country_id: "legacy-country",
        mp_store_status: "failed",
      },
    });

    const result = await environmentService.getById("env-1");

    expect(result).toEqual({
      id: "env-1",
      name: "Sucursal Centro",
      address: "Calle 123",
      location: "-31,-64",
      description: "Principal",
      phone: undefined,
      cityId: "city-1",
      typeId: "type-1",
      isActive: true,
      isPublicMapVisible: false,
      ownerId: "owner-1",
      ownerName: undefined,
      currentUserRole: null,
      canEdit: false,
      canDelete: false,
      type: undefined,
      city: undefined,
    });
    expect(Object.keys(result).some((key) => key.startsWith("mp"))).toBe(false);
  });

  it("serializes create payloads with ordinary fields only", async () => {
    vi.mocked(appApi.post).mockResolvedValue({ data: {
      id: "env-1",
      name: "Sucursal Centro",
      address: "Calle 123",
      location: "-31,-64",
      description: "Principal",
      city_id: "city-1",
      type_id: "type-1",
      is_active: true,
    } });

    await environmentService.create({
      name: "Sucursal Centro",
      address: "Calle 123",
      location: "-31,-64",
      description: "Principal",
      cityId: "city-1",
      typeId: "type-1",
      phone: "+5493764000000",
    });

    expect(appApi.post).toHaveBeenCalledWith("/environment/", {
      name: "Sucursal Centro",
      address: "Calle 123",
      location: "-31,-64",
      description: "Principal",
      cityId: "city-1",
      typeId: "type-1",
      phone: "+5493764000000",
    });
  });

  it("serializes server-side sorting with the environment list filters", async () => {
    vi.mocked(appApi.get).mockResolvedValue({ data: { items: [] } });

    await environmentService.getAll({
      page: 3,
      perPage: 25,
      isActive: false,
      typeId: "type-1",
      sortBy: "owner",
      sortOrder: "desc",
    });

    const request = vi.mocked(appApi.get).mock.calls[0];
    expect(request[0]).toBe("/environment/");
    expect(request[1]?.params.toString()).toBe(
      "page=3&per_page=25&is_active=false&type_id=type-1&sort_by=owner&sort_order=desc",
    );
  });

  it("maps invitation list responses from backend payloads", async () => {
    vi.mocked(appApi.get).mockResolvedValue({
      data: [
        {
          id: "inv-1",
          email: "guest@example.com",
          firstName: null,
          lastName: null,
          status: "Pendiente",
          scope_type: "environment",
          scope_id: "env-1",
          owner_user_id: "owner-1",
          commission_rate: 0.125,
          access_starts_at: "2026-05-27T00:00:00",
          is_active: true,
        },
      ],
    });

    const result = await environmentService.listInvitations("env-1");

    expect(result).toEqual({
      items: [
        {
          id: "inv-1",
          email: "guest@example.com",
          firstName: null,
          lastName: null,
          status: "Pendiente",
          scopeType: "environment",
          environmentId: "env-1",
          ownerId: "owner-1",
          accessStartsAt: "2026-05-27T00:00:00",
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      perPage: 20,
      pages: 1,
    });
  });

  it("sends scoped environment invitations with recipient and access start date only", async () => {
    vi.mocked(appApi.post).mockResolvedValue({
      data: {
        id: "inv-1",
        email: "guest@example.com",
        status: "pending",
        scope_id: "env-1",
        owner_user_id: "owner-1",
        commission_rate: 0.15,
        access_starts_at: "2026-05-27T00:00:00",
        is_active: true,
      },
    });

    await Reflect.apply(environmentService.sendInvitation, environmentService, [
      "env-1",
      { email: "guest@example.com", accessStartsAt: "2026-05-27T14:35:00" },
    ]);

    expect(appApi.post).toHaveBeenCalledWith(
      "/access/scopes/environment/env-1/guest-invitations",
      {
        email: "guest@example.com",
        access_starts_at: "2026-05-27T14:35:00",
      },
    );
  });

  it("does not emit an access date when a pending invitation date is unchanged", async () => {
    vi.mocked(appApi.patch).mockResolvedValue({
      data: {
        id: "inv-1",
        email: "guest@example.com",
        status: "pending",
        scope_type: "environment",
        scope_id: "env-1",
        owner_user_id: "owner-1",
        access_starts_at: "2026-05-27T00:00:00",
        is_active: true,
      },
    });

    await environmentService.updateInvitation("env-1", "inv-1", {});

    expect(appApi.patch).toHaveBeenCalledWith(
      "/access/scopes/environment/env-1/guest-invitations/inv-1",
      {},
    );
  });

  it("updates pending scoped environment invitations", async () => {
    vi.mocked(appApi.patch).mockResolvedValue({
      data: {
        id: "inv-1",
        email: "guest@example.com",
        status: "pending",
        scope_type: "environment",
        scope_id: "env-1",
        owner_user_id: "owner-1",
        commission_rate: 0.18,
        access_starts_at: "2026-05-28T00:00:00",
        is_active: true,
      },
    });

    const result = await Reflect.apply(environmentService.updateInvitation, environmentService, [
      "env-1",
      "inv-1",
      { accessStartsAt: "2026-05-28T10:30:00" },
    ]);

    expect(appApi.patch).toHaveBeenCalledWith(
      "/access/scopes/environment/env-1/guest-invitations/inv-1",
      { access_starts_at: "2026-05-28T10:30:00" },
    );
    expect(result.scopeType).toBe("environment");
    expect(result.accessStartsAt).toBe("2026-05-28T00:00:00");
    expect(result).not.toHaveProperty("commissionRate");
  });
});
