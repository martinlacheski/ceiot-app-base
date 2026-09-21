import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, JSX } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DateRangePicker } from "./date-range-picker";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

const setViewport = (width: number, height = 768): void => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
};

const renderPicker = ({
  width,
  height,
  mobileLayout = false,
  onUpdate,
  showCompare = false,
}: {
  width: number;
  height?: number;
  mobileLayout?: boolean;
  onUpdate?: ComponentProps<typeof DateRangePicker>["onUpdate"];
  showCompare?: boolean;
}): void => {
  setViewport(width, height);
  render(
    <DateRangePicker
      initialDateFrom={new Date(2026, 5, 1)}
      initialDateTo={new Date(2026, 5, 15)}
      mobileLayout={mobileLayout}
      showCompare={showCompare}
      onUpdate={onUpdate}
    />,
  );
};

const openPicker = (): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: /jun/i }));
  return screen.getByRole("button", { name: "Actualizar" }).closest<HTMLElement>(
    '[data-slot="popover-content"], [role="dialog"]',
  )!;
};

const openBoundary = (testId: string): HTMLElement => {
  fireEvent.click(screen.getByTestId(testId));
  const contents = document.querySelectorAll<HTMLElement>('[data-slot="popover-content"]');
  return contents[contents.length - 1];
};

const navigateCalendar = (calendar: HTMLElement, times: number): void => {
  for (let index = 0; index < times; index += 1) {
    fireEvent.click(
      within(calendar).getAllByRole("button", { name: "Go to the Next Month" })[0],
    );
  }
};

const selectDay = (calendar: HTMLElement, day: string): void => {
  const button = within(calendar)
    .getAllByRole("button")
    .find((candidate) => candidate.textContent === day);
  fireEvent.click(button!);
};

describe.each([
  { name: "mobile dialog", width: 375, mobileLayout: true },
  { name: "desktop popover", width: 1200, mobileLayout: false },
])("DateRangePicker independent boundaries in the $name", ({ width, mobileLayout }) => {
  it("selects custom From and To dates after multi-month navigation without closing the parent", () => {
    renderPicker({ width, mobileLayout });
    const parent = openPicker();

    const fromCalendar = openBoundary("date-boundary-from");
    expect(parent).toContainElement(fromCalendar);
    navigateCalendar(fromCalendar, 2);
    selectDay(fromCalendar, "20");
    expect(fromCalendar).not.toBeInTheDocument();
    expect(parent).toBeInTheDocument();
    expect(screen.getByTestId("date-boundary-from")).toHaveAccessibleName(/20 ago/i);
    expect(screen.getByTestId("date-boundary-to")).toHaveAccessibleName(/20 ago/i);

    const toCalendar = openBoundary("date-boundary-to");
    expect(parent).toContainElement(toCalendar);
    navigateCalendar(toCalendar, 1);
    selectDay(toCalendar, "10");
    expect(toCalendar).not.toBeInTheDocument();
    expect(parent).toBeInTheDocument();
    expect(screen.getByTestId("date-boundary-to")).toHaveAccessibleName(/10 sep/i);
  });

  it("closes the child on Escape before the parent", () => {
    renderPicker({ width, mobileLayout });
    const parent = openPicker();
    const child = openBoundary("date-boundary-from");

    fireEvent.keyDown(child, { key: "Escape" });
    expect(child).not.toBeInTheDocument();
    expect(parent).toBeInTheDocument();

    fireEvent.keyDown(parent, { key: "Escape" });
    expect(parent).not.toBeInTheDocument();
  });

  it("keeps the child open across a parent rerender and viewport resize", () => {
    const Harness = ({ revision }: { revision: number }): JSX.Element => {
      return (
        <div data-revision={revision}>
          <DateRangePicker
            initialDateFrom={new Date(2026, 5, 1)}
            initialDateTo={new Date(2026, 5, 15)}
            mobileLayout={mobileLayout}
            showCompare={false}
          />
        </div>
      );
    };

    setViewport(width);
    const { rerender } = render(<Harness revision={0} />);
    const parent = openPicker();
    const child = openBoundary("date-boundary-from");

    rerender(<Harness revision={1} />);
    expect(child).toBeInTheDocument();
    expect(parent).toContainElement(child);

    setViewport(width === 1200 ? 900 : 500);
    fireEvent(window, new Event("resize"));
    expect(child).toBeInTheDocument();
    expect(parent).toContainElement(child);
  });
});

