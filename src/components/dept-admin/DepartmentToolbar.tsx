import { Button } from "@/components/ui/button";
import { SheetsActions } from "@/components/SheetsActions";
import { SheetsSettingsDialog } from "@/components/SheetsSettingsDialog";
import { KeyRound, Loader2, QrCode, type LucideIcon } from "lucide-react";
import type { DepartmentAdminTab } from "./types";

interface Tab {
  id: DepartmentAdminTab;
  label: string;
  icon: LucideIcon;
}

interface DepartmentToolbarProps {
  tabs: Tab[];
  activeTab: DepartmentAdminTab;
  onTabChange: (tab: DepartmentAdminTab) => void;
  onOpenQr: () => void;
  onProvisionLogins: () => void;
  provisioningAuth: boolean;
  onResetLogins: () => void;
  resettingLogins: boolean;
  sheetsBusy: false | "sync" | "export";
  onExportSheets: () => void;
  onSyncSheets: () => void;
}

export function DepartmentToolbar({
  tabs, activeTab, onTabChange, onOpenQr, onProvisionLogins, provisioningAuth,
  onResetLogins, resettingLogins, sheetsBusy, onExportSheets, onSyncSheets,
}: DepartmentToolbarProps) {
  return (
    <div className="flex flex-col gap-3 border-b pb-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-thin">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.id} onClick={() => onTabChange(tab.id)} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="h-4 w-4" />{tab.label}</button>;
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onOpenQr}><QrCode className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Live QR Session</span><span className="sm:hidden">QR</span></Button>
        <Button size="sm" variant="outline" onClick={onProvisionLogins} disabled={provisioningAuth}>{provisioningAuth ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1" /> : <KeyRound className="h-4 w-4 sm:mr-1" />}<span className="hidden sm:inline">Create Student Logins</span><span className="sm:hidden">Create</span></Button>
        <Button size="sm" variant="outline" onClick={onResetLogins} disabled={resettingLogins}>{resettingLogins ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1" /> : <KeyRound className="h-4 w-4 sm:mr-1" />}<span className="hidden sm:inline">Reset Login Lock</span><span className="sm:hidden">Reset</span></Button>
        <SheetsActions busy={sheetsBusy} size="sm" onExport={onExportSheets} onSync={onSyncSheets} />
        <SheetsSettingsDialog />
      </div>
    </div>
  );
}
