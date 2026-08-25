import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Clock3, Eye, FileDown, ListChecks } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Textarea } from '../components/ui/textarea';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Actions = () => {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedAction, setSelectedAction] = useState(null);
  const [actionTaken, setActionTaken] = useState('');
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState('');

  const fetchActions = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/actions`);
      setActions(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to load corrective actions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActions();
  }, []);

  const counts = useMemo(() => ({
    open: actions.filter((action) => action.status === 'open').length,
    overdue: actions.filter((action) => action.status === 'overdue').length,
    completed: actions.filter((action) => action.status === 'completed').length,
  }), [actions]);

  const filteredActions = statusFilter === 'all'
    ? actions
    : actions.filter((action) => action.status === statusFilter);

  const openAction = (action) => {
    setSelectedAction(action);
    setActionTaken(action.action_taken || '');
  };

  const completeAction = async (event) => {
    event.preventDefault();
    if (!actionTaken.trim()) {
      toast.error('Please record the action taken');
      return;
    }
    setSaving(true);
    try {
      const response = await axios.put(`${API}/actions/${selectedAction.id}`, { action_taken: actionTaken });
      setActions((current) => current.map((action) => action.id === response.data.id ? response.data : action));
      setSelectedAction(response.data);
      toast.success('Corrective action completed');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to complete action');
    } finally {
      setSaving(false);
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
    } catch (error) {
      toast.error('Failed to download action report');
    } finally {
      setDownloading('');
    }
  };

  const assignedTo = (action) => action.assigned_user_name || action.assigned_department || 'Unassigned';
  const formatDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB') : '-';
  const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '-';
  const statusBadge = (status) => {
    if (status === 'completed') return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">Completed</Badge>;
    if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>;
    return <Badge variant="secondary">Open</Badge>;
  };

  const filters = [
    { key: 'all', label: `All (${actions.length})` },
    { key: 'open', label: `Open (${counts.open})` },
    { key: 'overdue', label: `Overdue (${counts.overdue})` },
    { key: 'completed', label: `Completed (${counts.completed})` },
  ];

  return (
    <div className="space-y-6" data-testid="actions-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Corrective Actions</h1>
          <p className="text-muted-foreground mt-1">View and complete corrective actions assigned to you.</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-6 flex items-center gap-4"><Clock3 className="w-8 h-8 text-amber-600" /><div><p className="text-2xl font-bold">{counts.open}</p><p className="text-sm text-muted-foreground">Open</p></div></CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center gap-4"><AlertTriangle className="w-8 h-8 text-red-600" /><div><p className="text-2xl font-bold">{counts.overdue}</p><p className="text-sm text-muted-foreground">Overdue</p></div></CardContent></Card>
        <Card><CardContent className="pt-6 flex items-center gap-4"><CheckCircle2 className="w-8 h-8 text-emerald-600" /><div><p className="text-2xl font-bold">{counts.completed}</p><p className="text-sm text-muted-foreground">Completed</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <CardTitle className="text-lg flex items-center gap-2"><ListChecks className="w-5 h-5" />Action Reports</CardTitle>
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Button key={filter.key} size="sm" variant={statusFilter === filter.key ? 'default' : 'outline'} onClick={() => setStatusFilter(filter.key)}>
                {filter.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}</div>
          ) : filteredActions.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Non-Conformance</TableHead><TableHead>Action Required</TableHead><TableHead>Who</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Report</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredActions.map((action) => (
                    <TableRow key={action.id} data-testid={`action-row-${action.id}`}>
                      <TableCell className="max-w-xs"><p className="font-medium">{action.audit_name}</p><p className="text-sm text-muted-foreground line-clamp-2">{action.non_conformance}</p></TableCell>
                      <TableCell className="max-w-xs"><p className="line-clamp-2">{action.action_required}</p></TableCell>
                      <TableCell>{assignedTo(action)}</TableCell>
                      <TableCell>{formatDate(action.due_date)}</TableCell>
                      <TableCell>{statusBadge(action.status)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => openAction(action)} aria-label="View action"><Eye className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="sm" disabled={downloading === action.id} onClick={() => downloadReport(action)} aria-label="Download action report">
                          {downloading === action.id ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <FileDown className="w-4 h-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12"><ListChecks className="w-12 h-12 mx-auto text-muted-foreground opacity-30 mb-3" /><p className="text-muted-foreground">No corrective actions match this view.</p></div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedAction} onOpenChange={(open) => { if (!open) setSelectedAction(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Corrective Action Report</DialogTitle></DialogHeader>
          {selectedAction && (
            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-sm">
                <div><p className="text-muted-foreground">Audit</p><p className="font-medium">{selectedAction.audit_name}</p></div>
                <div><p className="text-muted-foreground">Status</p><div className="mt-1">{statusBadge(selectedAction.status)}</div></div>
                <div><p className="text-muted-foreground">Assigned to</p><p className="font-medium">{assignedTo(selectedAction)}</p></div>
                <div><p className="text-muted-foreground">Due date</p><p className="font-medium">{formatDate(selectedAction.due_date)}</p></div>
              </div>
              <div><Label>Audit Question</Label><p className="mt-1 text-sm">{selectedAction.question_text}</p></div>
              <div><Label>Non-Conformance</Label><p className="mt-1 rounded-md border p-3 text-sm">{selectedAction.non_conformance}</p></div>
              <div><Label>Action Required</Label><p className="mt-1 rounded-md border p-3 text-sm">{selectedAction.action_required}</p></div>
              {selectedAction.status === 'completed' ? (
                <div className="space-y-3">
                  <div><Label>Action Taken</Label><p className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">{selectedAction.action_taken}</p></div>
                  <p className="text-xs text-muted-foreground">Completed by {selectedAction.completed_by_name} on {formatDateTime(selectedAction.completed_at)}</p>
                </div>
              ) : (
                <form onSubmit={completeAction} className="space-y-3">
                  <div className="space-y-2"><Label htmlFor="action-taken">Action Taken *</Label><Textarea id="action-taken" value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} placeholder="Describe what was completed and any evidence or outcome..." rows={5} required /></div>
                  <div className="flex justify-end"><Button type="submit" disabled={saving}><CheckCircle2 className="w-4 h-4 mr-2" />{saving ? 'Completing...' : 'Complete Action'}</Button></div>
                </form>
              )}
              <div className="flex justify-end"><Button variant="outline" onClick={() => downloadReport(selectedAction)}><FileDown className="w-4 h-4 mr-2" />Download PDF</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Actions;
