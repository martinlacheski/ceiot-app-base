import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EnvironmentSeries } from "./environmentSeries";
import { seriesId, useHiddenSeries } from "./useHiddenSeries";

const make = (deviceId: string, sensorKey: string, index: number): EnvironmentSeries => ({
  key: `s${index}`,
  label: `${deviceId} · ${sensorKey}`,
  deviceId,
  sensorKey,
});

const north = make("device-1", "dht22", 0);
const south = make("device-2", "dht22", 1);
const bmp = make("device-2", "bmp280", 2);

describe("useHiddenSeries", () => {
  it("identifies a series by device and sensor, not by its chart key", () => {
    expect(seriesId(north)).toBe("device-1:dht22");
    const reordered: EnvironmentSeries = { ...north, key: "s7" };
    expect(seriesId(reordered)).toBe(seriesId(north));
  });

  it("toggles series, refuses to hide the last visible one and shows all again", () => {
    const { result } = renderHook(() => useHiddenSeries([north, south]));

    act(() => result.current.toggle(seriesId(north)));
    expect(result.current.hiddenKeys).toEqual(new Set(["s0"]));
    expect(result.current.isHidden(north)).toBe(true);
    expect(result.current.canHide(south)).toBe(false);

    act(() => result.current.toggle(seriesId(south)));
    expect(result.current.hiddenKeys).toEqual(new Set(["s0"]));

    act(() => result.current.showAll());
    expect(result.current.hiddenKeys).toEqual(new Set());
  });

  it("follows the identity when the chart keys of the series change", () => {
    const { result, rerender } = renderHook(({ series }) => useHiddenSeries(series), {
      initialProps: { series: [north, south] },
    });
    act(() => result.current.toggle(seriesId(south)));

    rerender({ series: [{ ...south, key: "s0" }, { ...north, key: "s1" }, bmp] });

    expect(result.current.hiddenKeys).toEqual(new Set(["s0"]));
  });

  it("forgets hidden series that no longer exist", () => {
    const { result, rerender } = renderHook(({ series }) => useHiddenSeries(series), {
      initialProps: { series: [north, south] },
    });
    act(() => result.current.toggle(seriesId(south)));

    rerender({ series: [north, bmp] });
    rerender({ series: [north, south] });

    expect(result.current.hiddenKeys).toEqual(new Set());
  });

  it("keeps the hidden series while the series are temporarily unavailable", () => {
    const { result, rerender } = renderHook(({ series }) => useHiddenSeries(series), {
      initialProps: { series: [north, south] },
    });
    act(() => result.current.toggle(seriesId(south)));

    rerender({ series: [] });
    rerender({ series: [north, south] });

    expect(result.current.hiddenKeys).toEqual(new Set(["s1"]));
  });

  it("shows every series when all the remaining ones were hidden", () => {
    const { result, rerender } = renderHook(({ series }) => useHiddenSeries(series), {
      initialProps: { series: [north, south] },
    });
    act(() => result.current.toggle(seriesId(south)));

    rerender({ series: [south] });

    expect(result.current.hiddenKeys).toEqual(new Set());
    expect(result.current.hiddenCount).toBe(0);
  });
});
