import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Bell, CheckCheck, ClipboardCheck, Mail, UserRound, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Textarea } from '../components/ui/textarea';

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
  const [signoffs, setSignoffs] = useState([]);
  const [comments, setComments] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');

  const load = async () => {
    try {
      const [accountRes, notificationsRes, signoffsRes] = await Promise.all([
        axios.get(`${API}/account`),
        axios.get(`${API}/notifications`),
        axios.get(`${API}/workflow/action-signoffs?status=pending`),
      ]);
      setAccount(accountRes.data);
      setNotifications(notificationsRes.data);
      setSignoffs(signoffsRes.data);
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

  const reviewSignoff = async (signoff, approved) => {
    setSaving(signoff.id);
    try {
      await axios.put(`${API}/workflow/action-signoffs/${signoff.id}`, { approved, comment: comments[signoff.id] || '' });
      setSignoffs((current) => current.filter((item) => item.id !== signoff.id));
      toast.success(approved ? 'Corrective action signed off' : 'Corrective action returned for more work');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to review corrective action');
    } finally {
      setSaving('');
    }
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-52 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (!account) return null;

  const unreadCount = notifications.filter((item) => !item.read_at).length;

  return (
    <div className="space-y-6 max-w-5xl" data-testid="account-page">
      <div><h1 className="text-3xl font-bold tracking-tight">My Account</h1><p className="text-muted-foreground mt-1">Manage your details, notifications and action sign-offs.</p></div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="w-5 h-5" />Account details</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Name</p><p className="font-medium">{account.name}</p></div>
          <div><p className="text-muted-foreground">Email</p><p className="font-medium">{account.email}</p></div>
          <div><p className="text-muted-foreground">Role</p><p className="font-medium capitalize">{account.role.replaceAll('_', ' ')}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5" />Actions awaiting my sign-off {signoffs.length > 0 && <Badge>{signoffs.length}</Badge>}</CardTitle><CardDescription>Review the recorded action taken before closing the corrective action workflow.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {signoffs.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No corrective actions are waiting for your sign-off.</p> : signoffs.map((signoff) => (
            <div key={signoff.id} className="rounded-lg border p-4 space-y-3">
              <div><p className="font-medium">{signoff.action?.audit_name || 'Corrective action'}</p><p className="text-sm text-muted-foreground mt-1">{signoff.action?.action_required}</p></div>
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs font-medium text-muted-foreground mb-1">ACTION TAKEN</p><p className="text-sm">{signoff.action_taken}</p></div>
              <Textarea value={comments[signoff.id] || ''} onChange={(e) => setComments((current) => ({ ...current, [signoff.id]: e.target.value }))} placeholder="Optional sign-off comment" />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => reviewSignoff(signoff, true)} disabled={saving === signoff.id}><CheckCheck className="w-4 h-4 mr-2" />Approve & Sign Off</Button>
                <Button variant="outline" onClick={() => reviewSignoff(signoff, false)} disabled={saving === signoff.id}><XCircle className="w-4 h-4 mr-2" />Return for More Work</Button>
                <Button variant="ghost" asChild><Link to="/actions">View Actions</Link></Button>
              </div>
            </div>
          ))}
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
        <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-5 h-5" />Notifications {unreadCount > 0 && <Badge>{unreadCount} unread</Badge>}</CardTitle><CardDescription>Updates that need your attention inside Infinit Audit.</CardDescription></CardHeader>
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
