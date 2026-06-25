import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Upload } from "lucide-react";

export type SheetsBusy = false | "sync" | "export";

interface SheetsActionsProps {
  busy: SheetsBusy;
  onExport: () => void;
  onSync: () => void;
  size?: "default" | "sm";
}

/**
 * Renders the Export and Sync Google Sheets toolbar buttons.
 * Used in the Attendance tab toolbar and the Attendance History header.
 */
export function SheetsActions({ busy, onExport, onSync, size = "default" }: SheetsActionsProps) {
  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={onExport}
        disabled={busy !== false}
        data-testid="export-sheets-btn"
      >
        {busy === "export" ? (
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        ) : (
          <Upload className="w-4 h-4 mr-1" />
        )}
        Export to Google Sheets
      </Button>
      <Button
        variant="outline"
        size={size}
        onClick={onSync}
        disabled={busy !== false}
        data-testid="sync-sheets-btn"
      >
        {busy === "sync" ? (
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4 mr-1" />
        )}
        Sync to Google Sheets
      </Button>
    </>
  );
}
