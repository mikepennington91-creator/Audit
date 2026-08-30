import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { LockKeyhole } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const LOGO_URL = "https://customer-assets.emergentagent.com/job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png";

const ChangeTemporaryPassword = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/auth/change-temporary-password`, { new_password: password });
      await refreshUser();
      toast.success('Password changed successfully');
      navigate('/dashboard', { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <img src={LOGO_URL} alt="Infinit Audit" className="mx-auto h-20 w-auto" />
        </div>
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center">
              <LockKeyhole className="h-5 w-5 text-primary" />
            </div>
            <CardTitle>Choose your password</CardTitle>
            <CardDescription>
              You signed in with a temporary password. Create your own password before continuing to Infinit Audit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Use at least 8 characters and do not reuse your temporary password.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? 'Saving...' : 'Set password and continue'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ChangeTemporaryPassword;
