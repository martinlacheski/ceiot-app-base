import { beforeEach, describe, expect, it, vi } from "vitest";

import { appApi } from "@/api/appApi";

import {
  deviceService,
  mapDeviceAccessContext,
  mapDeviceOperation,
} from "./device.service";

const downloadReportMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/appApi", () => ({
  appApi: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock("@/lib/downloadReport", () => ({
  downloadReport: downloadReportMock,
  toFilenamePart: (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, "_"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deviceService.getAll", () => {
  it("serializes active server sorting", async () => {
    vi.mocked(appApi.get).mockResolvedValue({
      data: { items: [], total: 0, pages: 0, page: 1, perPage: 20 },
    });

    await deviceService.getAll({
      page: 1,
      perPage: 20,
      sortBy: "lastConnection",
      sortOrder: "desc",
    });

    const config = vi.mocked(appApi.get).mock.calls[0][1] as {
      params: URLSearchParams;
    };
    expect(config.params.get("sort_by")).toBe("lastConnection");
    expect(config.params.get("sort_order")).toBe("desc");
  });

  it("sends the local UTC offset for search and manufacture-date filters", async () => {
    vi.mocked(appApi.get).mockResolvedValue({
      data: { items: [], total: 0, pages: 0, page: 1, perPage: 20 },
    });
    const offset = -new Date().getTimezoneOffset();

    await deviceService.getAll({
      page: 1,
      perPage: 20,
      search: "23/09/2026",
      manufactureDate: "2026-09-23",
      sortBy: "name",
      sortOrder: "asc",
    });

    const config = vi.mocked(appApi.get).mock.calls[0][1] as {
      params: URLSearchParams;
    };
    expect(config.params.get("utc_offset_minutes")).toBe(String(offset));
  });

  it("exports every server page with the active filters and sort", async () => {
    vi.mocked(appApi.get)
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "first", serial: "A", name: "First", status: "paired", isActive: true }],
          total: 10001,
          pages: 2,
          page: 1,
          perPage: 10000,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "last", serial: "Z", name: "Last", status: "maintenance", isActive: false }],
          total: 10001,
          pages: 2,
          page: 2,
          perPage: 10000,
        },
      });

    await deviceService.export(
      "excel",
      {
        page: 9,
        perPage: 10,
        search: "visible",
        sortBy: "serial",
        sortOrder: "desc",
      },
      { generatedBy: "Tester" },
    );

    expect(appApi.get).toHaveBeenCalledTimes(2);
    const secondParams = (vi.mocked(appApi.get).mock.calls[1][1] as {
      params: URLSearchParams;
    }).params;
    expect(Object.fromEntries(secondParams)).toMatchObject({
      page: "2",
      per_page: "10000",
      search: "visible",
      sort_by: "serial",
      sort_order: "desc",
    });
    expect(downloadReportMock).toHaveBeenCalledWith(
      "excel",
      expect.objectContaining({ data: expect.arrayContaining([expect.arrayContaining(["A"]), expect.arrayContaining(["Z"])]) }),
    );
    const report = downloadReportMock.mock.calls[0][1] as { columns: string[]; data: string[][] };
    const situationIndex = report.columns.indexOf("Situación");
    const stateIndex = report.columns.indexOf("Estado");
    expect(situationIndex).toBeGreaterThan(-1);
    expect(report.data.map((row) => row[situationIndex])).toEqual(["VINCULADO", "MANTENIMIENTO"]);
    expect(report.data.map((row) => row[stateIndex])).toEqual(["Activo", "Inactivo"]);
  });
});

describe("deviceService.getOperations", () => {
  it("serializes server search, date range, sorting, and UTC offset", async () => {
    vi.mocked(appApi.get).mockResolvedValue({
      data: { items: [], total: 0, pages: 0, page: 1, per_page: 20 },
    });

    await deviceService.getOperations("device-1", {
      page: 2,
      perPage: 20,
      search: "23/09/2026",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-09-23T23:59:59.000Z"),
      sortBy: "operation_type",
      sortOrder: "asc",
    });

    const config = vi.mocked(appApi.get).mock.calls[0][1] as {
      params: URLSearchParams;
    };
    expect(Object.fromEntries(config.params)).toMatchObject({
      page: "2",
      per_page: "20",
      search: "23/09/2026",
      sort_by: "operation_type",
      sort_order: "asc",
      utc_offset_minutes: String(-new Date().getTimezoneOffset()),
    });
  });

  it("exports all matching operation pages", async () => {
    vi.mocked(appApi.get)
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "first", time: "2026-09-01T00:00:00Z", operation_type: "SENSOR_DATA", status: "success" }],
          total: 10001,
          pages: 2,
          page: 1,
          per_page: 10000,
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "last", time: "2026-09-02T00:00:00Z", operation_type: "KEEP_ACTIVE", status: "failed" }],
          total: 10001,
          pages: 2,
          page: 2,
          per_page: 10000,
        },
      });

    await deviceService.exportOperations(
      "device-1",
      "Device One",
      "pdf",
      {
        page: 1,
        perPage: 20,
        search: "ok",
        sortBy: "id",
        sortOrder: "asc",
      },
    );

    expect(appApi.get).toHaveBeenCalledTimes(2);
    expect(downloadReportMock).toHaveBeenCalledWith(
      "pdf",
      expect.objectContaining({
        filename: "operaciones_Device_One",
        data: expect.arrayContaining([
          expect.arrayContaining(["first"]),
          expect.arrayContaining(["last"]),
        ]),
      }),
    );
    const exportedRows = downloadReportMock.mock.calls[0][1].data as string[][];
    expect(exportedRows.map((row) => row.slice(-2))).toEqual([
      ["Datos de sensores", "Exitoso"],
      ["Dispositivo activo", "Fallido"],
    ]);
  });
});

