import { useEffect, useState } from 'react';
import axios from 'axios';
import { Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const EmailReportDialog = ({
  open,
  onOpenChange,
  endpoint,
  title = 'Email report',
  description = 'Send this file as an email attachment.',
  extraPayload = {},
}) => {
  const { user } = useAuth();
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setRecipient(user?.email || '');
      setMessage('');
    }
  }, [open, user?.email]);

  const send = async (event) => {
    event.preventDefault();
    if (!recipient.trim()) return;
    setSending(true);
    try {
      await axios.post(`${API}${endpoint}`, {
        recipient: recipient.trim(),
        message: message.trim() || null,
        ...extraPayload,
      });
      toast.success(`Emailed to ${recipient.trim()}`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to email the file');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={send} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="report-email-recipient">Recipient email</Label>
            <Input
              id="report-email-recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="recipient@example.com"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-email-message">Message (optional)</Label>
            <Textarea
              id="report-email-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add a short message to the email..."
              rows={4}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button type="submit" disabled={sending || !recipient.trim()}>
              {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
              {sending ? 'Sending...' : 'Send Email'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EmailReportDialog;
