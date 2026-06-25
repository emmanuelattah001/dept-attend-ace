import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SheetsActions } from "./SheetsActions";

describe("SheetsActions toolbar", () => {
  it("renders both Export and Sync buttons", () => {
    render(<SheetsActions busy={false} onExport={() => {}} onSync={() => {}} />);
    expect(screen.getByRole("button", { name: /export to google sheets/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync to google sheets/i })).toBeInTheDocument();
  });

  it("invokes the correct handler on click", () => {
    const onExport = vi.fn();
    const onSync = vi.fn();
    render(<SheetsActions busy={false} onExport={onExport} onSync={onSync} />);
    fireEvent.click(screen.getByTestId("export-sheets-btn"));
    fireEvent.click(screen.getByTestId("sync-sheets-btn"));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons and shows a spinner on the active action while busy", () => {
    const { rerender } = render(
      <SheetsActions busy="export" onExport={() => {}} onSync={() => {}} />
    );
    const exportBtn = screen.getByTestId("export-sheets-btn");
    const syncBtn = screen.getByTestId("sync-sheets-btn");
    expect(exportBtn).toBeDisabled();
    expect(syncBtn).toBeDisabled();
    expect(exportBtn.querySelector(".animate-spin")).toBeTruthy();
    expect(syncBtn.querySelector(".animate-spin")).toBeFalsy();

    rerender(<SheetsActions busy="sync" onExport={() => {}} onSync={() => {}} />);
    expect(screen.getByTestId("sync-sheets-btn").querySelector(".animate-spin")).toBeTruthy();
  });
});
