import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { AlertTriangle, Archive, CheckCircle2, Clock3, Eye, FileDown, History, RotateCcw, Trash2, UserRoundCog } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Textarea } from '../components/ui/textarea';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Actions = () => {
  const { user, isAdmin } = useAuth();
  const canAdmin = isAdmin();
  const [actions, setActions] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [actionTaken, setActionTaken] = useState('');
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [reassignUserId, setReassignUserId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [requestedDueDate, setRequestedDueDate] = useState('');
  const [extensionReason, setExtensionReason] = useState('');
  const [decisionComment, setDecisionComment] = useState('');

  const fetchActions = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/actions${canAdmin ? '?include_archived=true' : ''}`);
      setActions(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load corrective actions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActions();
    axios.get(`${API}/action-assignees`).then((r) => setAssignees(r.data)).catch(() => setAssignees([]));
  }, []);

  const visibleActions = actions.filter((action) => !!action.archived === showArchived);
  const counts = useMemo(() => ({
    open: visibleActions.filter((action) => action.status === 'open').length,
    overdue: visibleActions.filter((action) => action.status === 'overdue').length,
    completed: visibleActions.filter((action) => action.status === 'completed').length,
  }), [visibleActions]);

  const filteredActions = statusFilter === 'all' ? visibleActions : visibleActions.filter((action) => action.status === statusFilter);
  const assignedTo = (action) => action.assigned_user_name || action.assigned_department || 'Unassigned';
  const formatDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB') : '-';
  const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '-';
  const isMine = (action) => action?.assigned_user_id === user?.id;

  const statusBadge = (status) => {
    if (status === 'completed') return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">Completed</Badge>;
    if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>;
    return <Badge variant="secondary">Open</Badge>;
  };

  const replaceAction = (updated) => {
    setActions((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedAction(updated);
  };

  const openAction = (action) => {
    setSelectedAction(action);
    setActionTaken(action.action_taken || '');
    setReassignUserId(''); setReassignReason(''); setRequestedDueDate(''); setExtensionReason(''); setDecisionComment('');
  };

  const completeAction = async (event) => {
    event.preventDefault();
    if (!actionTaken.trim()) return toast.error('Please record the action taken');
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}`, { action_taken: actionTaken });
      replaceAction(response.data); toast.success('Corrective action completed');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed to complete action'); }
    finally { setSaving(false); }
  };

  const reassignAction = async () => {
    if (!reassignUserId || !reassignReason.trim()) return toast.error('Select a new owner and enter a reason');
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/reassign`, { assigned_user_id: reassignUserId, reason: reassignReason });
      replaceAction(response.data); setReassignUserId(''); setReassignReason(''); toast.success('Action reassigned');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed to reassign action'); }
    finally { setSaving(false); }
  };

  const requestExtension = async () => {
    if (!requestedDueDate || !extensionReason.trim()) return toast.error('Enter a requested date and reason');
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/extension-request`, { requested_due_date: requestedDueDate, reason: extensionReason });
      replaceAction(response.data); setRequestedDueDate(''); setExtensionReason(''); toast.success('Extension request sent for approval');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed to request extension'); }
    finally { setSaving(false); }
  };

  const decideExtension = async (approved) => {
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/extension-decision`, { approved, comment: decisionComment });
      replaceAction(response.data); setDecisionComment(''); toast.success(approved ? 'Extension approved' : 'Extension rejected');
    } catch (error) { toast.error(error.response?.data?.detail || 'Failed to record decision'); }
    finally { setSaving(false); }
  };

  const archiveAction = async () => {
    if (!window.confirm('Archive this action? It will move out of the active tracker but its history will be kept.')) return;
    try { const response = await axios.put(`${API}/actions/${selectedAction.id}/archive`); replaceAction(response.data); setSelectedAction(null); toast.success('Action archived'); }
    catch (error) { toast.error(error.response?.data?.detail || 'Failed to archive action'); }
  };

  const restoreAction = async () => {
    try { const response = await axios.put(`${API}/actions/${selectedAction.id}/restore`); replaceAction(response.data); setSelectedAction(null); toast.success('Action restored'); }
    catch (error) { toast.error(error.response?.data?.detail || 'Failed to restore action'); }
  };

  const deleteAction = async () => {
    if (!window.confirm('Permanently delete this action? This cannot be undone.')) return;
    try { await axios.delete(`${API}/actions/${selectedAction.id}`); setActions((current) => current.filter((item) => item.id !== selectedAction.id)); setSelectedAction(null); toast.success('Action deleted'); }
    catch (error) { toast.error(error.response?.data?.detail || 'Failed to delete action'); }
  };

  const downloadReport = async (action) => {
    setDownloading(action.id);
    try {
      const response = await axios.get(`${API}/actions/${action.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a'); link.href = url; link.setAttribute('download', `action_report_${action.id.slice(0, 8)}.pdf`);
      document.body.appendChild(link); link.click(); link.remove(); window.URL.revokeObjectURL(url);
    } catch { toast.error('Failed to download action report'); }
    finally { setDownloading(''); }
  };

  const filters = [
    { key: 'all', label: `All (${visibleActions.length})` },
    { key: 'open', label: `Open (${counts.open})` },
    { key: 'overdue', label: `Overdue (${counts.overdue})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
  ];

  return (
    <div className="space-y-6" data-testid="actions-page">
      <div className="flex items-start justify-between gap-4 flex-wrap"><div><h1 className="text-3xl font-bold tracking-tight">Corrective Actions</h1><p className="text-muted-foreground mt-1">Track corrective actions, ownership changes and due-date approvals.</p></div></div>
      <div className="grid sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6 flex items-center gap-4"><Clock3 className="w-8 h-8 text-amber-600" /><div><p className="text-2xl font-bold">{counts.open}</p><p className="text-sm text-muted-foreground">Open</p></div></CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center gap-4"><AlertTriangle className="w-8 h-8 text-red-600" /><div><p className="text-2xl font-bold">{counts.overdue}</p><p className="text-sm text-muted-foreground">Overdue</p></div></CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center gap-4"><CheckCircle2 className="w-8 h-8 text-emerald-600" /><div><p className="text-2xl font-bold">{counts.completed}</p><p className="text-sm text-muted-foreground">Completed</p></div></CardContent></Card>
      </div>
      <Card><CardHeader className="space-y-4"><div className="flex items-center justify-between gap-3 flex-wrap"><CardTitle className="text-lg">Action Reports</CardTitle>{canAdmin && <Button variant={showArchived ? 'default' : 'outline'} size="sm" onClick={() => { setShowArchived(!showArchived); setStatusFilter('all'); }}>{showArchived ? 'Viewing Archived' : 'View Archived'}</Button>}</div><div className="flex flex-wrap gap-2">{filters.map((filter) => <Button key={filter.key} size="sm" variant={statusFilter === filter.key ? 'default' : 'outline'} onClick={() => setStatusFilter(filter.key)}>{filter.label}</Button>)}</div></CardHeader>
        <CardContent>{loading ? <div className="space-y-3">{[1,2,3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}</div> : filteredActions.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Non-Conformance</TableHead><TableHead>Action Required</TableHead><TableHead>Who</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Report</TableHead></TableRow></TableHeader><TableBody>{filteredActions.map((action) => <TableRow key={action.id}><TableCell className="max-w-xs"><p className="font-medium">{action.audit_name}</p><p className="text-sm text-muted-foreground line-clamp-2">{action.non_conformance}</p></TableCell><TableCell className="max-w-xs">{action.action_required}</TableCell><TableCell>{assignedTo(action)}</TableCell><TableCell>{formatDate(action.due_date)}{action.extension_request?.status === 'pending' && <Badge className="ml-2 bg-amber-100 text-amber-800">Extension Pending</Badge>}</TableCell><TableCell>{statusBadge(action.status)}</TableCell><TableCell className="text-right whitespace-nowrap"><Button variant="ghost" size="sm" onClick={() => openAction(action)}><Eye className="w-4 h-4" /></Button><Button variant="ghost" size="sm" disabled={downloading === action.id} onClick={() => downloadReport(action)}>{downloading === action.id ? '...' : <FileDown className="w-4 h-4" />}</Button></TableCell></TableRow>)}</TableBody></Table></div> : <div className="text-center py-12"><p className="text-muted-foreground">No corrective actions match this view.</p></div>}</CardContent>
      </Card>

      <Dialog open={!!selectedAction} onOpenChange={(open) => { if (!open) setSelectedAction(null); }}><DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>Corrective Action Report</DialogTitle></DialogHeader>{selectedAction && <div className="space-y-5">
        <div className="grid sm:grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-sm"><div><p className="text-muted-foreground">Audit</p><p className="font-medium">{selectedAction.audit_name}</p></div><div><p className="text-muted-foreground">Status</p>{statusBadge(selectedAction.status)}</div><div><p className="text-muted-foreground">Assigned to</p><p className="font-medium">{assignedTo(selectedAction)}</p></div><div><p className="text-muted-foreground">Due date</p><p className="font-medium">{formatDate(selectedAction.due_date)}</p></div></div>
        <div><Label>Audit Question</Label><p className="mt-1 text-sm">{selectedAction.question_text}</p></div><div><Label>Non-Conformance</Label><p className="mt-1 rounded-md border p-3 text-sm">{selectedAction.non_conformance}</p></div><div><Label>Action Required</Label><p className="mt-1 rounded-md border p-3 text-sm">{selectedAction.action_required}</p></div>

        {selectedAction.extension_request?.status === 'pending' && <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3"><div><p className="font-medium">Due Date Extension Awaiting Approval</p><p className="text-sm">Requested: {formatDate(selectedAction.extension_request.requested_due_date)} by {selectedAction.extension_request.requested_by_name}</p><p className="text-sm text-muted-foreground mt-1">{selectedAction.extension_request.reason}</p></div>{canAdmin && <><Textarea value={decisionComment} onChange={(e) => setDecisionComment(e.target.value)} placeholder="Optional approval/rejection comment" /><div className="flex gap-2"><Button onClick={() => decideExtension(true)} disabled={saving}>Approve</Button><Button variant="outline" onClick={() => decideExtension(false)} disabled={saving}>Reject</Button></div></>}</div>}

        {isMine(selectedAction) && selectedAction.status !== 'completed' && !selectedAction.archived && <div className="grid md:grid-cols-2 gap-4"><Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><UserRoundCog className="w-4 h-4" />Reassign My Action</CardTitle></CardHeader><CardContent className="space-y-3"><select className="w-full h-10 rounded-md border bg-background px-3" value={reassignUserId} onChange={(e) => setReassignUserId(e.target.value)}><option value="">Select new owner</option>{assignees.filter((a) => a.id !== user?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><Textarea value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} placeholder="Reason for reassignment *" /><Button onClick={reassignAction} disabled={saving}>Reassign</Button></CardContent></Card><Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock3 className="w-4 h-4" />Request Due Date Extension</CardTitle></CardHeader><CardContent className="space-y-3"><Input type="date" value={requestedDueDate} onChange={(e) => setRequestedDueDate(e.target.value)} /><Textarea value={extensionReason} onChange={(e) => setExtensionReason(e.target.value)} placeholder="Reason for extension *" /><Button onClick={requestExtension} disabled={saving || selectedAction.extension_request?.status === 'pending'}>Request Extension</Button></CardContent></Card></div>}

        {selectedAction.status === 'completed' ? <div><Label>Action Taken</Label><p className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">{selectedAction.action_taken}</p><p className="text-xs text-muted-foreground mt-2">Completed by {selectedAction.completed_by_name} on {formatDateTime(selectedAction.completed_at)}</p></div> : !selectedAction.archived && <form onSubmit={completeAction} className="space-y-3"><Label>Action Taken *</Label><Textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={4} required /><Button type="submit" disabled={saving}><CheckCircle2 className="w-4 h-4 mr-2" />Complete Action</Button></form>}

        <div><div className="flex items-center gap-2 mb-2"><History className="w-4 h-4" /><Label>Action History</Label></div><div className="space-y-2">{(selectedAction.history || []).length ? [...selectedAction.history].reverse().map((entry) => <div key={entry.id} className="rounded-md border p-3 text-sm"><p>{entry.message}</p><p className="text-xs text-muted-foreground mt-1">{entry.user_name} · {formatDateTime(entry.created_at)}</p></div>) : <p className="text-sm text-muted-foreground">No changes recorded yet.</p>}</div></div>

        <div className="flex justify-between gap-2 flex-wrap border-t pt-4"><Button variant="outline" onClick={() => downloadReport(selectedAction)}><FileDown className="w-4 h-4 mr-2" />Download PDF</Button>{canAdmin && <div className="flex gap-2">{selectedAction.archived ? <Button variant="outline" onClick={restoreAction}><RotateCcw className="w-4 h-4 mr-2" />Restore</Button> : <Button variant="outline" onClick={archiveAction}><Archive className="w-4 h-4 mr-2" />Archive</Button>}<Button variant="destructive" onClick={deleteAction}><Trash2 className="w-4 h-4 mr-2" />Delete</Button></div>}</div>
      </div>}</DialogContent></Dialog>
    </div>
  );
};

export default Actions;
