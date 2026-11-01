import { Badge } from "@/components/ui/badge";
import { Check, Loader2, WifiOff } from "lucide-react";

interface DashboardHeaderProps {
  departmentName: string;
  connectionStatus: "online" | "offline" | "checking";
}

export function DashboardHeader({
  departmentName,
  connectionStatus,
}: DashboardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-bold sm:text-2xl">Department Admin Dashboard</h2>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          Department: <span className="font-semibold text-foreground">{departmentName}</span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        {connectionStatus === "online" ? (
          <Badge className="bg-green-100 text-green-800"><Check className="mr-1 h-3 w-3" />Online</Badge>
        ) : connectionStatus === "offline" ? (
          <Badge className="bg-red-100 text-red-800"><WifiOff className="mr-1 h-3 w-3" />Offline</Badge>
        ) : (
          <Badge variant="outline"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Checking</Badge>
        )}
      </div>
    </div>
  );
}
