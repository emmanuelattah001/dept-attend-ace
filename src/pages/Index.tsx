import { Suspense, lazy, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BadgeCheck,
  Building2,
  CalendarCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  GraduationCap,
  LogIn,
  QrCode,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
  Zap,
} from 'lucide-react';
import LoadingScreen from '@/components/LoadingScreen';
import HierarchyDashboard from './HierarchyDashboard';

const SuperAdminDashboard = lazy(() => import('./SuperAdminDashboard'));
const DeptAdminDashboard = lazy(() => import('./DeptAdminDashboard'));
const StudentDashboard = lazy(() => import('./StudentDashboard'));
const LecturerDashboard = lazy(() => import('./LecturerDashboard'));

const audiences = [
  {
    id: 'students',
    label: 'For students',
    icon: GraduationCap,
    eyebrow: 'Your attendance, at a glance',
    title: 'Know where you stand.',
    description: 'Check your own attendance and progress in a clear, private view. Sign in with your student account to see records linked to you.',
    points: ['Personal attendance history', 'Course-by-course progress', 'Secure account-linked lookup'],
    previewTitle: 'My attendance',
    previewSubtitle: 'Semester overview',
    metric: '87%',
    metricLabel: 'Attendance rate',
    rows: [
      { course: 'CSC 302 · Data Structures', status: 'Present', date: 'Today' },
      { course: 'MTH 214 · Linear Algebra', status: 'Present', date: 'Yesterday' },
      { course: 'GST 202 · Communication', status: 'Absent', date: 'Oct 28' },
    ],
  },
  {
    id: 'admins',
    label: 'For department teams',
    icon: ClipboardCheck,
    eyebrow: 'Less admin, more clarity',
    title: 'Attendance that’s easy to manage.',
    description: 'Department teams can record attendance, manage course staff, review trends, and share reports from one workspace.',
    points: ['Fast class attendance workflows', 'Role-based lecturer assignments', 'Shareable PDF reports'],
    previewTitle: 'Attendance session',
    previewSubtitle: 'Sample course · 10:00 AM',
    metric: '32 / 36',
    metricLabel: 'Students recorded',
    rows: [
      { course: 'Student A', status: 'Present', date: '10:04 AM' },
      { course: 'Student B', status: 'Present', date: '10:05 AM' },
      { course: 'Student C', status: 'Pending', date: '—' },
    ],
  },
  {
    id: 'institutions',
    label: 'For institutions',
    icon: Building2,
    eyebrow: 'A structure that scales',
    title: 'Connected oversight. Clear boundaries.',
    description: 'Organize faculties and departments under an institution, with scoped administrators and institution-specific attendance archives.',
    points: ['Institution and faculty hierarchy', 'Scoped administrator access', 'Separate attendance archives'],
    previewTitle: 'Institution hierarchy',
    previewSubtitle: 'A clear view of your structure',
    metric: '3',
    metricLabel: 'Connected levels',
    rows: [
      { course: 'Institution', status: 'Scoped', date: 'Level 1' },
      { course: 'Faculty', status: 'Scoped', date: 'Level 2' },
      { course: 'Department', status: 'Scoped', date: 'Level 3' },
    ],
  },
];

const steps = [
  { icon: Smartphone, title: 'Open your workspace', description: 'Sign in from a phone, tablet, or desktop and land on the right role-based view.' },
  { icon: QrCode, title: 'Record attendance', description: 'Use the attendance tools available to your course or department.' },
  { icon: BarChart3, title: 'Follow progress', description: 'Review records and share reports with the right people.' },
];

