import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useEffect } from "react";
import { toast } from "sonner";
import Index from "./pages/Index.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import NotFound from "./pages/NotFound.tsx";
import InstallPage from "./pages/InstallPage.tsx";
import CheckAttendance from "./pages/CheckAttendance.tsx";

const queryClient = new QueryClient();

const GlobalErrorListeners = () => {
  useEffect(() => {
    const onUnhandled = (e: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', e.reason);
      const msg = (e.reason?.message || String(e.reason || '')).slice(0, 200);
      if (msg && !msg.includes('AbortError')) {
        toast.error('Something went wrong', { description: msg });
      }
    };
    const onError = (e: ErrorEvent) => {
      console.error('Global error:', e.error || e.message);
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('error', onError);
    };
  }, []);
  return null;
};

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <GlobalErrorListeners />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<AuthPage />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/check-attendance" element={<CheckAttendance />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