describe.each([
  { name: "portrait dialog", width: 375, height: 667, mobileLayout: true },
  { name: "short landscape dialog", width: 855, height: 419, mobileLayout: true },
  { name: "desktop popover", width: 1200, height: 800, mobileLayout: false },
])(
  "DateRangePicker shared chrome in the $name",
  ({ width, height, mobileLayout }) => {
    it("shows one visible heading and consistent footer actions", () => {
      renderPicker({ width, height, mobileLayout });
      const parent = openPicker();
      const cancel = within(parent).getByRole("button", { name: "Cancelar" });
      const update = within(parent).getByRole("button", { name: "Actualizar" });
      const footer = cancel.parentElement!;

      expect(
        within(parent).getAllByRole("heading", {
          name: "Seleccionar rango de fechas",
        }),
      ).toHaveLength(1);
      expect(footer).not.toHaveClass("border-t");
      expect(cancel).toHaveClass(
        "border",
        "hover:bg-accent",
        "hover:text-accent-foreground",
        "active:bg-accent",
        "active:text-accent-foreground",
        "focus-visible:border-ring",
        "focus-visible:ring-ring/50",
        "focus-visible:ring-[3px]",
      );
      expect(update).toHaveClass("bg-primary");
      expect(update).not.toHaveClass("border");
    });
  },
);

