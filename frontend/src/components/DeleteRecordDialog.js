import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export default function DeleteRecordDialog({ record, onClose, onDelete }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); }, [record]);
  return <Dialog open={!!record} onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Delete record</DialogTitle><DialogDescription>Delete {record?.audit_name || record?.template_title || 'this record'}? This cannot be undone. Your name and reason will remain in Company Activity.</DialogDescription></DialogHeader><label htmlFor="deletion-reason">Reason for deletion *</label><Textarea id="deletion-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} placeholder="Explain why this record should be deleted" /><DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={busy || !reason.trim()} onClick={async () => { setBusy(true); try { await onDelete(reason.trim()); } finally { setBusy(false); } }}>{busy ? 'Deleting…' : 'Delete record'}</Button></DialogFooter></DialogContent></Dialog>;
}
