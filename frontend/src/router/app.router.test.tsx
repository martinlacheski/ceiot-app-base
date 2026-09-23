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
