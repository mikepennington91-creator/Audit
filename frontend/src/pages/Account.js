import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Bell, CheckCheck, Mail, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const preferenceRows = [
  ['action_assignment_email', 'Action assignments', 'Email me when a corrective action is assigned to me.'],
  ['action_review_in_app', 'Action sign-off notifications', 'Show an in-app notification when a completed action needs my review.'],
  ['action_review_email', 'Action sign-off emails', 'Also email me when a completed action needs my review.'],
  ['scheduled_audit_reminder_email', 'Scheduled audit reminders', 'Email me before an audit I scheduled reaches its due date.'],
];

const Account = () => {
  const [account, setAccount] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');

  const load = async () => {
    try {
      const [accountRes, notificationsRes] = await Promise.all([
        axios.get(`${API}/account`),
        axios.get(`${API}/notifications`),
      ]);
      setAccount(accountRes.data);
      setNotifications(notificationsRes.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load account settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updatePreference = async (key, value) => {
    if (!account) return;
    const previous = account.notification_preferences;
    const next = { ...previous, [key]: value };
    setAccount({ ...account, notification_preferences: next });
    setSaving(key);
    try {
      const response = await axios.put(`${API}/account/notification-preferences`, { preferences: { [key]: value } });
      setAccount((current) => ({ ...current, notification_preferences: response.data.notification_preferences }));
    } catch (error) {
      setAccount((current) => ({ ...current, notification_preferences: previous }));
      toast.error(error.response?.data?.detail || 'Failed to save notification setting');
    } finally {
      setSaving('');
    }
  };

  const markRead = async (notification) => {
    if (notification.read_at) return;
    try {
      const response = await axios.put(`${API}/notifications/${notification.id}/read`);
      setNotifications((current) => current.map((item) => item.id === notification.id ? response.data : item));
    } catch {
      toast.error('Failed to update notification');
    }
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-52 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (!account) return null;

  const unreadCount = notifications.filter((item) => !item.read_at).length;

  return (
    <div className="space-y-6 max-w-5xl" data-testid="account-page">
      <div><h1 className="text-3xl font-bold tracking-tight">My Account</h1><p className="text-muted-foreground mt-1">Manage your details and how Infinit Audit contacts you.</p></div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="w-5 h-5" />Account details</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Name</p><p className="font-medium">{account.name}</p></div>
          <div><p className="text-muted-foreground">Email</p><p className="font-medium">{account.email}</p></div>
          <div><p className="text-muted-foreground">Role</p><p className="font-medium capitalize">{account.role.replaceAll('_', ' ')}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" />Notification preferences</CardTitle><CardDescription>Security emails such as password resets cannot be disabled.</CardDescription></CardHeader>
        <CardContent className="divide-y">
          {preferenceRows.map(([key, title, description]) => (
            <div key={key} className="py-4 flex items-start justify-between gap-6">
              <div><Label htmlFor={key} className="text-base">{title}</Label><p className="text-sm text-muted-foreground mt-1">{description}</p></div>
              <input id={key} type="checkbox" className="mt-1 h-5 w-5 accent-primary" checked={!!account.notification_preferences[key]} disabled={saving === key} onChange={(e) => updatePreference(key, e.target.checked)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" />Notifications {unreadCount > 0 && <Badge>{unreadCount} unread</Badge>}</CardTitle><CardDescription>Updates that need your attention inside Infinit Audit.</CardDescription></div></div></CardHeader>
        <CardContent className="space-y-3">
          {notifications.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">You do not have any notifications yet.</p> : notifications.map((notification) => (
            <div key={notification.id} className={`rounded-lg border p-4 ${notification.read_at ? 'bg-background' : 'bg-muted/40'}`}>
              <div className="flex items-start justify-between gap-4">
                <div><p className="font-medium">{notification.title}</p><p className="text-sm text-muted-foreground mt-1">{notification.message}</p><p className="text-xs text-muted-foreground mt-2">{new Date(notification.created_at).toLocaleString('en-GB')}</p></div>
                {!notification.read_at && <Button size="sm" variant="ghost" onClick={() => markRead(notification)} title="Mark as read"><CheckCheck className="w-4 h-4" /></Button>}
              </div>
              {notification.link && <Button variant="link" className="px-0 mt-2" asChild onClick={() => markRead(notification)}><Link to={notification.link}>Open</Link></Button>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default Account;
