import { useAuth } from '@/hooks/useAuth';
import AuthPage from './AuthPage';
import SuperAdminDashboard from './SuperAdminDashboard';
import DeptAdminDashboard from './DeptAdminDashboard';
import StudentDashboard from './StudentDashboard';

const Index = () => {
  const { session, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) return <AuthPage />;

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
