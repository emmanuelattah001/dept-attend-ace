import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Blocks the dashboard until a student with a temporary (admin-issued) password chooses their own.
 * The protected database row is authoritative; user-editable auth metadata is not trusted.
 */
export default function ForcePasswordChange() {
  const { user } = useAuth();
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [mustChange, setMustChange] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPasswordState = useCallback(async () => {
    if (!user) {
      setMustChange(false);
      setLoadError(null);
      return;
    }

    setMustChange(null);
    setLoadError(null);
    const { data, error } = await supabase
      .from('student_password_controls')
      .select('must_change_password')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      return;
    }
    if (!data) {
      setLoadError('Password setup status is unavailable. Please contact an administrator.');
      return;
    }
    setMustChange(data.must_change_password);
  }, [user]);

  useEffect(() => {
    void loadPasswordState();
  }, [loadPasswordState]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) return toast.error('Use at least 8 characters.');
    if (pwd !== confirm) return toast.error('Passwords do not match.');
    setSaving(true);
    try {
      const { error } = await supabase.rpc('student_change_initial_password', {
        _password: pwd,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setMustChange(false);
      toast.success('Password updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Password update failed.');
    } finally {
      setSaving(false);
    }
  };

  if (mustChange === false) return null;

  return (
    <Dialog open onOpenChange={() => { /* cannot be dismissed */ }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{mustChange === null ? 'Checking password setup' : 'Choose a new password'}</DialogTitle>
        </DialogHeader>
        {mustChange === null ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {loadError ?? 'Checking your account password setup...'}
            </p>
            {loadError && (
              <Button type="button" className="w-full" onClick={() => void loadPasswordState()}>
                Try again
              </Button>
            )}
            {!loadError && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You signed in with a temporary password. Set your own password to continue.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <Input type="password" placeholder="New password (min 8 characters)" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
              <Input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Saving…' : 'Save password'}</Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
