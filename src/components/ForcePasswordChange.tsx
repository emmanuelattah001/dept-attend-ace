import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * Blocks the dashboard until a student with a temporary (admin-issued) password chooses their own.
 * The flag lives in auth user_metadata.must_change_password and is set by provision-student-auth.
 */
export default function ForcePasswordChange() {
  const { user } = useAuth();
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const required = !!user?.user_metadata?.must_change_password && !done;
  if (!required) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) return toast.error('Use at least 8 characters.');
    if (pwd !== confirm) return toast.error('Passwords do not match.');
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd, data: { must_change_password: false } });
    setSaving(false);
    if (error) return toast.error(error.message);
    setDone(true);
    toast.success('Password updated.');
  };

  return (
    <Dialog open onOpenChange={() => { /* cannot be dismissed */ }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Choose a new password</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You signed in with a temporary password. Set your own password to continue.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <Input type="password" placeholder="New password (min 8 characters)" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
          <Input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Saving…' : 'Save password'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
