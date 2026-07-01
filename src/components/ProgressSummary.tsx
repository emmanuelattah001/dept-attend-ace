import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Users, CalendarDays, ListChecks, Percent, TrendingUp, TrendingDown, AlertTriangle, Loader2 } from 'lucide-react';

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

export function ProgressSummary({ department, courseCode, refreshKey }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    supabase.functions.invoke('get-student-progress', { body: { department, course_code: courseCode } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.ok) setError(error?.message || data?.error || 'Failed to load summary');
        else setSummary(data.summary);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [department, courseCode, refreshKey]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading summary from Google Sheets…
        </CardContent>
      </Card>
    );
  }
  if (error || !summary) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Summary unavailable{error ? `: ${error}` : ''}
        </CardContent>
      </Card>
    );
  }

  return (
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
  );
}
