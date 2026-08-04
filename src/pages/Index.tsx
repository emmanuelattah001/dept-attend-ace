import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import SuperAdminDashboard from './SuperAdminDashboard';
import DeptAdminDashboard from './DeptAdminDashboard';
import StudentDashboard from './StudentDashboard';
import StaffDashboard from './StaffDashboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ClipboardCheck, Download, Search, LogIn, Users, ShieldCheck, BarChart3, FileText, Smartphone, Zap } from 'lucide-react';
import LoadingScreen from '@/components/LoadingScreen';

const features = [
  {
    icon: ShieldCheck,
    title: 'Multi-Factor Presence Proof',
    description: 'Every scan is verified by a rotating QR code, face match, GPS geofence and device fingerprint before it counts.',
  },
  {
    icon: Zap,
    title: 'Dynamic Rotating QR',
    description: 'Session codes refresh every 30 seconds, so screenshots shared with absent friends simply stop working.',
  },
  {
    icon: Users,
    title: 'Roles for Every Level',
    description: 'Students, course reps, lecturers, HODs and school admins each get a dashboard scoped to what they own.',
  },
  {
    icon: BarChart3,
    title: 'Confidence Scoring',
    description: 'Each record carries a 0-100 verification score with the exact proofs behind it, ready for audit.',
  },
  {
    icon: FileText,
    title: 'PDF Reports & Sheets Archive',
    description: 'Export branded attendance reports and keep a permanent Google Sheets archive of every record.',
  },
  {
    icon: Search,
    title: 'Instant Lookup',
    description: 'Students can check their own attendance anytime using just their matric number — no login needed.',
  },
];


const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
        <div className="container mx-auto px-4 py-20 sm:py-28 relative">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center shadow-lg">
              <ShieldCheck className="w-8 h-8 text-primary-foreground" />
            </div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Achievers University</p>
            <h1 className="text-4xl sm:text-5xl font-heading font-bold tracking-tight">
              Intelligent Attendance &{' '}
              <span className="text-primary">Presence Verification</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg mx-auto">
              AIPS proves who was actually in the room — rotating QR codes, face matching, GPS geofencing and device proof, combined into one confidence score.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button onClick={() => navigate('/check-attendance')} size="lg" className="text-base">
                <Search className="w-5 h-5 mr-2" /> Check My Attendance
              </Button>
              <Button onClick={() => navigate('/login')} variant="outline" size="lg" className="text-base">
                <LogIn className="w-5 h-5 mr-2" /> login
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-heading font-bold">Everything You Need</h2>
          <p className="text-muted-foreground mt-2 max-w-md mx-auto">
            Powerful features designed for schools, colleges, and universities.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {features.map((f) => (
            <Card key={f.title} className="border-border/60 hover:shadow-md transition-shadow">
              <CardContent className="pt-6 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-heading font-semibold text-lg">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/50 py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-heading font-bold">How It Works</h2>
            <p className="text-muted-foreground mt-2">Three simple steps to get started</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-8 max-w-3xl mx-auto">
            {[
              { step: '1', icon: Smartphone, title: 'Open the App', desc: 'Access AIPS from any device — mobile, tablet, or desktop.' },
              { step: '2', icon: ClipboardCheck, title: 'Mark Attendance', desc: 'Admins select a date, pick students, and mark present or absent.' },
              { step: '3', icon: Zap, title: 'View & Share', desc: 'Students check records instantly. Admins export branded PDF reports.' },
            ].map((s) => (
              <div key={s.step} className="text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-lg font-bold">
                  {s.step}
                </div>
                <h3 className="font-heading font-semibold">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-lg mx-auto text-center space-y-5">
          <h2 className="text-2xl font-heading font-bold">Ready to Get Started?</h2>
          <p className="text-muted-foreground">Check your attendance now or install the app for quick access.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => navigate('/check-attendance')} size="lg">
              <Search className="w-5 h-5 mr-2" /> Check Attendance
            </Button>
            <Button onClick={() => navigate('/install')} variant="outline" size="lg">
              <Download className="w-5 h-5 mr-2" /> Install App
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} AIPS · Achievers University. Verified presence, not just signatures.
        </div>
      </footer>
    </div>
  );
};

const Index = () => {
  const { session, role, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!session) return <LandingPage />;

  switch (role) {
    case 'super_admin':
      return <SuperAdminDashboard />;
    case 'dept_admin':
      return <DeptAdminDashboard />;
    case 'hod':
    case 'lecturer':
    case 'course_rep':
      return <StaffDashboard />;
    case 'student':
    default:
      return <StudentDashboard />;
  }
};

export default Index;

