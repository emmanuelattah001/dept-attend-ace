import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Users, CalendarDays, ListChecks, Percent, TrendingUp, TrendingDown, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Summary {
  totalStudents: number;
  totalClasses: number;
  totalRecords: number;
  deptPercentage: number;
  above75: number;
  below75: number;
  consecutiveAbsences: number;
}

interface Props {
  department?: string;
  courseCode?: string;
  institutionId?: string;
  refreshKey?: number;
}

const items = (s: Summary) => [
  { label: 'Total Students', value: s.totalStudents, icon: Users },
  { label: 'Classes Held', value: s.totalClasses, icon: CalendarDays },
  { label: 'Attendance Records', value: s.totalRecords, icon: ListChecks },
  { label: 'Overall %', value: `${s.deptPercentage}%`, icon: Percent },
  { label: 'Above 75%', value: s.above75, icon: TrendingUp },
  { label: 'Below 75%', value: s.below75, icon: TrendingDown },
  { label: 'Consecutive Absences (≥3)', value: s.consecutiveAbsences, icon: AlertTriangle },
];

export function ProgressSummary({ department, courseCode, institutionId, refreshKey }: Props) {
  const { role } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState('');
  const [institutionsLoaded, setInstitutionsLoaded] = useState(false);
  const effectiveInstitutionId = institutionId ?? (role === 'super_admin' ? selectedInstitutionId : '');

  useEffect(() => {
    if (role !== 'super_admin' || institutionId) return;
    let cancelled = false;
    supabase.rpc('list_attendance_institutions').then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setInstitutionsLoaded(true);
        setLoading(false);
        return;
      }
      const available = data ?? [];
      setInstitutions(available);
      setInstitutionsLoaded(true);
      setSelectedInstitutionId((current) =>
        available.some((item) => item.id === current) ? current : available[0]?.id ?? '',
      );
    });
    return () => { cancelled = true; };
  }, [institutionId, role]);

  useEffect(() => {
    let cancelled = false;
    if (role === 'super_admin' && !effectiveInstitutionId) {
      setLoading(!institutionsLoaded);
      if (institutionsLoaded && institutions.length === 0) {
        setError('No active institution is available.');
      }
      return;
    }
    setLoading(true); setError(null);
    supabase.functions.invoke('get-student-progress', {
      body: {
        department,
        course_code: courseCode,
        ...(effectiveInstitutionId ? { institution_id: effectiveInstitutionId } : {}),
      },
    })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.ok) setError(error?.message || data?.error || 'Failed to load summary');
        else setSummary(data.summary);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [department, courseCode, effectiveInstitutionId, institutions.length, institutionsLoaded, refreshKey, role]);

  const tenantPicker = role === 'super_admin' && !institutionId ? (
    <div className="max-w-sm">
      <Select value={selectedInstitutionId} onValueChange={setSelectedInstitutionId}>
        <SelectTrigger aria-label="Select institution archive"><SelectValue placeholder="Select institution archive" /></SelectTrigger>
        <SelectContent>
          {institutions.map((institution) => (
            <SelectItem key={institution.id} value={institution.id}>{institution.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="space-y-3">{tenantPicker}<Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading institution attendance summary…
        </CardContent>
      </Card></div>
    );
  }
  if (error || !summary) {
    return (
      <div className="space-y-3">{tenantPicker}<Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Summary unavailable{error ? `: ${error}` : ''}
        </CardContent>
      </Card></div>
    );
  }

  return (
    <div className="space-y-3">
      {tenantPicker}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {items(summary).map(({ label, value, icon: Icon }) => (
        <Card key={label}>
          <CardContent className="pt-4 pb-3 text-center">
            <Icon className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="text-lg font-bold leading-tight">{value}</p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-1">{label}</p>
          </CardContent>
        </Card>
      ))}
      </div>
    </div>
  );
}
