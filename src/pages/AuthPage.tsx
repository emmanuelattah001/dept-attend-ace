import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { ClipboardCheck, ArrowLeft, GraduationCap, Shield } from 'lucide-react';

const SYNTHETIC_DOMAIN = 'students.attendtrack.app';
const matricToEmail = (matric: string) =>
  `${matric.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}@${SYNTHETIC_DOMAIN}`;

const AuthPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const nextPath = params.get('next') || '/';

  const [mode, setMode] = useState<'student' | 'admin'>('student');
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [matricNo, setMatricNo] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matricNo.trim()) return;
    setLoading(true);
    try {
      const synthetic = matricToEmail(matricNo);
      const pwd = password || matricNo.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({ email: synthetic, password: pwd });
      if (error) throw error;

      // Enforce one-time login: claim this account's first login.
      const { data: claim, error: claimErr } = await supabase.rpc('claim_student_login');
      if (claimErr) {
        await supabase.auth.signOut();
        throw new Error(claimErr.message);
      }
      if (claim && (claim as any).ok === false) {
        await supabase.auth.signOut();
        if ((claim as any).reason === 'already_used') {
          throw new Error('This account has already been used to log in. Please contact your course rep / admin to reset it.');
        }
        throw new Error('Login not allowed.');
      }

      toast.success('Logged in');
      navigate(nextPath);
    } catch (err: any) {
      toast.error(err.message || 'Login failed. Ask your course rep to create your login.');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Logged in successfully');
        navigate(nextPath);
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success('Account created! Check your email to confirm.');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Home
        </Button>
      </div>
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-xl flex items-center justify-center mb-2">
            <ClipboardCheck className="w-6 h-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Attendance System</CardTitle>
          <CardDescription>{isLogin ? 'Sign in to your account' : 'Create a new account'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 mb-5 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setMode('student')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition ${mode === 'student' ? 'bg-background shadow' : 'text-muted-foreground'}`}
            >
              <GraduationCap className="w-4 h-4" /> Student
            </button>
            <button
              onClick={() => setMode('admin')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition ${mode === 'admin' ? 'bg-background shadow' : 'text-muted-foreground'}`}
            >
              <Shield className="w-4 h-4" /> Course Rep / Admin
            </button>
          </div>

          {mode === 'student' ? (
            <form onSubmit={handleStudentLogin} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Matric Number</label>
                <Input
                  placeholder="e.g. AU25AC8017"
                  value={matricNo}
                  onChange={(e) => setMatricNo(e.target.value)}
                  required
                  autoCapitalize="characters"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  placeholder="Default = your matric number"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Your first-time password is your matric number (lowercase).
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Please wait...' : 'Sign In'}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                No account yet? Ask your course rep to create your login.
              </p>
            </form>
          ) : (
            <>
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                {!isLogin && (
                  <Input placeholder="Full Name" value={name} onChange={(e) => setName(e.target.value)} required />
                )}
                <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Sign Up'}
                </Button>
              </form>
              <p className="text-center text-sm text-muted-foreground mt-4">
                {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
                <button onClick={() => setIsLogin(!isLogin)} className="text-primary font-medium hover:underline">
                  {isLogin ? 'Sign Up' : 'Sign In'}
                </button>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthPage;
