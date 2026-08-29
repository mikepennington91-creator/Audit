import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!token) return toast.error('This reset link is invalid');
    if (password !== confirmPassword) return toast.error('Passwords do not match');
    setLoading(true);
    try {
      await axios.post(`${API}/auth/password-reset/confirm`, { token, new_password: password });
      setComplete(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>Your reset link is single-use and expires after 30 minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {complete ? (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-4 text-sm">Your password has been updated successfully.</div>
              <Button className="w-full" asChild><Link to="/login">Sign in</Link></Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
                <p className="text-xs text-muted-foreground">At least 10 characters with a letter and a number.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={10} autoComplete="new-password" />
              </div>
              <Button className="w-full" type="submit" disabled={loading || !token}>{loading ? 'Updating...' : 'Update password'}</Button>
            </form>
          )}
          {!complete && <Button variant="ghost" className="w-full" asChild><Link to="/login">Back to sign in</Link></Button>}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
