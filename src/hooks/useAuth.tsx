import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { HierarchyScope } from '@/lib/hierarchy';

type AppRole = 'super_admin' | 'dept_admin' | 'student' | 'lecturer' | 'course_rep' | 'hod';

interface Profile {
  id: string;
  user_id: string;
  name: string;
  email: string;
  department_id: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  hierarchyScope: HierarchyScope | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  role: null,
  hierarchyScope: null,
  loading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [hierarchyScope, setHierarchyScope] = useState<HierarchyScope | null>(null);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);

  const fetchUserData = async (userId: string) => {
    const version = ++requestVersion.current;
    setLoading(true);
    const [profileRes, roleRes, scopeRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', userId).single(),
      supabase.from('user_roles').select('role').eq('user_id', userId).single(),
      supabase.from('hierarchy_memberships').select('role,institution_id,faculty_id').eq('user_id', userId).maybeSingle(),
    ]);
    if (version !== requestVersion.current) return;
    setProfile(profileRes.data as Profile | null);
    setRole(roleRes.data?.role as AppRole ?? null);
    const scope = scopeRes.data;
    setHierarchyScope(scope && (scope.role === 'institution_admin' || scope.role === 'faculty_admin') ? { ...scope, role: scope.role } : null);
    setLoading(false);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setLoading(true);
          setTimeout(() => fetchUserData(session.user.id), 0);
        } else {
          requestVersion.current++;
          setProfile(null);
          setRole(null);
          setHierarchyScope(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setRole(null);
    setHierarchyScope(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, role, hierarchyScope, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
