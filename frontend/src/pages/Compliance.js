import { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { useAuth } from '../context/AuthContext';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const tabs = ['overview', 'training', 'recalls', 'email', 'system'];
const emptyRecall = { product_name: '', batch_code: '', exercise_date: '', input_quantity: '', output_quantity: '', waste_quantity: '0', carryover_quantity: '0', unit: 'kg', destinations: '', traceability_complete: false, notes: '' };

const Compliance = () => {
  const { isAdmin } = useAuth();
  const admin = isAdmin();
  const [tab, setTab] = useState(admin ? (new URLSearchParams(window.location.search).get('tab') || 'overview') : 'training');
  const [summary, setSummary] = useState(null);
  const [training, setTraining] = useState([]);
  const [users, setUsers] = useState([]);
  const [emails, setEmails] = useState([]);
  const [recalls, setRecalls] = useState([]);
  const [health, setHealth] = useState(null);
  const [assignment, setAssignment] = useState({ user_id: '', title: '', due_date: '', refresher_months: '', notes: '' });
  const [recall, setRecall] = useState(emptyRecall);

  const load = async () => {
    try {
      if (tab === 'overview' && admin) setSummary((await axios.get(`${API}/compliance/summary`)).data);
      if (tab === 'training') {
        const requests = [axios.get(`${API}/training-records`)];
        if (admin) requests.push(axios.get(`${API}/action-assignees`));
        const results = await Promise.all(requests);
        setTraining(results[0].data);
        if (results[1]) setUsers(results[1].data);
      }
      if (tab === 'email' && admin) setEmails((await axios.get(`${API}/email-deliveries?limit=100`)).data);
      if (tab === 'system' && admin) setHealth((await axios.get(`${API}/system/health`)).data);
      if (tab === 'recalls' && admin) setRecalls((await axios.get(`${API}/mock-recalls`)).data);
    } catch (error) { toast.error(error.response?.data?.detail || 'Could not load compliance data'); }
  };

  useEffect(() => { load(); }, [tab]);

  const assignTraining = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API}/training-records`, { ...assignment, refresher_months: assignment.refresher_months ? Number(assignment.refresher_months) : null });
      toast.success('Training assigned');
      setAssignment({ user_id: '', title: '', due_date: '', refresher_months: '', notes: '' });
      load();
    } catch (error) { toast.error(error.response?.data?.detail || 'Could not assign training'); }
  };

  const verifyTraining = async (record, competent) => {
    const evidence = window.prompt(competent ? 'Enter competency evidence' : 'Explain the retraining required');
    if (!evidence) return;
    try { await axios.put(`${API}/training-records/${record.id}/verify`, { competent, evidence }); toast.success('Competency recorded'); load(); }
    catch (error) { toast.error(error.response?.data?.detail || 'Could not record competency'); }
  };

  const acknowledgeTraining = async (record) => {
    const acknowledgement = window.prompt('Confirm what you have read, understood or completed:');
    if (!acknowledgement) return;
    try { await axios.put(`${API}/training-records/${record.id}/acknowledge`, { acknowledgement }); toast.success('Training submitted for competency verification'); load(); }
    catch (error) { toast.error(error.response?.data?.detail || 'Could not acknowledge training'); }
  };

  const createRecall = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API}/mock-recalls`, {
        ...recall,
        input_quantity: Number(recall.input_quantity), output_quantity: Number(recall.output_quantity),
        waste_quantity: Number(recall.waste_quantity), carryover_quantity: Number(recall.carryover_quantity),
      });
      toast.success('Mock recall recorded'); setRecall(emptyRecall); load();
    } catch (error) { toast.error(error.response?.data?.detail || 'Could not record mock recall'); }
  };

  const resend = async (id) => {
    try { await axios.post(`${API}/email-deliveries/${id}/resend`); toast.success('Email resent'); load(); }
    catch (error) { toast.error(error.response?.data?.detail || 'Email could not be resent'); }
  };

  const counts = summary?.counts || {};
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold tracking-tight">Compliance Operations</h1><p className="text-muted-foreground mt-1">Manage audit exceptions, training, traceability exercises and delivery health.</p></div>
    <div className="flex gap-2 overflow-x-auto pb-1">{(admin ? tabs : ['training']).map(item => <Button key={item} variant={tab === item ? 'default' : 'outline'} onClick={() => setTab(item)} className="capitalize">{item}</Button>)}</div>

    {tab === 'overview' && <div className="space-y-5">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{[
        ['Audits due this week', counts.audits_due_this_week || 0], ['Overdue schedules', counts.overdue_schedules || 0],
        ['Overdue actions', counts.overdue_actions || 0], ['Effectiveness due', counts.effectiveness_due || 0],
        ['Overdue training', counts.overdue_training || 0], ['Failed emails', counts.failed_emails || 0],
        ['Failed mock recalls', counts.failed_mock_recalls || 0], ['Open actions', counts.open_actions || 0],
      ].map(([label, count]) => <Card key={label}><CardContent className="pt-6"><p className="text-3xl font-bold">{count}</p><p className="text-sm text-muted-foreground">{label}</p></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle>Recurring findings</CardTitle></CardHeader><CardContent className="space-y-3">{summary?.recurring_findings?.length ? summary.recurring_findings.map((item, index) => <div key={index} className="flex justify-between gap-4 border-b pb-3"><div><p className="font-medium">{item.issue}</p><p className="text-sm text-muted-foreground">{item.audit_name}</p></div><Badge variant="outline">{item.count} occurrences</Badge></div>) : <p className="text-muted-foreground">No recurring findings detected.</p>}</CardContent></Card>
    </div>}

    {tab === 'training' && <div className={admin ? 'grid xl:grid-cols-[380px_1fr] gap-5' : 'grid gap-5'}>
      {admin && <Card><CardHeader><CardTitle>Assign training</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={assignTraining}>
        <div><Label>User</Label><select className="w-full h-10 rounded-md border bg-background px-3" required value={assignment.user_id} onChange={e => setAssignment({...assignment, user_id: e.target.value})}><option value="">Select user</option>{users.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
        <div><Label>Training / controlled document</Label><Input required value={assignment.title} onChange={e => setAssignment({...assignment, title: e.target.value})} /></div>
        <div><Label>Due date</Label><Input type="date" required value={assignment.due_date} onChange={e => setAssignment({...assignment, due_date: e.target.value})} /></div>
        <div><Label>Refresher interval (months)</Label><Input type="number" min="1" max="60" value={assignment.refresher_months} onChange={e => setAssignment({...assignment, refresher_months: e.target.value})} /></div>
        <div><Label>Notes</Label><Textarea value={assignment.notes} onChange={e => setAssignment({...assignment, notes: e.target.value})} /></div>
        <Button type="submit" className="w-full"><UserRoundCheck className="w-4 h-4 mr-2" />Assign</Button>
      </form></CardContent></Card>}
      <Card><CardHeader><CardTitle>{admin ? 'Training matrix' : 'My training'}</CardTitle></CardHeader><CardContent className="space-y-3">{training.map(record => <div key={record.id} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><div><p className="font-medium">{record.title}</p><p className="text-sm text-muted-foreground">{record.user_name} · due {record.due_date}</p></div><Badge>{record.status}</Badge></div>{!admin && ['assigned', 'overdue'].includes(record.status) && <Button size="sm" className="mt-3" onClick={() => acknowledgeTraining(record)}>Acknowledge Training</Button>}{admin && record.status === 'awaiting_competency' && <div className="flex gap-2 mt-3"><Button size="sm" onClick={() => verifyTraining(record, true)}>Competent</Button><Button size="sm" variant="outline" onClick={() => verifyTraining(record, false)}>Retraining</Button></div>}</div>)}{!training.length && <p className="text-muted-foreground">No training assignments.</p>}</CardContent></Card>
    </div>}

    {tab === 'recalls' && <div className="grid xl:grid-cols-[420px_1fr] gap-5">
      <Card><CardHeader><CardTitle>Record mock recall</CardTitle></CardHeader><CardContent><form className="space-y-3" onSubmit={createRecall}>
        <div className="grid grid-cols-2 gap-3"><div><Label>Product</Label><Input required value={recall.product_name} onChange={e => setRecall({...recall, product_name: e.target.value})} /></div><div><Label>Batch code</Label><Input required value={recall.batch_code} onChange={e => setRecall({...recall, batch_code: e.target.value})} /></div></div>
        <div><Label>Exercise date</Label><Input type="date" required value={recall.exercise_date} onChange={e => setRecall({...recall, exercise_date: e.target.value})} /></div>
        <div className="grid grid-cols-2 gap-3">{[['input_quantity','Input'],['output_quantity','Output'],['waste_quantity','Waste'],['carryover_quantity','Carry-over']].map(([key,label]) => <div key={key}><Label>{label} ({recall.unit})</Label><Input type="number" step="0.001" min="0" required value={recall[key]} onChange={e => setRecall({...recall, [key]: e.target.value})} /></div>)}</div>
        <div><Label>Destinations / customers</Label><Textarea required value={recall.destinations} onChange={e => setRecall({...recall, destinations: e.target.value})} /></div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={recall.traceability_complete} onChange={e => setRecall({...recall, traceability_complete: e.target.checked})} />Traceability records and destinations are complete</label>
        <Button type="submit" className="w-full"><ShieldCheck className="w-4 h-4 mr-2" />Calculate & record</Button>
      </form></CardContent></Card>
      <Card><CardHeader><CardTitle>Recall history</CardTitle></CardHeader><CardContent className="space-y-3">{recalls.map(item => <div key={item.id} className="rounded-lg border p-4 flex justify-between gap-4"><div><p className="font-medium">{item.product_name} · {item.batch_code}</p><p className="text-sm text-muted-foreground">{item.reconciliation_percent}% reconciled · {item.matched_record_count} linked records</p></div><Badge className={item.result === 'pass' ? 'bg-emerald-600' : 'bg-red-600'}>{item.result}</Badge></div>)}{!recalls.length && <p className="text-muted-foreground">No mock recall exercises recorded.</p>}</CardContent></Card>
    </div>}

    {tab === 'email' && <Card><CardHeader><CardTitle>Email delivery log</CardTitle></CardHeader><CardContent className="space-y-3">{emails.map(item => <div key={item.id} className="rounded-lg border p-4 flex flex-wrap justify-between gap-3"><div><p className="font-medium">{item.subject}</p><p className="text-sm text-muted-foreground">{item.recipient} · {item.created_at}</p>{item.error && <p className="text-sm text-red-600 mt-1">{item.error}</p>}</div><div className="flex items-center gap-2"><Badge variant={item.status === 'sent' ? 'default' : 'destructive'}>{item.status}</Badge>{item.status !== 'sent' && <Button size="sm" variant="outline" onClick={() => resend(item.id)}><RefreshCw className="w-4 h-4 mr-1" />Resend</Button>}</div></div>)}</CardContent></Card>}

    {tab === 'system' && <div className="grid md:grid-cols-3 gap-4">{[
      ['Database', health?.database?.status, `${health?.database?.latency_ms ?? '-'} ms`],
      ['Email', health?.email?.configured ? 'configured' : 'not configured', `${health?.email?.failed_deliveries ?? 0} failures`],
      ['Background jobs', health?.scheduling?.latest_job?.status || 'no recent run', `${health?.scheduling?.overdue_occurrences ?? 0} overdue audits`],
    ].map(([label,status,detail]) => <Card key={label}><CardContent className="pt-6"><div className="flex items-center gap-2">{status === 'healthy' || status === 'configured' || status === 'completed' ? <CheckCircle2 className="text-emerald-600" /> : <AlertTriangle className="text-amber-600" />}<p className="font-semibold">{label}</p></div><p className="mt-3 capitalize">{status}</p><p className="text-sm text-muted-foreground">{detail}</p></CardContent></Card>)}</div>}
  </div>;
};

export default Compliance;
