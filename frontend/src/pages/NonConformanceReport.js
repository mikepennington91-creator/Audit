import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Eye, FileDown,
  FileText, Printer, Search, ShieldCheck,
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const localISODate = (value = new Date()) => {
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10);
};

const daysAgo = (days) => {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return localISODate(value);
};

const formatDate = (value) => value
  ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB')
  : '-';

const formatDateTime = (value) => value
  ? new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London' })
  : '-';

const statusBadge = (status) => {
  if (status === 'completed') return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Closed</Badge>;
  if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>;
  if (status === 'awaiting_review') return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Awaiting Review</Badge>;
  if (status === 'effectiveness_pending') return <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">Effectiveness Review</Badge>;
  return <Badge variant="secondary">Open</Badge>;
};

const NonConformanceReport = () => {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState(daysAgo(29));
  const [dateTo, setDateTo] = useState(localISODate());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState('');

  const runReport = async (from = dateFrom, to = dateTo) => {
    if (!from || !to) return toast.error('Select both report dates');
    const span = Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000);
    if (span < 0) return toast.error('The end date cannot be before the start date');
    if (span > 30) return toast.error('The report period cannot be more than one month (31 days)');
    setLoading(true);
    try {
      const response = await axios.get(`${API}/reports/non-conformances`, {
        params: { date_from: from, date_to: to },
      });
      setReport(response.data);
      setStatus('all');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to run the non-conformance report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runReport(); }, []);

  const applyPreset = (days) => {
    const to = localISODate();
    const from = daysAgo(days - 1);
    setDateFrom(from);
    setDateTo(to);
    runReport(from, to);
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (report?.non_conformances || []).filter((item) => {
      if (status === 'closed' && item.status !== 'completed') return false;
      if (status === 'open' && item.status === 'completed') return false;
      if (!needle) return true;
      return [item.reference, item.audit_name, item.non_conformance, item.action_required,
        item.action_taken, item.assigned_user_name, item.created_by_name]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [report, search, status]);

  const downloadPDF = async (action) => {
    setDownloading(action.id);
    try {
      const response = await axios.get(`${API}/actions/${action.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${action.reference || 'non-conformance'}_report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to download the report');
    } finally {
      setDownloading('');
    }
  };

  const summary = report?.summary || {};

  return (
    <div className="space-y-6" data-testid="non-conformance-report-page">
      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/actions')} aria-label="Back to corrective actions"><ArrowLeft className="w-4 h-4" /></Button>
          <div><h1 className="text-3xl font-bold tracking-tight">Non-Conformance Report</h1><p className="text-muted-foreground mt-1">Issues raised and their current close-out position for a period of up to one month.</p></div>
        </div>
        <Button variant="outline" onClick={() => window.print()} disabled={!report}><Printer className="w-4 h-4 mr-2" />Print Report</Button>
      </div>

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-lg">Report period</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2"><Label htmlFor="nc-date-from">Date raised from</Label><Input id="nc-date-from" type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="nc-date-to">Date raised to</Label><Input id="nc-date-to" type="date" value={dateTo} min={dateFrom} max={localISODate()} onChange={(e) => setDateTo(e.target.value)} /></div>
            <Button onClick={() => runReport()} disabled={loading}><FileText className="w-4 h-4 mr-2" />{loading ? 'Running…' : 'Run Report'}</Button>
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => applyPreset(7)}>Last 7 days</Button><Button size="sm" variant="outline" onClick={() => applyPreset(14)}>Last 14 days</Button><Button size="sm" variant="outline" onClick={() => applyPreset(30)}>Last 30 days</Button></div>
          </div>
          <p className="text-xs text-muted-foreground">The start and end dates are inclusive. The server will reject any period longer than 31 days.</p>
        </CardContent>
      </Card>

      {loading ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4].map((item) => <Skeleton key={item} className="h-28" />)}</div> : report && <>
        <div className="hidden print:block"><h1 className="text-2xl font-bold">Non-Conformance Report</h1><p className="text-sm">{formatDate(report.period.date_from)} to {formatDate(report.period.date_to)}</p></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6 flex items-center gap-4"><FileText className="w-8 h-8 text-primary" /><div><p className="text-2xl font-bold">{summary.total || 0}</p><p className="text-sm text-muted-foreground">Raised</p></div></CardContent></Card>
          <Card><CardContent className="pt-6 flex items-center gap-4"><Clock3 className="w-8 h-8 text-amber-600" /><div><p className="text-2xl font-bold">{(summary.total || 0) - (summary.completed || 0)}</p><p className="text-sm text-muted-foreground">Still Open</p></div></CardContent></Card>
          <Card><CardContent className="pt-6 flex items-center gap-4"><AlertTriangle className="w-8 h-8 text-red-600" /><div><p className="text-2xl font-bold">{summary.overdue || 0}</p><p className="text-sm text-muted-foreground">Overdue</p></div></CardContent></Card>
          <Card><CardContent className="pt-6 flex items-center gap-4"><CheckCircle2 className="w-8 h-8 text-emerald-600" /><div><p className="text-2xl font-bold">{summary.closure_rate || 0}%</p><p className="text-sm text-muted-foreground">Closure Rate</p></div></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap"><div><CardTitle className="text-lg">Non-conformances raised</CardTitle><p className="text-sm text-muted-foreground mt-1">{formatDate(report.period.date_from)} to {formatDate(report.period.date_to)} · {filtered.length} shown</p></div><div className="relative w-full sm:w-80 print:hidden"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search issue, reference or owner" /></div></div>
            <div className="flex gap-2 print:hidden"><Button size="sm" variant={status === 'all' ? 'default' : 'outline'} onClick={() => setStatus('all')}>All ({summary.total || 0})</Button><Button size="sm" variant={status === 'open' ? 'default' : 'outline'} onClick={() => setStatus('open')}>Open ({(summary.total || 0) - (summary.completed || 0)})</Button><Button size="sm" variant={status === 'closed' ? 'default' : 'outline'} onClick={() => setStatus('closed')}>Closed ({summary.completed || 0})</Button></div>
          </CardHeader>
          <CardContent>
            {filtered.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Reference / Raised</TableHead><TableHead>Issue</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead><TableHead>Close-out</TableHead><TableHead className="text-right print:hidden">Detail</TableHead></TableRow></TableHeader><TableBody>
              {filtered.map((item) => <TableRow key={item.id} className="align-top"><TableCell className="whitespace-nowrap"><p className="font-semibold">{item.reference || '-'}</p><p className="text-xs text-muted-foreground">{formatDate(item.created_at)}</p></TableCell><TableCell className="min-w-64 max-w-md"><p className="font-medium">{item.audit_name || 'Non-conformance'}</p><p className="text-sm mt-1">{item.non_conformance}</p>{item.question_text && item.question_id && <p className="text-xs text-muted-foreground mt-1">{item.question_text}</p>}</TableCell><TableCell className="min-w-36">{item.assigned_user_name || item.assigned_department || 'Unassigned'}<p className="text-xs text-muted-foreground mt-1">Due {formatDate(item.due_date)}</p></TableCell><TableCell>{statusBadge(item.status)}</TableCell><TableCell className="min-w-64 max-w-md">{item.action_taken ? <><p className="text-sm line-clamp-3">{item.action_taken}</p>{item.closed_at && <p className="text-xs text-muted-foreground mt-1">Closed {formatDate(item.closed_at)}</p>}</> : <span className="text-sm text-muted-foreground">Not yet recorded</span>}</TableCell><TableCell className="text-right whitespace-nowrap print:hidden"><Button variant="ghost" size="sm" onClick={() => setSelected(item)} title="View full detail"><Eye className="w-4 h-4" /></Button><Button variant="ghost" size="sm" onClick={() => downloadPDF(item)} disabled={downloading === item.id} title="Download individual PDF"><FileDown className="w-4 h-4" /></Button></TableCell></TableRow>)}
            </TableBody></Table></div> : <div className="py-12 text-center"><FileText className="w-10 h-10 mx-auto text-muted-foreground opacity-30" /><p className="text-muted-foreground mt-3">No non-conformances match this report view.</p></div>}
          </CardContent>
        </Card>
      </>}

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{selected?.reference || 'Non-conformance'} — Detailed Report</DialogTitle></DialogHeader>
          {selected && <div className="space-y-5">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 rounded-lg bg-muted/50 p-4 text-sm"><div><p className="text-muted-foreground">Source</p><p className="font-medium">{selected.audit_name || '-'}</p></div><div><p className="text-muted-foreground">Raised</p><p className="font-medium">{formatDateTime(selected.created_at)}</p></div><div><p className="text-muted-foreground">Status</p>{statusBadge(selected.status)}</div><div><p className="text-muted-foreground">Raised by</p><p className="font-medium">{selected.created_by_name || '-'}</p></div><div><p className="text-muted-foreground">Owner</p><p className="font-medium">{selected.assigned_user_name || selected.assigned_department || 'Unassigned'}</p></div><div><p className="text-muted-foreground">Due date</p><p className="font-medium">{formatDate(selected.due_date)}</p></div></div>
            {selected.question_id && <section><Label>Audit question</Label><p className="mt-1 rounded-md border p-3 text-sm">{selected.question_text}</p></section>}
            <section><Label>Issue / Non-Conformance</Label><p className="mt-1 rounded-md border border-red-200 bg-red-50/60 p-3 text-sm dark:bg-red-950/20">{selected.non_conformance}</p></section>
            <section><Label>Action Required</Label><p className="mt-1 rounded-md border p-3 text-sm">{selected.action_required || '-'}</p></section>
            <section><Label>Close-Out / Action Taken</Label><p className="mt-1 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:bg-emerald-950/20">{selected.action_taken || 'Not yet recorded'}</p>{selected.completed_by_name && <p className="text-xs text-muted-foreground mt-2">Submitted by {selected.completed_by_name} · {formatDateTime(selected.completed_at)}</p>}</section>
            {selected.reviewed_by_name && <section className="rounded-lg border p-4"><p className="font-medium flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Approver sign-off</p><p className="text-sm mt-2">{selected.reviewed_by_name} · {formatDateTime(selected.reviewed_at)}</p>{selected.review_comment && <p className="text-sm mt-2">{selected.review_comment}</p>}</section>}
            {selected.effectiveness_evidence && <section className="rounded-lg border border-violet-200 p-4"><p className="font-medium">Effectiveness verification</p><p className="text-sm mt-2">{selected.effectiveness_evidence}</p><p className="text-xs text-muted-foreground mt-2">{selected.effectiveness_verified_by_name || '-'} · {formatDateTime(selected.effectiveness_verified_at)}</p></section>}
            <section><Label>History</Label><div className="mt-2 space-y-2">{(selected.history || []).length ? [...selected.history].reverse().map((entry) => <div key={entry.id} className="rounded-md border p-3 text-sm"><p>{entry.message}</p><p className="text-xs text-muted-foreground mt-1">{entry.user_name || '-'} · {formatDateTime(entry.created_at)}</p></div>) : <p className="text-sm text-muted-foreground">No history recorded.</p>}</div></section>
            <div className="border-t pt-4"><Button variant="outline" onClick={() => downloadPDF(selected)} disabled={downloading === selected.id}><FileDown className="w-4 h-4 mr-2" />Download Individual PDF</Button></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NonConformanceReport;