describe("DateRangePicker preserved behavior", () => {
  it("keeps the central range calendar and presets available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 12));
    renderPicker({ width: 375, mobileLayout: true });
    const parent = openPicker();

    expect(parent.querySelectorAll('[data-slot="calendar"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Últimos 30 días" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Últimos 30 días");
    expect(parent).toBeInTheDocument();

    const central = parent.querySelector<HTMLElement>('[data-slot="calendar"]')!;
    selectDay(central, "5");
    expect(screen.getByTestId("date-boundary-from")).toHaveAccessibleName(/5 dic/i);
  });

  it("keeps comparison boundaries independent and ordered", () => {
    renderPicker({ width: 375, mobileLayout: true, showCompare: true });
    const parent = openPicker();
    fireEvent.click(screen.getByRole("switch", { name: "Comparar" }));

    const compareFrom = openBoundary("compare-date-boundary-from");
    expect(parent).toContainElement(compareFrom);
    navigateCalendar(compareFrom, 1);
    selectDay(compareFrom, "20");
    expect(screen.getByTestId("compare-date-boundary-from")).toHaveAccessibleName(/20 jul/i);
    expect(screen.getByTestId("compare-date-boundary-to")).toHaveAccessibleName(/20 jul/i);

    const compareTo = openBoundary("compare-date-boundary-to");
    selectDay(compareTo, "10");
    expect(screen.getByTestId("compare-date-boundary-from")).toHaveAccessibleName(/10 jul/i);
    expect(parent).toBeInTheDocument();
  });

  it("preserves cancel and update baselines", () => {
    const onUpdate = vi.fn();
    renderPicker({ width: 375, mobileLayout: true, onUpdate });
    const trigger = screen.getByRole("button", { name: /jun/i });
    openPicker();
    selectDay(openBoundary("date-boundary-from"), "3");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    expect(screen.getByTestId("date-boundary-from")).toHaveAccessibleName(/1 jun/i);
    selectDay(openBoundary("date-boundary-from"), "3");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ range: expect.objectContaining({ from: new Date(2026, 5, 3) }) }),
    );
  });

  it("preserves true outside dismissal for the desktop parent", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPicker({ width: 1200 });
    const parent = openPicker();
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);

    await user.click(outside);
    expect(parent).not.toBeInTheDocument();
    outside.remove();
  });

  it("keeps the portrait dialog layout unchanged", () => {
    renderPicker({ width: 375, height: 667, mobileLayout: true });
    openPicker();

    expect(screen.getByTestId("date-range-picker-dialog")).toHaveClass("max-w-md");
    expect(screen.getByTestId("date-range-picker-controls")).toHaveClass("flex-col");
    expect(screen.getByText("Período")).toHaveClass("sr-only");
    expect(screen.getByTestId("date-range-picker-calendar").querySelectorAll(".rdp-month")).toHaveLength(1);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to the Previous Month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to the Next Month" })).toBeInTheDocument();
  });

  it("uses the desktop-like two-month landscape composition at 855x419", () => {
    renderPicker({ width: 855, height: 419, mobileLayout: true });
    const dialog = openPicker();
    const controls = screen.getByTestId("date-range-picker-controls");
    const calendar = screen.getByTestId("date-range-picker-calendar");
    const sidebar = screen.getByTestId("date-range-picker-preset-sidebar");

    expect(dialog).toHaveClass(
      "[@media(orientation:landscape)_and_(min-width:700px)_and_(max-height:600px)]:max-w-3xl",
      "[@media(orientation:landscape)_and_(max-height:600px)]:overflow-hidden",
    );
    expect(within(controls).getByText("Fecha desde")).toBeInTheDocument();
    expect(within(controls).getByText("Fecha hasta")).toBeInTheDocument();
    expect(within(controls).queryByText("Período")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(calendar.querySelectorAll(".rdp-month")).toHaveLength(2);
    expect(calendar.querySelector(".rdp-nav")).not.toHaveClass("hidden");
    expect(calendar.querySelectorAll(".rdp-month_caption")).toHaveLength(2);
    expect(within(sidebar).getAllByRole("button")).toHaveLength(9);
    expect(within(sidebar).getByRole("button", { name: /Últimos 30 días/ })).toBeInTheDocument();
    expect(screen.getByTestId("date-range-picker-body")).toHaveClass(
      "[@media(orientation:landscape)_and_(min-width:700px)_and_(min-height:360px)_and_(max-height:600px)]:overflow-visible",
    );
    expect(calendar).toHaveClass(
      "[@media(orientation:landscape)_and_(min-width:700px)_and_(max-height:600px)]:[--cell-size:--spacing(6)]",
    );
    expect(calendar.querySelectorAll(".rdp-weekdays")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Actualizar" }).parentElement).toHaveClass(
      "shrink-0",
    );
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Actualizar" })).toHaveClass("min-h-11");
  });

  it("retains body scrolling as an ultra-short landscape fallback", () => {
    renderPicker({ width: 855, height: 320, mobileLayout: true });
    openPicker();

    expect(screen.getByTestId("date-range-picker-body")).toHaveClass(
      "[@media(orientation:landscape)_and_(max-height:600px)]:overflow-y-auto",
      "[@media(orientation:landscape)_and_(max-height:600px)]:flex-1",
    );
    expect(screen.getByRole("button", { name: "Actualizar" })).toBeInTheDocument();
  });

  it("falls back to one month and a Select in narrow landscape", () => {
    renderPicker({ width: 640, height: 419, mobileLayout: true });
    openPicker();

    expect(screen.getByTestId("date-range-picker-calendar").querySelectorAll(".rdp-month")).toHaveLength(1);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByTestId("date-range-picker-preset-sidebar")).not.toBeInTheDocument();
    expect(screen.getByTestId("date-range-picker-body")).toHaveClass(
      "[@media(orientation:landscape)_and_(max-height:600px)]:overflow-y-auto",
    );
  });

  it("keeps landscape month navigation, selectors, and preset buttons functional", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 12));
    renderPicker({ width: 855, height: 419, mobileLayout: true });
    const parent = openPicker();
    const firstCalendar = screen.getByTestId("date-range-picker-calendar");

    expect(firstCalendar.querySelectorAll(".rdp-month_caption")[0]).toHaveTextContent("junio 2026");
    fireEvent.click(within(firstCalendar).getByRole("button", { name: "Go to the Next Month" }));
    expect(screen.getByTestId("date-range-picker-calendar").querySelectorAll(".rdp-month_caption")[0]).toHaveTextContent("julio 2026");

    selectDay(openBoundary("date-boundary-from"), "3");
    expect(screen.getByTestId("date-boundary-from")).toHaveAccessibleName(/3 jun/i);
    fireEvent.click(within(parent).getByRole("button", { name: /Últimos 7 días/ }));
    expect(within(parent).getByRole("button", { name: /Últimos 7 días/ })).toHaveClass(
      "pointer-events-none",
    );
    expect(parent).toBeInTheDocument();
  });
});
