import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const NotificationBell = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refreshCount = async () => {
    try {
      const response = await axios.get(`${API}/notifications/unread-count`);
      setUnreadCount(response.data.count || 0);
    } catch {
      // Notifications should never interrupt the rest of the application shell.
    }
  };

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/notifications?limit=30`);
      setNotifications(response.data || []);
      setUnreadCount((response.data || []).filter(item => !item.read_at).length);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (open) loadNotifications();
  }, [open]);

  const openNotification = async (notification) => {
    if (!notification.read_at) {
      try {
        await axios.put(`${API}/notifications/${notification.id}/read`);
      } catch {
        // Navigation is still useful even if marking read fails.
      }
    }
    setOpen(false);
    await refreshCount();
    if (notification.link) navigate(notification.link);
  };

  const markAllRead = async () => {
    try {
      await axios.put(`${API}/notifications/read-all`);
      setNotifications(prev => prev.map(item => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      // Keep the control unobtrusive if the API is temporarily unavailable.
    }
  };

  const formatDate = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/London',
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications" data-testid="notification-bell">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-semibold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <p className="font-semibold">Notifications</p>
            <p className="text-xs text-muted-foreground">{unreadCount} unread</p>
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="h-8 gap-1">
              <CheckCheck className="w-4 h-4" />
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No notifications yet</div>
          ) : (
            notifications.map(notification => (
              <button
                key={notification.id}
                type="button"
                onClick={() => openNotification(notification)}
                className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/60 transition-colors ${notification.read_at ? '' : 'bg-primary/5'}`}
              >
                <div className="flex items-start gap-2">
                  {!notification.read_at && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{notification.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{notification.message}</p>
                    <p className="text-[11px] text-muted-foreground mt-2">{formatDate(notification.created_at)}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