describe("deviceService.pair", () => {
  it("posts the generic pairing contract", async () => {
    vi.mocked(appApi.post).mockResolvedValue({
      data: {
        id: "device-1",
        serial: "IOT-1234-5678",
        name: "Pair Device",
        deviceTypeId: "type-1",
        status: "paired",
        isActive: true,
        enabled: true,
        brokerConnected: false,
      },
    });

    await deviceService.pair({
      serial: "IOT-1234-5678",
      environmentId: "env-1",
      description: "Agua caliente",
    });

    expect(appApi.post).toHaveBeenCalledWith("/devices/pair", {
      serial: "IOT-1234-5678",
      environmentId: "env-1",
      description: "Agua caliente",
    });
  });
});

describe("mapDeviceOperation", () => {
  it("maps only generic operation fields", () => {
    const result = mapDeviceOperation({
      time: "2026-03-06T12:00:00Z",
      id: "evt-1",
      device_serial: "IOT-1000",
      operation_type: "SENSOR_DATA",
      status: "success",
    });

    expect(result).toEqual({
      time: "2026-03-06T12:00:00Z",
      id: "evt-1",
      device_serial: "IOT-1000",
      operation_type: "SENSOR_DATA",
      status: "success",
    });
    expect("device_id" in result).toBe(false);
    expect("payload" in result).toBe(false);
    expect("response" in result).toBe(false);
  });

  it("ignores legacy raw and financial operation fields from backend payloads", () => {
    const legacyFields = {
      device_id: "legacy-device-id",
      payload: { qr_data: "raw-payload" },
      response: { body: "raw-response" },
      payment_id: "1234567890",
      provider_payment_id: "PAY01-ABC",
      qr_order_id: "QR-9988",
      merchant_order_id: "ORD-1001",
      payment_amount: 1500,
      payment_method: "visa",
      payment_type_id: "credit_card",
      payment_status: "approved",
      payment_status_detail: "accredited",
      payment_date: "2026-03-06T12:01:00Z",
    };
    const result = mapDeviceOperation({
      time: "2026-03-06T12:00:00Z",
      id: "evt-raw",
      device_serial: "IOT-1001",
      operation_type: "KEEP_ACTIVE",
      status: "success",
      ...legacyFields,
    });

    expect(result).toEqual({
      time: "2026-03-06T12:00:00Z",
      id: "evt-raw",
      device_serial: "IOT-1001",
      operation_type: "KEEP_ACTIVE",
      status: "success",
    });
  });

  it("maps effective guest context without reviving stale financial fields", () => {
    const result = mapDeviceAccessContext({
      device_id: "device-1",
      environment_id: "env-1",
      owner_user_id: "owner-1",
      actor_user_id: "owner-1",
      is_owner: true,
      is_guest: false,
      can_read_movements: true,
      can_manage_guests: true,
      can_operate_device: true,
      ...{ effective_dvem_rate: 0.08, effective_guest_rate: 0.3 },
      guests: [
        {
          guest_user_id: "guest-1",
          ...{ commission_rate: 0.12 },
          access_starts_at: "2026-05-27T00:00:00",
          source_scope: "device",
        },
      ],
    });

    expect(result).toEqual({
      deviceId: "device-1",
      environmentId: "env-1",
      ownerUserId: "owner-1",
      actorUserId: "owner-1",
      isOwner: true,
      isGuest: false,
      canReadMovements: true,
      canManageGuests: true,
      canOperateDevice: true,
      guests: [
        {
          guestUserId: "guest-1",
          email: null,
          firstName: null,
          lastName: null,
          phone: null,
          accessStartsAt: "2026-05-27T00:00:00",
          sourceScope: "device",
        },
      ],
      pendingInvitations: [],
    });
  });

  it("creates direct guest relations without a rate in either request or response", async () => {
    vi.mocked(appApi.post).mockResolvedValue({
      data: {
        id: "relation-1",
        owner_user_id: "owner-1",
        guest_user_id: "guest-1",
        scope_type: "device",
        scope_id: "device-1",
        commission_rate: 0.4,
        access_starts_at: "2026-05-27T00:00:00",
        is_active: true,
      },
    });

    const result = await deviceService.createGuestRelation("device-1", {
      guestUserId: "guest-1",
      accessStartsAt: "2026-05-27T14:35:00",
    });

    expect(appApi.post).toHaveBeenCalledWith("/devices/device-1/guests", {
      guest_user_id: "guest-1",
      access_starts_at: "2026-05-27T14:35:00",
    });
    expect(result).toEqual({
      id: "relation-1",
      ownerUserId: "owner-1",
      guestUserId: "guest-1",
      scopeType: "device",
      scopeId: "device-1",
      accessStartsAt: "2026-05-27T00:00:00",
      isActive: true,
    });
  });

  it("sends device guest invitations with recipient and access date only", async () => {
    vi.mocked(appApi.post).mockResolvedValue({
      data: {
        id: "inv-1",
        owner_user_id: "owner-1",
        email: "future-device-guest@example.com",
        scope_type: "device",
        scope_id: "device-1",
        commission_rate: 0.155,
        access_starts_at: "2026-05-27T00:00:00",
        status: "pending",
        is_active: true,
      },
    });

    const result = await Reflect.apply(
      deviceService.inviteGuestByEmail,
      deviceService,
      [
        "device-1",
        {
          email: "future-device-guest@example.com",
          accessStartsAt: "2026-05-27T14:35:00",
        },
      ],
    );

    expect(appApi.post).toHaveBeenCalledWith(
      "/devices/device-1/guest-invitations",
      {
        email: "future-device-guest@example.com",
        access_starts_at: "2026-05-27T14:35:00",
      },
    );
    expect(result).toEqual({
      id: "inv-1",
      ownerUserId: "owner-1",
      email: "future-device-guest@example.com",
      scopeType: "device",
      scopeId: "device-1",
      accessStartsAt: "2026-05-27T00:00:00",
      status: "pending",
      isActive: true,
    });
  });

  it("revokes pending device guest invitations", async () => {
    vi.mocked(appApi.delete).mockResolvedValue({
      data: {
        id: "inv-1",
        owner_user_id: "owner-1",
        email: "future-device-guest@example.com",
        scope_type: "device",
        scope_id: "device-1",
        commission_rate: 0.155,
        access_starts_at: "2026-05-27T00:00:00",
        status: "revoked",
        is_active: false,
      },
    });

    const result = await deviceService.revokeGuestInvitation(
      "device-1",
      "inv-1",
    );

    expect(appApi.delete).toHaveBeenCalledWith(
      "/devices/device-1/guest-invitations/inv-1",
    );
    expect(result).toEqual({
      id: "inv-1",
      ownerUserId: "owner-1",
      email: "future-device-guest@example.com",
      scopeType: "device",
      scopeId: "device-1",
      accessStartsAt: "2026-05-27T00:00:00",
      status: "revoked",
      isActive: false,
    });
  });

  it("does not emit an access date when a pending invitation date is unchanged", async () => {
    vi.mocked(appApi.patch).mockResolvedValue({
      data: {
        id: "inv-1",
        owner_user_id: "owner-1",
        email: "future-device-guest@example.com",
        scope_type: "device",
        scope_id: "device-1",
        access_starts_at: "2026-05-27T00:00:00",
        status: "pending",
        is_active: true,
      },
    });

    await deviceService.updateGuestInvitation("device-1", "inv-1", {});

    expect(appApi.patch).toHaveBeenCalledWith(
      "/devices/device-1/guest-invitations/inv-1",
      {},
    );
  });

  it("updates pending device guest invitations", async () => {
    vi.mocked(appApi.patch).mockResolvedValue({
      data: {
        id: "inv-1",
        owner_user_id: "owner-1",
        email: "future-device-guest@example.com",
        scope_type: "device",
        scope_id: "device-1",
        commission_rate: 0.18,
        access_starts_at: "2026-05-28T00:00:00",
        status: "pending",
        is_active: true,
      },
    });

    const result = await Reflect.apply(
      deviceService.updateGuestInvitation,
      deviceService,
      ["device-1", "inv-1", { accessStartsAt: "2026-05-28T10:30:00" }],
    );

    expect(appApi.patch).toHaveBeenCalledWith(
      "/devices/device-1/guest-invitations/inv-1",
      { access_starts_at: "2026-05-28T10:30:00" },
    );
    expect(result).toMatchObject({
      id: "inv-1",
      scopeType: "device",
      accessStartsAt: "2026-05-28T00:00:00",
    });
    expect(result).not.toHaveProperty("commissionRate");
  });
});
