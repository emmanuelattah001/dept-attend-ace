import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { hierarchyPermissions } from '@/lib/hierarchy';
import DashboardLayout from '@/components/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, GraduationCap, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export function HierarchyManager() {
  const { role, hierarchyScope } = useAuth();
  const platform = role === 'super_admin';
  const [institutions, setInstitutions] = useState<Tables<'institutions'>[]>([]);
  const [faculties, setFaculties] = useState<Tables<'faculties'>[]>([]);
  const [departments, setDepartments] = useState<Tables<'departments'>[]>([]);
  const [memberships, setMemberships] = useState<Tables<'hierarchy_memberships'>[]>([]);
  const [profiles, setProfiles] = useState<{ user_id: string; name: string }[]>([]);
  const [institutionId, setInstitutionId] = useState(hierarchyScope?.institution_id ?? '');
  const [facultyId, setFacultyId] = useState(hierarchyScope?.faculty_id ?? '');
  const [institutionName, setInstitutionName] = useState('');
  const [facultyName, setFacultyName] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [legacyDepartment, setLegacyDepartment] = useState('');
  const [userId, setUserId] = useState('');
  const [adminRole, setAdminRole] = useState<'institution_admin' | 'faculty_admin'>('institution_admin');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    const [i, f, d, m] = await Promise.all([
      supabase.from('institutions').select('*').order('name'),
      supabase.from('faculties').select('*').order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('hierarchy_memberships').select('*'),
    ]);
    const error = i.error ?? f.error ?? d.error ?? m.error;
    if (error) { setLoadError(error.message); return; }
    setInstitutions(i.data ?? []); setFaculties(f.data ?? []);
    setDepartments(d.data ?? []); setMemberships(m.data ?? []);
    setInstitutionId(current => current || i.data?.[0]?.id || '');
    if (platform) {
      const p = await supabase.from('profiles').select('user_id,name').order('name');
      if (p.error) setLoadError(p.error.message); else setProfiles(p.data ?? []);
    }
  }, [platform]);
  useEffect(() => { void load().catch(error => setLoadError(String(error))); }, [load]);

  const institution = institutions.find(i => i.id === institutionId);
  const permissions = hierarchyPermissions(platform, hierarchyScope, institutionId, facultyId, institution?.status === 'active');
  const visibleFaculties = faculties.filter(f => f.institution_id === institutionId);
  const visibleDepartments = departments.filter(d => d.faculty_id && visibleFaculties.some(f => f.id === d.faculty_id) && (!facultyId || d.faculty_id === facultyId));
  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    try { await action(); toast.success(message); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save changes'); }
    finally { setBusy(false); }
  };
  const selectInstitution = (id: string) => { setInstitutionId(id); setFacultyId(''); };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-2xl font-heading font-bold">{platform ? 'Institutions & Faculties' : hierarchyScope?.role === 'faculty_admin' ? 'Faculty Administration' : 'Institution Administration'}</h2></div>
      <Button variant="outline" size="icon" aria-label="Refresh hierarchy" disabled={busy} onClick={() => void load().catch(error => setLoadError(String(error)))}><RefreshCw /></Button>
    </div>
    {loadError && <div role="alert" className="border border-destructive rounded-md p-4 text-sm text-destructive">{loadError}</div>}
    <div className="grid gap-4 sm:grid-cols-3 border-y py-5">
      <div><p className="text-2xl font-semibold">{institutions.length}</p><p className="text-sm text-muted-foreground">Institutions</p></div>
      <div><p className="text-2xl font-semibold">{visibleFaculties.length}</p><p className="text-sm text-muted-foreground">Faculties</p></div>
      <div><p className="text-2xl font-semibold">{visibleDepartments.length}</p><p className="text-sm text-muted-foreground">Departments</p></div>
    </div>
    {platform && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void run(async () => {
      const { data, error } = await supabase.from('institutions').insert({ name: institutionName.trim() }).select().single();
      if (error) throw error; setInstitutionName(''); selectInstitution(data.id);
    }, 'Institution created'); }}>
      <Input aria-label="Institution name" placeholder="Institution name" maxLength={200} required value={institutionName} onChange={e => setInstitutionName(e.target.value)} className="flex-1 min-w-48" />
      <Button disabled={busy || !institutionName.trim()}><Plus />Add Institution</Button>
    </form>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label>Institution</Label><Select value={institutionId} onValueChange={selectInstitution}><SelectTrigger><SelectValue placeholder="Select institution" /></SelectTrigger><SelectContent>{institutions.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label>Faculty</Label><Select value={facultyId || 'all'} onValueChange={value => setFacultyId(value === 'all' ? '' : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All accessible faculties</SelectItem>{visibleFaculties.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {institution && <div className="flex flex-wrap justify-between items-center gap-3 border-b pb-4"><h3 className="font-semibold flex gap-2 items-center"><Building2 className="h-5 w-5 text-primary" />{institution.name}</h3>{platform ? <Select value={institution.status} onValueChange={status => void run(async () => { const { error } = await supabase.from('institutions').update({ status }).eq('id', institution.id); if (error) throw error; }, 'Institution status updated')} disabled={busy}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select> : <span className="text-sm text-muted-foreground">{institution.status}</span>}</div>}
    {!institution && !loadError && <p className="text-muted-foreground">No institution assigned.</p>}
    {permissions.manageFaculties && institutionId && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { const { data, error } = await supabase.from('faculties').insert({ name: facultyName.trim(), institution_id: institutionId }).select().single(); if (error) throw error; setFacultyName(''); setFacultyId(data.id); }, 'Faculty created'); }}><Input aria-label="Faculty name" placeholder="Faculty name" required maxLength={200} value={facultyName} onChange={e => setFacultyName(e.target.value)} className="flex-1 min-w-48" /><Button disabled={busy || !facultyName.trim()}><Plus />Add Faculty</Button></form>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleFaculties.filter(f => !facultyId || f.id === facultyId).map(f => <div key={f.id} className="rounded-md border p-4 space-y-2"><GraduationCap className="h-5 w-5 text-accent" /><h3 className="font-semibold break-words">{f.name}</h3><p className="text-sm text-muted-foreground">{departments.filter(d => d.faculty_id === f.id).length} departments</p><Button variant="link" className="p-0" onClick={() => setFacultyId(f.id)}>View departments</Button></div>)}</div>
    <section className="space-y-4"><h3 className="text-lg font-semibold">Departments</h3>
      {permissions.manageDepartments && facultyId && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { const { error } = await supabase.from('departments').insert({ name: departmentName.trim(), faculty_id: facultyId }); if (error) throw error; setDepartmentName(''); }, 'Department created'); }}><Input aria-label="Department name" placeholder="Department name" required value={departmentName} onChange={e => setDepartmentName(e.target.value)} className="flex-1 min-w-48" /><Button disabled={busy || !departmentName.trim()}><Plus />Add Department</Button></form>}
      {platform && facultyId && <div className="flex flex-wrap gap-2"><Select value={legacyDepartment} onValueChange={setLegacyDepartment}><SelectTrigger className="flex-1 min-w-48"><SelectValue placeholder="Unassigned existing department" /></SelectTrigger><SelectContent>{departments.filter(d => !d.faculty_id).map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={busy || !legacyDepartment} onClick={() => { if (!window.confirm('Link this department to the selected faculty? Existing attendance and students stay with it.')) return; void run(async () => { const { error } = await supabase.from('departments').update({ faculty_id: facultyId }).eq('id', legacyDepartment).is('faculty_id', null); if (error) throw error; setLegacyDepartment(''); }, 'Department linked'); }}>Link Department</Button></div>}
      <div className="divide-y">{visibleDepartments.map(d => <div className="flex flex-wrap justify-between gap-2 py-3" key={d.id}><span className="font-medium">{d.name}</span><span className="text-sm text-muted-foreground">{faculties.find(f => f.id === d.faculty_id)?.name}</span></div>)}</div>
      {visibleDepartments.length === 0 && <p className="text-sm text-muted-foreground">No departments in this selection.</p>}
    </section>
    {platform && <section className="border-t pt-5 space-y-4"><h3 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Administrator Assignments</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Select value={userId} onValueChange={setUserId}><SelectTrigger><SelectValue placeholder="Select registered user" /></SelectTrigger><SelectContent>{profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.name}</SelectItem>)}</SelectContent></Select><Select value={adminRole} onValueChange={v => setAdminRole(v === 'faculty_admin' ? v : 'institution_admin')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="institution_admin">Institution Admin</SelectItem><SelectItem value="faculty_admin">Faculty Admin</SelectItem></SelectContent></Select><Button disabled={busy || !userId || !institutionId || (adminRole === 'faculty_admin' && !facultyId)} onClick={() => void run(async () => { const { error } = await supabase.from('hierarchy_memberships').upsert({ user_id: userId, role: adminRole, institution_id: institutionId, faculty_id: adminRole === 'faculty_admin' ? facultyId : null }, { onConflict: 'user_id' }); if (error) throw error; setUserId(''); }, 'Administrator assigned')}>Assign Administrator</Button></div>
      <div className="divide-y">{memberships.filter(m => m.institution_id === institutionId).map(m => <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="font-medium">{profiles.find(p => p.user_id === m.user_id)?.name ?? 'Registered administrator'}</p><p className="text-sm text-muted-foreground">{m.role === 'institution_admin' ? 'Institution Admin' : `Faculty Admin · ${faculties.find(f => f.id === m.faculty_id)?.name ?? ''}`}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => { if (!window.confirm('Remove this administrator assignment?')) return; void run(async () => { const { error } = await supabase.from('hierarchy_memberships').delete().eq('id', m.id); if (error) throw error; }, 'Assignment removed'); }}>Remove assignment</Button></div>)}</div>
    </section>}
  </div>;
}

export default function HierarchyDashboard() {
  return <DashboardLayout><HierarchyManager /></DashboardLayout>;
}