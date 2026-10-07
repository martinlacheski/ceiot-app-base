import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { FileInput } from "./FileInput";

function Harness({ onChange = vi.fn() }: { onChange?: (file: File | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <FileInput
      id="fw"
      label="Archivo de firmware (.bin)"
      accept=".bin"
      value={file}
      onChange={(next) => {
        setFile(next);
        onChange(next);
      }}
    />
  );
}

const native = () => screen.getByTestId("file-input-native") as HTMLInputElement;

describe("FileInput", () => {
  it("starts empty with an accessible, focusable trigger", () => {
    render(<Harness />);

    expect(screen.getByText("Ningún archivo seleccionado")).toBeInTheDocument();
    const trigger = screen.getByLabelText("Archivo de firmware (.bin)");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveTextContent("Seleccionar archivo");
    expect(native()).toHaveAttribute("accept", ".bin");
    expect(native()).toHaveClass("hidden");
    expect(screen.queryByRole("button", { name: "Quitar archivo" })).toBeNull();
  });

  it("shows the name and size of the chosen file", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    const file = new File([new Uint8Array(2_100_000)], "iot_device.bin");

    await user.upload(native(), file);

    expect(onChange).toHaveBeenCalledWith(file);
    expect(screen.getByText("iot_device.bin · 2,1 MB")).toBeInTheDocument();
  });

  it("clears the selection with Quitar", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.upload(native(), new File([new Uint8Array(10)], "a.bin"));

    await user.click(screen.getByRole("button", { name: "Quitar archivo" }));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Ningún archivo seleccionado")).toBeInTheDocument();
  });

  it("rejects a file with another extension and keeps the previous selection", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(native(), {
      target: { files: [new File([new Uint8Array(10)], "notas.txt")] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("El archivo debe ser de tipo .bin");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Ningún archivo seleccionado")).toBeInTheDocument();
  });

  it("opens the native picker from the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const click = vi.spyOn(native(), "click");

    await user.click(screen.getByLabelText("Archivo de firmware (.bin)"));

    expect(click).toHaveBeenCalled();
  });
});