const LandingPage = () => {
  const navigate = useNavigate();
  const [activeAudience, setActiveAudience] = useState(audiences[0]);
  const [activeRole, setActiveRole] = useState('student');

  return (
    <div className="min-h-screen overflow-hidden bg-background">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <nav className="container mx-auto flex h-16 items-center justify-between px-4" aria-label="Main navigation">
          <a href="#home" className="flex items-center gap-2.5 font-heading text-lg font-bold tracking-tight" aria-label="Smart Attendance home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <span>Smart<span className="text-primary">Attend</span></span>
          </a>
          <div className="hidden items-center gap-7 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Platform</a>
            <a href="#how-it-works" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">How it works</a>
            <a href="#roles" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Who it’s for</a>
          </div>
          <Button onClick={() => navigate('/login')} size="sm" className="rounded-full px-5">
            <LogIn className="mr-2 h-4 w-4" /> Admin Login
          </Button>
        </nav>
      </header>

      <main>
        <section id="home" className="relative isolate">
          <div className="pointer-events-none absolute -right-36 -top-20 -z-10 h-[34rem] w-[34rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-40 top-48 -z-10 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
          <div className="container mx-auto grid items-center gap-14 px-4 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.05fr_.95fr] lg:gap-10 lg:pb-28 lg:pt-24">
            <div className="animate-fade-in">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-card/80 px-3.5 py-1.5 text-xs font-semibold text-primary shadow-sm">
                <span className="h-2 w-2 rounded-full bg-accent" />
                Attendance management, thoughtfully connected
              </div>
              <h1 className="max-w-2xl font-heading text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Attendance, clearly accounted for.
                <span className="mt-1 block bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Every role in sync.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                A clearer way for students to follow their progress and for campus teams to keep attendance moving.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button onClick={() => navigate('/login?next=%2Fcheck-attendance')} size="lg" className="h-12 rounded-full px-6 text-base shadow-lg shadow-primary/20">
                  <Search className="mr-2 h-5 w-5" /> Check My Attendance
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button onClick={() => navigate('/login')} variant="outline" size="lg" className="h-12 rounded-full border-border bg-card/70 px-6 text-base">
                  <LogIn className="mr-2 h-5 w-5" /> Admin Login
                </Button>
              </div>
              <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> Role-aware access</span>
                <span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Institution-ready</span>
                <span className="inline-flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Shareable reports</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[31rem] animate-fade-in [animation-delay:120ms]">
              <div className="absolute -left-5 top-16 hidden rounded-2xl border bg-card p-3.5 shadow-xl shadow-foreground/5 sm:block">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><CheckCircle2 className="h-5 w-5" /></span>
                  <div><p className="text-xs font-semibold">Class recorded</p><p className="text-[11px] text-muted-foreground">Just now · CSC 302</p></div>
                </div>
              </div>
              <div className="absolute -right-3 bottom-14 z-10 rounded-2xl border bg-card px-4 py-3 shadow-xl shadow-foreground/5 sm:-right-7">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
                  </span>
                  Live session
                </div>
              </div>
              <div className="rounded-[2rem] border border-border/80 bg-card/90 p-3 shadow-2xl shadow-primary/10 backdrop-blur">
                <div className="rounded-[1.5rem] bg-gradient-to-br from-primary/10 via-background to-accent/10 p-5 sm:p-7">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><CalendarCheck className="h-5 w-5" /></div>
                      <div><p className="text-sm font-semibold">Attendance preview</p><p className="text-xs text-muted-foreground">Sample session · CSC 302</p></div>
                    </div>
                    <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent">Preview</span>
                  </div>
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border bg-card p-4">
                      <p className="text-xs text-muted-foreground">Present</p>
                      <p className="mt-1 font-heading text-3xl font-bold">32<span className="text-base font-medium text-muted-foreground"> / 36</span></p>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-[89%] rounded-full bg-accent" /></div>
                    </div>
                    <div className="rounded-2xl border bg-card p-4">
                      <p className="text-xs text-muted-foreground">Course</p>
                      <p className="mt-2 font-heading text-xl font-bold">CSC 302</p>
                      <p className="mt-1 text-xs text-muted-foreground">Data Structures</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold">Recent activity</p>
                      <span className="text-[11px] text-muted-foreground">View class</span>
                    </div>
                    {['Student A', 'Student B', 'Student C'].map((name, index) => (
                      <div key={name} className={`flex items-center justify-between py-2 ${index < 2 ? 'border-b border-border/60' : ''}`}>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">{name.split(' ').map(part => part[0]).join('')}</span>
                          <span className="text-xs font-medium">{name}</span>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${index < 2 ? 'text-accent' : 'text-muted-foreground'}`}>
                          {index < 2 && <Check className="h-3 w-3" />}{index < 2 ? 'Present' : 'Pending'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y bg-card/70 py-7" aria-label="Platform capabilities">
          <div className="container mx-auto flex flex-col items-center gap-5 px-4 md:flex-row md:justify-between">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground md:text-left">One connected workflow for</p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm font-semibold text-foreground/75">
              <span className="inline-flex items-center gap-2"><GraduationCap className="h-4 w-4 text-primary" /> Student progress</span>
              <span className="inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-accent" /> Class attendance</span>
              <span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Institution oversight</span>
            </div>
          </div>
        </section>

        <section id="features" className="container mx-auto scroll-mt-24 px-4 py-20 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-primary">One platform, distinct views</span>
            <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight sm:text-4xl">Designed around your day.</h2>
            <p className="mt-4 text-muted-foreground">The right tools and information for the people who use them.</p>
          </div>
          <div className="mx-auto mt-10 max-w-6xl overflow-hidden rounded-[2rem] border bg-card shadow-xl shadow-foreground/[0.03]">
            <div className="grid md:grid-cols-[260px_1fr]">
              <div className="border-b bg-muted/40 p-3 md:border-b-0 md:border-r md:p-5" role="tablist" aria-label="Platform audiences">
                {audiences.map((audience) => {
                  const Icon = audience.icon;
                  const selected = activeAudience.id === audience.id;
                  return (
                    <button
                      key={audience.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="audience-panel"
                      onClick={() => setActiveAudience(audience)}
                      className={`mb-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors last:mb-0 ${selected ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'}`}
                    >
                      <Icon className="h-4 w-4" />{audience.label}
                      {selected && <ArrowUpRight className="ml-auto h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
              <div id="audience-panel" role="tabpanel" className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:p-10">
                <div key={activeAudience.id} className="animate-fade-in">
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-accent">{activeAudience.eyebrow}</span>
                  <h3 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">{activeAudience.title}</h3>
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{activeAudience.description}</p>
                  <ul className="mt-6 space-y-3">
                    {activeAudience.points.map(point => <li key={point} className="flex items-center gap-2.5 text-sm font-medium"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-accent"><Check className="h-3 w-3" /></span>{point}</li>)}
                  </ul>
                  <Button onClick={() => navigate(activeAudience.id === 'students' ? '/login?next=%2Fcheck-attendance' : '/login')} variant="link" className="mt-5 h-auto p-0 text-primary">
                    {activeAudience.id === 'students' ? 'Check your attendance' : 'Explore your workspace'} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="rounded-2xl border bg-background p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between border-b pb-4">
                    <div><p className="text-sm font-semibold">{activeAudience.previewTitle}</p><p className="mt-1 text-xs text-muted-foreground">{activeAudience.previewSubtitle}</p></div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">Sample view</span>
                  </div>
                  <div className="flex items-end justify-between py-5">
                    <div><p className="font-heading text-3xl font-bold">{activeAudience.metric}</p><p className="mt-1 text-xs text-muted-foreground">{activeAudience.metricLabel}</p></div>
                    <div className="flex h-10 items-end gap-1" aria-hidden="true">
                      {[40, 65, 48, 80, 57, 94, 72].map((height, index) => <span key={index} className="w-2 rounded-t bg-primary/70" style={{ height: `${height}%` }} />)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {activeAudience.rows.map((row, index) => (
                      <div key={row.course} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-3 ${index === 0 ? 'bg-muted/60' : ''}`}>
                        <span className="truncate text-xs font-medium">{row.course}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{row.date}</span>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${row.status === 'Absent' ? 'bg-destructive/10 text-destructive' : row.status === 'Pending' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent'}`}>{row.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 bg-muted/40 py-20 sm:py-24">
          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-xl text-center">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Simple by design</span>
              <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight sm:text-4xl">From class to clarity.</h2>
              <p className="mt-4 text-muted-foreground">A familiar flow keeps attendance easy to record and easy to understand.</p>
            </div>
            <div className="mx-auto mt-12 grid max-w-5xl gap-5 md:grid-cols-3">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <article key={step.title} className="animate-fade-in rounded-2xl border bg-card p-6 shadow-sm transition-transform duration-300 hover:-translate-y-1" style={{ animationDelay: `${index * 100}ms` }}>
                    <div className="flex items-center justify-between">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                      <span className="font-heading text-4xl font-bold text-muted/80">0{index + 1}</span>
                    </div>
                    <h3 className="mt-6 font-heading text-lg font-bold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
                    {index < steps.length - 1 && <div className="mt-5 hidden items-center gap-2 text-xs font-semibold text-primary md:flex">Next step <ArrowRight className="h-3 w-3" /></div>}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-16 sm:py-20" aria-label="Platform highlights">
          <div className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary to-[#5369e8] px-6 py-10 text-primary-foreground shadow-xl shadow-primary/20 sm:px-10 lg:px-14">
            <div className="grid gap-8 sm:grid-cols-3 sm:gap-4">
              {[
                { icon: Users, value: 'For every role', label: 'Student, course staff, and administrators' },
                { icon: ShieldCheck, value: 'Scoped access', label: 'Information follows your role and institution' },
                { icon: FileText, value: 'Ready to share', label: 'Attendance summaries and PDF reports' },
              ].map(item => {
                const Icon = item.icon;
                return <div key={item.value} className="flex items-start gap-4 sm:block sm:text-center">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 sm:mx-auto"><Icon className="h-5 w-5" /></span>
                  <div className="sm:mt-3"><p className="font-heading text-xl font-bold">{item.value}</p><p className="mt-1 text-sm text-white/75">{item.label}</p></div>
                </div>;
              })}
            </div>
          </div>
        </section>

        <section id="roles" className="container mx-auto scroll-mt-24 px-4 py-12 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[.85fr_1.15fr] lg:items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Made for campus life</span>
              <h2 className="mt-3 font-heading text-3xl font-bold tracking-tight sm:text-4xl">A better experience for every role.</h2>
              <p className="mt-4 text-muted-foreground">Different responsibilities, one shared source of attendance information.</p>
              <div className="mt-7 flex flex-wrap gap-2" role="tablist" aria-label="Role experiences">
                {[
                  { id: 'student', label: 'Student', icon: GraduationCap },
                  { id: 'course-rep', label: 'Course rep', icon: ClipboardCheck },
                  { id: 'hod', label: 'HOD', icon: Building2 },
                ].map(role => {
                  const Icon = role.icon;
                  return <button key={role.id} type="button" role="tab" aria-selected={activeRole === role.id} onClick={() => setActiveRole(role.id)} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${activeRole === role.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}><Icon className="h-4 w-4" />{role.label}</button>;
                })}
              </div>
            </div>
            <div key={activeRole} role="tabpanel" className="animate-fade-in rounded-[1.75rem] border bg-card p-6 shadow-lg shadow-foreground/[0.03] sm:p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><BadgeCheck className="h-6 w-6" /></div>
              {activeRole === 'student' && <>
                <h3 className="mt-5 font-heading text-xl font-bold">A personal view that stays personal.</h3>
                <p className="mt-3 leading-7 text-muted-foreground">Students sign in to check the attendance records and course progress connected to their own account.</p>
                <p className="mt-5 border-l-2 border-accent pl-4 text-sm font-medium text-foreground/80">Clear answers about your attendance, without searching through class lists.</p>
              </>}
              {activeRole === 'course-rep' && <>
                <h3 className="mt-5 font-heading text-xl font-bold">The right tools for the assigned course.</h3>
                <p className="mt-3 leading-7 text-muted-foreground">Course reps use their assigned course workspace to support attendance and keep class records organized.</p>
                <p className="mt-5 border-l-2 border-accent pl-4 text-sm font-medium text-foreground/80">Course access is connected to department-managed assignments.</p>
              </>}
              {activeRole === 'hod' && <>
                <h3 className="mt-5 font-heading text-xl font-bold">Department oversight, with useful context.</h3>
                <p className="mt-3 leading-7 text-muted-foreground">HODs can review department attendance activity and use summaries to follow up where needed.</p>
                <p className="mt-5 border-l-2 border-accent pl-4 text-sm font-medium text-foreground/80">Turn attendance records into a clearer view of department progress.</p>
              </>}
            </div>
          </div>
        </section>

        <section className="px-4 pb-20 pt-12 sm:pb-24">
          <div className="container mx-auto overflow-hidden rounded-[2rem] border bg-card">
            <div className="relative px-6 py-12 text-center sm:px-12 sm:py-16">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
              <div className="relative mx-auto max-w-2xl">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg"><Zap className="h-5 w-5" /></span>
                <h2 className="mt-5 font-heading text-3xl font-bold tracking-tight sm:text-4xl">Make attendance easier to follow.</h2>
                <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Choose your path: students can review their records, and campus teams can sign in to manage their workspace.</p>
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Button onClick={() => navigate('/login?next=%2Fcheck-attendance')} size="lg" className="h-12 rounded-full px-6"><Search className="mr-2 h-4 w-4" />Check My Attendance<ArrowRight className="ml-2 h-4 w-4" /></Button>
                  <Button onClick={() => navigate('/login')} variant="outline" size="lg" className="h-12 rounded-full bg-card px-6"><LogIn className="mr-2 h-4 w-4" />Admin Login</Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card/60">
        <div className="container mx-auto grid gap-8 px-4 py-10 sm:grid-cols-2 sm:items-center lg:grid-cols-[1fr_auto_auto]">
          <div>
            <a href="#home" className="inline-flex items-center gap-2 font-heading font-bold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ClipboardCheck className="h-4 w-4" /></span>Smart<span className="-ml-2 text-primary">Attend</span></a>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">Attendance management built for students, departments, and institutions.</p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <a href="#features" className="transition-colors hover:text-foreground">Platform</a>
            <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
            <button type="button" onClick={() => navigate('/check-attendance')} className="transition-colors hover:text-foreground">Student lookup</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-1 lg:justify-end">
            <Button onClick={() => navigate('/install')} variant="outline" size="sm" className="rounded-full"><Download className="mr-2 h-4 w-4" />Install app</Button>
            <span className="text-xs text-muted-foreground">© {new Date().getFullYear()} Smart Attendance</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const Index = () => {
  const { session, role, hierarchyScope, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!session) return <LandingPage />;
  if (role !== 'super_admin' && hierarchyScope) return <HierarchyDashboard />;

  const dashboard = (() => {
    switch (role) {
      case 'super_admin':
        return <SuperAdminDashboard />;
      case 'dept_admin':
      case 'hod':
        return <DeptAdminDashboard />;
      case 'lecturer':
        return <LecturerDashboard />;
      case 'course_rep':
        return <LecturerDashboard staffRole="course_rep" />;
      case 'student':
      default:
        return <StudentDashboard />;
    }
  })();

  return <Suspense fallback={<LoadingScreen />}>{dashboard}</Suspense>;
};

export default Index;
