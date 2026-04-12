import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import SuperAdminDashboard from './SuperAdminDashboard';
import DeptAdminDashboard from './DeptAdminDashboard';
import StudentDashboard from './StudentDashboard';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, Download, Search, LogIn, Loader2 } from 'lucide-react';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="space-y-3">
          <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center">
            <ClipboardCheck className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-heading font-bold">Smart Attendance</h1>
          <p className="text-muted-foreground">Track and manage attendance effortlessly</p>
        </div>

        <div className="space-y-3">
          <Button onClick={() => navigate('/check-attendance')} className="w-full" size="lg">
            <Search className="w-4 h-4 mr-2" /> Check My Attendance
          </Button>
          <Button onClick={() => navigate('/install')} variant="outline" className="w-full" size="lg">
            <Download className="w-4 h-4 mr-2" /> Install App
          </Button>
          <Button onClick={() => navigate('/login')} variant="ghost" className="w-full" size="lg">
            <LogIn className="w-4 h-4 mr-2" /> Admin Login
          </Button>
        </div>
      </div>
    </div>
  );
};

const Index = () => {
  const { session, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center animate-bounce">
          <ClipboardCheck className="w-8 h-8 text-primary-foreground" />
        </div>
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!session) return <LandingPage />;

  switch (role) {
    case 'super_admin':
      return <SuperAdminDashboard />;
    case 'dept_admin':
      return <DeptAdminDashboard />;
    case 'student':
    default:
      return <StudentDashboard />;
  }
};

export default Index;
