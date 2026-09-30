import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { LogOut, ShieldCheck, Shield, UserCheck, GraduationCap, BookOpen, Users, Building2 } from 'lucide-react';

const roleLabels: Record<string, { label: string; icon: any; color: string }> = {
  super_admin: { label: 'Super Admin', icon: Shield, color: 'bg-destructive' },
  dept_admin: { label: 'Dept Admin', icon: UserCheck, color: 'bg-primary' },
  hod: { label: 'HOD', icon: Building2, color: 'bg-primary' },
  lecturer: { label: 'Lecturer', icon: BookOpen, color: 'bg-primary' },
  course_rep: { label: 'Course Rep', icon: Users, color: 'bg-accent' },
  student: { label: 'Student', icon: GraduationCap, color: 'bg-accent' },
};


const DashboardLayout = ({ children }: { children: ReactNode }) => {
  const { profile, role, signOut } = useAuth();
  const roleInfo = role ? roleLabels[role] : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-heading font-semibold">AttendTrack</h1>
          </div>

          <div className="flex items-center gap-3">
            {roleInfo && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${roleInfo.color} text-primary-foreground`}>
                {roleInfo.label}
              </span>
            )}
            <span className="text-sm text-muted-foreground hidden sm:block">
              {profile?.name}
            </span>
            <Button variant="ghost" size="icon" onClick={signOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6 animate-fade-in">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
