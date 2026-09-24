import { describe, expect, it } from "vitest";
import { appRouter } from "./app.router";

describe("device history routes", () => {
  it("registers the history list before the dynamic device route", () => {
    const app = appRouter.routes.find((route) => route.path === "/app");
    const devices = app?.children?.find((route) => route.path === "devices");
    expect(devices?.children?.map((route) => route.path)).toEqual(expect.arrayContaining(["history", "history/:serial"]));
    expect(devices?.children?.findIndex((route) => route.path === "history")).toBeLessThan(devices?.children?.findIndex((route) => route.path === ":id") ?? 0);
  });
});

describe("admin device operations route", () => {
  it("registers a distinct admin operations page", () => {
    const admin = appRouter.routes.find((route) => route.path === "/admin");
    const devices = admin?.children?.find((route) => route.path === "devices");
    expect(devices?.children?.some((route) => route.path === ":id/operations")).toBe(true);
  });
});

describe("admin sensor catalog routes", () => {
  it("registers list, create, and edit routes directly under /admin, not under settings", () => {
    const admin = appRouter.routes.find((route) => route.path === "/admin");
    const paths = admin?.children?.map((route) => route.path);
    expect(paths).toEqual(expect.arrayContaining([
      "sensors", "sensors/create", "sensors/edit/:id", "variables", "variables/create", "variables/edit/:id",
    ]));
    expect(admin?.children?.find((route) => route.path === "settings")).toBeUndefined();
  });
});
