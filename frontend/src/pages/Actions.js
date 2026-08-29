import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { AlertTriangle, Archive, CheckCircle2, Clock3, Eye, FileDown, History, Mail, RotateCcw, ShieldCheck, Trash2, UserRoundCog, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import EmailReportDialog from '../components/EmailReportDialog';
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
  const [emailActionId, setEmailActionId] = useState(null);
  const [reassignUserId, setReassignUserId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [requestedDueDate, setRequestedDueDate] = useState('');
  const [extensionReason, setExtensionReason] = useState('');
  const [decisionComment, setDecisionComment] = useState('');
  const [reviewComment, setReviewComment] = useState('');

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
    awaiting_review: visibleActions.filter((action) => action.status === 'awaiting_review').length,
    completed: visibleActions.filter((action) => action.status === 'completed').length,
  }), [visibleActions]);

  const filteredActions = statusFilter === 'all' ? visibleActions : visibleActions.filter((action) => action.status === statusFilter);
  const assignedTo = (action) => action.assigned_user_name || action.assigned_department || 'Unassigned';
  const formatDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '-';
  const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '-';
  const isMine = (action) => action?.assigned_user_id === user?.id;

  const statusBadge = (status) => {
    if (status === 'completed') return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">Completed</Badge>;
    if (status === 'awaiting_review') return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Awaiting Review</Badge>;
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
    setReassignUserId('');
    setReassignReason('');
    setRequestedDueDate('');
    setExtensionReason('');
    setDecisionComment('');
    setReviewComment('');
  };

  const submitActionForReview = async (event) => {
    event.preventDefault();
    if (!actionTaken.trim()) return toast.error('Please record the action taken');
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}`, { action_taken: actionTaken });
      replaceAction(response.data);
      toast.success('Action submitted to the owner for review and sign-off');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit action for review');
    } finally {
      setSaving(false);
    }
  };

  const reviewAction = async (approved) => {
    if (!approved && !reviewComment.trim()) return toast.error('Enter a reason before rejecting the action');
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/review`, {
        approved,
        comment: reviewComment.trim() || null,
      });
      replaceAction(response.data);
      setReviewComment('');
      toast.success(approved ? 'Action reviewed and signed off' : 'Action returned for further work');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to record the review');
    } finally {
      setSaving(false);
    }
  };

  const reassignAction = async () => {
    if (!reassignUserId || !reassignReason.trim()) return toast.error('Select a new owner and enter a reason');
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/reassign`, { assigned_user_id: reassignUserId, reason: reassignReason });
      replaceAction(response.data);
      setReassignUserId('');
      setReassignReason('');
      toast.success('Action reassigned and the new owner notified');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reassign action');
    } finally {
      setSaving(false);
    }
  };

  const requestExtension = async () => {
    if (!requestedDueDate || !extensionReason.trim()) return toast.error('Enter a requested date and reason');
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/extension-request`, { requested_due_date: requestedDueDate, reason: extensionReason });
      replaceAction(response.data);
      setRequestedDueDate('');
      setExtensionReason('');
      toast.success('Extension request sent for approval');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to request extension');
    } finally {
      setSaving(false);
    }
  };

  const decideExtension = async (approved) => {
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/extension-decision`, { approved, comment: decisionComment });
      replaceAction(response.data);
      setDecisionComment('');
      toast.success(approved ? 'Extension approved' : 'Extension rejected');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to record decision');
    } finally {
      setSaving(false);
    }
  };

  const archiveAction = async () => {
    if (!window.confirm('Archive this action? It will move out of the active tracker but its history will be kept.')) return;
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/archive`);
      replaceAction(response.data);
      setSelectedAction(null);
      toast.success('Action archived');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to archive action');
    }
  };

  const restoreAction = async () => {
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}/restore`);
      replaceAction(response.data);
      setSelectedAction(null);
      toast.success('Action restored');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to restore action');
    }
  };

  const deleteAction = async () => {
    if (!window.confirm('Permanently delete this action? This cannot be undone.')) return;
    try {
      await axios.delete(`${API}/actions/${selectedAction.id}`);
      setActions((current) => current.filter((item) => item.id !== selectedAction.id));
      setSelectedAction(null);
      toast.success('Action deleted');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete action');
    }
  };

  const downloadReport = async (action) => {
    setDownloading(action.id);
    try {
      const response = await axios.get(`${API}/actions/${action.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `action_report_${action.id.slice(0, 8)}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download action report');
    } finally {
      setDownloading('');
    }
  };

  const filters = [
    { key: 'all', label: `All (${visibleActions.length})` },
    { key: 'open', label: `Open (${counts.open})` },
    { key: 'overdue', label: `Overdue (${counts.overdue})` },
    { key: 'awaiting_review', label: `Awaiting Review (${counts.awaiting_review})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
  ];

  const canReassignSelected = selectedAction && !selectedAction.archived && !['completed', 'awaiting_review'].includes(selectedAction.status) && (isMine(selectedAction) || canAdmin);
  const canRequestExtension = selectedAction && !selectedAction.archived && !['completed', 'awaiting_review'].includes(selectedAction.status) && isMine(selectedAction);

  return (
    <div className="space-y-6" data-testid="actions-page">
      <div><h1 className="text-3xl font-bold tracking-tight">Corrective Actions</h1><p className="text-muted-foreground mt-1">Track actions from assignment through completion, owner review and final sign-off.</p></div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6 flex items-center gap-4"><Clock3 className="w-8 h-8 text-amber-600" /><div><p className="text-2xl font-bold">{counts.open}</p><p className="text-sm text-muted-foreground">Open</p></div></CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center gap-4"><AlertTriangle className="w-8 h-8 text-red-600" /><div><p className="text-2xl font-bold">{counts.overdue}</p><p className="text-sm text-muted-foreground">Overdue</p></div></CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center gap-4"><ShieldCheck className="w-8 h-8 text-blue-600" /><div><p className="text-2xl font-bold">{counts.awaiting_review}</p><p className="text-sm text-muted-foreground">Awaiting Review</p></div></CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center gap-4"><CheckCircle2 className="w-8 h-8 text-emerald-600" /><div><p className="text-2xl font-bold">{counts.completed}</p><p className="text-sm text-muted-foreground">Completed</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap"><CardTitle className="text-lg">Action Reports</CardTitle>{canAdmin && <Button variant={showArchived ? 'default' : 'outline'} size="sm" onClick={() => { setShowArchived(!showArchived); setStatusFilter('all'); }}>{showArchived ? 'Viewing Archived' : 'View Archived'}</Button>}</div>
          <div className="flex flex-wrap gap-2">{filters.map((filter) => <Button key={filter.key} size="sm" variant={statusFilter === filter.key ? 'default' : 'outline'} onClick={() => setStatusFilter(filter.key)}>{filter.label}</Button>)}</div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{[1,2,3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}</div>
          ) : filteredActions.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Non-Conformance</TableHead><TableHead>Action Required</TableHead><TableHead>Owner</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Report</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredActions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell className="max-w-xs"><p className="font-medium">{action.audit_name}</p><p className="text-sm text-muted-foreground line-clamp-2">{action.non_conformance}</p></TableCell>
                      <TableCell className="max-w-xs">{action.action_required}</TableCell>
                      <TableCell>{assignedTo(action)}</TableCell>
                      <TableCell>{formatDate(action.due_date)}{action.extension_request?.status === 'pending' && <Badge className="ml-2 bg-amber-100 text-amber-800">Extension Pending</Badge>}</TableCell>
                      <TableCell>{statusBadge(action.status)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap"><Button variant="ghost" size="sm" onClick={() => openAction(action)} title="View action"><Eye className="w-4 h-4" /></Button><Button variant="ghost" size="sm" disabled={downloading === action.id} onClick={() => downloadReport(action)} title="Download PDF">{downloading === action.id ? '...' : <FileDown className="w-4 h-4" />}</Button><Button variant="ghost" size="sm" onClick={() => setEmailActionId(action.id)} title="Email PDF"><Mail className="w-4 h-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : <div className="text-center py-12"><p className="text-muted-foreground">No corrective actions match this view.</p></div>}
        </CardContent>
      </Card>

      <Dialog open={!!selectedAction} onOpenChange={(open) => { if (!open) setSelectedAction(null); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Corrective Action Report</DialogTitle></DialogHeader>
          {selectedAction && <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-sm"><div><p className="text-muted-foreground">Audit</p><p className="font-medium">{selectedAction.audit_name}</p></div><div><p className="text-muted-foreground">Status</p>{statusBadge(selectedAction.status)}</div><div><p className="text-muted-foreground">Action owner</p><p className="font-medium">{assignedTo(selectedAction)}</p></div><div><p className="text-muted-foreground">Due date</p><p className="font-medium">{formatDate(selectedAction.due_date)}</p></div></div>
            <div><Label>Audit Question</Label><p className="mt-1 text-sm">{selectedAction.question_text}</p></div>
            <div><Label>Non-Conformance</Label><p className="mt-1 rounded-md border p-3 text-sm">{selectedAction.non_conformance}</p></div>
            <div><Label>Action Required</Label><p className="mt-1 rounded-md border p-3 text-sm">{selectedAction.action_required}</p></div>

            {selectedAction.extension_request?.status === 'pending' && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
                <div><p className="font-medium">Due Date Extension Awaiting Approval</p><p className="text-sm">Requested: {formatDate(selectedAction.extension_request.requested_due_date)} by {selectedAction.extension_request.requested_by_name}</p><p className="text-sm text-muted-foreground mt-1">{selectedAction.extension_request.reason}</p></div>
                {canAdmin && <><Textarea value={decisionComment} onChange={(e) => setDecisionComment(e.target.value)} placeholder="Optional approval/rejection comment" /><div className="flex gap-2"><Button onClick={() => decideExtension(true)} disabled={saving}>Approve</Button><Button variant="outline" onClick={() => decideExtension(false)} disabled={saving}>Reject</Button></div></>}
              </div>
            )}

            {(canReassignSelected || canRequestExtension) && (
              <div className={`grid ${canReassignSelected && canRequestExtension ? 'md:grid-cols-2' : 'md:grid-cols-1'} gap-4`}>
                {canReassignSelected && <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><UserRoundCog className="w-4 h-4" />Reassign Action</CardTitle></CardHeader><CardContent className="space-y-3"><select className="w-full h-10 rounded-md border bg-background px-3" value={reassignUserId} onChange={(e) => setReassignUserId(e.target.value)}><option value="">Select new owner</option>{assignees.filter((a) => a.id !== selectedAction.assigned_user_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><Textarea value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} placeholder="Reason for reassignment *" /><Button onClick={reassignAction} disabled={saving}>Reassign</Button></CardContent></Card>}
                {canRequestExtension && <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock3 className="w-4 h-4" />Request Due Date Extension</CardTitle></CardHeader><CardContent className="space-y-3"><Input type="date" value={requestedDueDate} onChange={(e) => setRequestedDueDate(e.target.value)} /><Textarea value={extensionReason} onChange={(e) => setExtensionReason(e.target.value)} placeholder="Reason for extension *" /><Button onClick={requestExtension} disabled={saving || selectedAction.extension_request?.status === 'pending'}>Request Extension</Button></CardContent></Card>}
              </div>
            )}

            {selectedAction.status === 'completed' ? (
              <div className="space-y-3">
                <div><Label>Action Taken</Label><p className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/20">{selectedAction.action_taken}</p><p className="text-xs text-muted-foreground mt-2">Submitted by {selectedAction.completed_by_name} on {formatDateTime(selectedAction.completed_at)}</p></div>
                {selectedAction.reviewed_by_name && <div className="rounded-lg border border-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/20 p-4"><p className="font-medium flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Signed off by {selectedAction.reviewed_by_name}</p><p className="text-xs text-muted-foreground mt-1">{formatDateTime(selectedAction.reviewed_at)}</p>{selectedAction.review_comment && <p className="text-sm mt-2">{selectedAction.review_comment}</p>}</div>}
              </div>
            ) : selectedAction.status === 'awaiting_review' ? (
              <div className="space-y-4 rounded-lg border border-blue-300 bg-blue-50/70 dark:bg-blue-950/20 p-4">
                <div><p className="font-medium flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-blue-600" />Completion submitted for owner review</p><p className="text-sm mt-2"><strong>Action taken:</strong> {selectedAction.action_taken}</p><p className="text-xs text-muted-foreground mt-2">Submitted by {selectedAction.completed_by_name} on {formatDateTime(selectedAction.completed_at)}</p></div>
                {isMine(selectedAction) ? (
                  <div className="space-y-3 border-t border-blue-200 pt-4"><Label>Owner Review / Sign-Off</Label><Textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="Review comment (required if returning the action for more work)" rows={3} /><div className="flex flex-wrap gap-2"><Button onClick={() => reviewAction(true)} disabled={saving}><ShieldCheck className="w-4 h-4 mr-2" />Approve & Sign Off</Button><Button variant="outline" onClick={() => reviewAction(false)} disabled={saving}><XCircle className="w-4 h-4 mr-2" />Return for More Work</Button></div></div>
                ) : <p className="text-sm text-muted-foreground border-t border-blue-200 pt-3">Waiting for {assignedTo(selectedAction)} to review and sign off this action.</p>}
              </div>
            ) : !selectedAction.archived && (
              <form onSubmit={submitActionForReview} className="space-y-3"><Label>Action Taken *</Label><Textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={4} required /><Button type="submit" disabled={saving}><CheckCircle2 className="w-4 h-4 mr-2" />Submit for Owner Review</Button></form>
            )}

            <div><div className="flex items-center gap-2 mb-2"><History className="w-4 h-4" /><Label>Action History</Label></div><div className="space-y-2">{(selectedAction.history || []).length ? [...selectedAction.history].reverse().map((entry) => <div key={entry.id} className="rounded-md border p-3 text-sm"><p>{entry.message}</p><p className="text-xs text-muted-foreground mt-1">{entry.user_name} · {formatDateTime(entry.created_at)}</p></div>) : <p className="text-sm text-muted-foreground">No changes recorded yet.</p>}</div></div>

            <div className="flex justify-between gap-2 flex-wrap border-t pt-4"><div className="flex gap-2 flex-wrap"><Button variant="outline" onClick={() => downloadReport(selectedAction)}><FileDown className="w-4 h-4 mr-2" />Download PDF</Button><Button variant="outline" onClick={() => setEmailActionId(selectedAction.id)}><Mail className="w-4 h-4 mr-2" />Email PDF</Button></div>{canAdmin && <div className="flex gap-2">{selectedAction.archived ? <Button variant="outline" onClick={restoreAction}><RotateCcw className="w-4 h-4 mr-2" />Restore</Button> : <Button variant="outline" onClick={archiveAction}><Archive className="w-4 h-4 mr-2" />Archive</Button>}<Button variant="destructive" onClick={deleteAction}><Trash2 className="w-4 h-4 mr-2" />Delete</Button></div>}</div>
          </div>}
        </DialogContent>
      </Dialog>

      <EmailReportDialog
        open={!!emailActionId}
        onOpenChange={(open) => { if (!open) setEmailActionId(null); }}
        endpoint={emailActionId ? `/reports/actions/${emailActionId}/email` : ''}
        title="Email corrective action report"
        description="Send the corrective action PDF as an email attachment."
      />
    </div>
  );
};

export default Actions;
