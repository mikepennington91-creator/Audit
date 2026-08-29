import { useEffect, useState } from 'react';
import axios from 'axios';
import { BellRing, Mail, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Account = () => {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await axios.get(`${API}/account`);
        setAccount(response.data);
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Failed to load account settings');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const setPreference = async (key, enabled) => {
    if (!account) return;
    const previous = account.notification_preferences[key];
    setAccount(prev => ({
      ...prev,
      notification_preferences: { ...prev.notification_preferences, [key]: enabled },
    }));
    setSavingKey(key);
    try {
      const response = await axios.put(`${API}/account/notification-preferences`, {
        preferences: { [key]: enabled },
      });
      setAccount(prev => ({
        ...prev,
        notification_preferences: response.data.notification_preferences,
      }));
      toast.success('Notification preference updated');
    } catch (error) {
      setAccount(prev => ({
        ...prev,
        notification_preferences: { ...prev.notification_preferences, [key]: previous },
      }));
      toast.error(error.response?.data?.detail || 'Failed to update notification preference');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!account) return null;

  const preferences = account.notification_preferences || {};
  const descriptions = account.notification_preference_descriptions || {};

  return (
    <div className="space-y-6 max-w-4xl" data-testid="account-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Account</h1>
        <p className="text-muted-foreground mt-1">Your profile and notification preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserRound className="w-5 h-5" />Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
            <p className="font-medium mt-1">{account.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
            <p className="font-medium mt-1">{account.email}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Company</p>
            <p className="font-medium mt-1">{account.company_name || 'System'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Role</p>
            <p className="font-medium mt-1 capitalize">{String(account.role || '').replaceAll('_', ' ')}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BellRing className="w-5 h-5" />Notifications</CardTitle>
          <CardDescription>
            Choose which optional email notifications you want to receive. Required in-app workflow notifications, such as an action waiting for your sign-off, remain visible so work cannot be missed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(preferences).map(key => (
            <div key={key} className="flex items-start gap-4 rounded-lg border p-4">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <Label htmlFor={`pref-${key}`} className="font-medium cursor-pointer">
                  {key === 'email_action_assigned' && 'Action assignments'}
                  {key === 'email_action_review' && 'Action review reminders'}
                  {key === 'email_scheduled_audit_reminder' && 'Scheduled audit reminders'}
                </Label>
                <p className="text-sm text-muted-foreground mt-1">{descriptions[key]}</p>
              </div>
              <Checkbox
                id={`pref-${key}`}
                checked={!!preferences[key]}
                disabled={savingKey === key}
                onCheckedChange={(value) => setPreference(key, value === true)}
                aria-label={`Toggle ${key}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default Account;
