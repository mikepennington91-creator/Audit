import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { AlertTriangle, Download, Mail, PackageX, Plus, Save, Send, Trash2, Users } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/hold-disposal`;

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const localTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const blankNotice = () => ({
  rm_number: '',
  quantity: '',
  ingredient_name: '',
  reason: '',
  action_required: '',
  event_date: localDate(),
  event_time: localTime(),
  line_area: '',
  disposal_route: '',
  company_id: '',
});

const disposalRoutes = [
  { value: 'sugarich', label: 'SugaRich' },
  { value: 'general_waste', label: 'General Waste' },
  { value: 'recycling', label: 'Recycling' },
  { value: 'return_to_supplier', label: 'Return to Supplier' },
];

const NoticeForm = ({ type, companies, isSystemAdmin, onCreated }) => {
  const [form, setForm] = useState(blankNotice());
  const [saving, setSaving] = useState(false);
  const isDisposal = type === 'disposal';

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (isSystemAdmin && !form.company_id) {
      toast.error('Select a company for this notice');
      return;
    }
    if (isDisposal && !form.disposal_route) {
      toast.error('Select a disposal route');
      return;
    }
    setSaving(true);
    try {
      const endpoint = isDisposal ? 'disposal-notices' : 'hold-notices';
      const payload = { ...form };
      if (!isDisposal) delete payload.disposal_route;
      if (!isSystemAdmin) delete payload.company_id;
      const response = await axios.post(`${API}/${endpoint}`, payload);
      toast.success(`${isDisposal ? 'Disposal' : 'Hold'} notice ${response.data.reference} created`);
      const keepCompany = form.company_id;
      setForm({ ...blankNotice(), company_id: keepCompany });
      onCreated(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to create notice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isDisposal ? <PackageX className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          New {isDisposal ? 'Disposal' : 'Hold'} Notice
        </CardTitle>
        <CardDescription>
          Enter the information once; Infinit Audit stores the record and generates the PDF form from it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {isSystemAdmin && (
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={form.company_id} onValueChange={(value) => update('company_id', value)}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${type}-rm`}>RM Number / Reference</Label>
              <Input id={`${type}-rm`} value={form.rm_number} onChange={(e) => update('rm_number', e.target.value)} placeholder="e.g. RM26723" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${type}-quantity`}>Quantity</Label>
              <Input id={`${type}-quantity`} value={form.quantity} onChange={(e) => update('quantity', e.target.value)} placeholder="e.g. 437.5 kg / 3 pallets / 180 cases" required />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${type}-ingredient`}>Ingredient / Material Name</Label>
            <Input id={`${type}-ingredient`} value={form.ingredient_name} onChange={(e) => update('ingredient_name', e.target.value)} placeholder="Ingredient, raw material or product name" required />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`${type}-date`}>Date</Label>
              <Input id={`${type}-date`} type="date" value={form.event_date} onChange={(e) => update('event_date', e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${type}-time`}>Time</Label>
              <Input id={`${type}-time`} type="time" value={form.event_time} onChange={(e) => update('event_time', e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${type}-area`}>Line / Factory Area</Label>
              <Input id={`${type}-area`} value={form.line_area} onChange={(e) => update('line_area', e.target.value)} placeholder="e.g. Line 3 / Warehouse" required />
            </div>
          </div>

          {isDisposal && (
            <div className="space-y-2">
              <Label>Disposal Route</Label>
              <Select value={form.disposal_route} onValueChange={(value) => update('disposal_route', value)}>
                <SelectTrigger><SelectValue placeholder="Select disposal route" /></SelectTrigger>
                <SelectContent>{disposalRoutes.map((route) => <SelectItem key={route.value} value={route.value}>{route.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`${type}-reason`}>{isDisposal ? 'Disposal Reason' : 'Hold Reason'}</Label>
            <Textarea id={`${type}-reason`} value={form.reason} onChange={(e) => update('reason', e.target.value)} rows={4} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${type}-action`}>Action Required</Label>
            <Textarea id={`${type}-action`} value={form.action_required} onChange={(e) => update('action_required', e.target.value)} rows={4} required />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />{saving ? 'Creating...' : `Create ${isDisposal ? 'Disposal' : 'Hold'} Notice`}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

const NoticeHistory = ({ type, notices, onDownload, onEmail }) => {
  const isDisposal = type === 'disposal';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent {isDisposal ? 'Disposal' : 'Hold'} Notices</CardTitle>
        <CardDescription>Download the generated form or send it to a saved distribution list.</CardDescription>
      </CardHeader>
      <CardContent>
        {notices.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No {isDisposal ? 'disposal' : 'hold'} notices have been raised yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Material</TableHead><TableHead>RM</TableHead><TableHead>Quantity</TableHead><TableHead>Date / Time</TableHead><TableHead>Area</TableHead>{isDisposal && <TableHead>Route</TableHead>}<TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {notices.map((notice) => (
                  <TableRow key={notice.id}>
                    <TableCell className="font-medium">{notice.reference}</TableCell>
                    <TableCell>{notice.ingredient_name}</TableCell>
                    <TableCell>{notice.rm_number}</TableCell>
                    <TableCell>{notice.quantity}</TableCell>
                    <TableCell className="whitespace-nowrap">{notice.event_date}<br /><span className="text-xs text-muted-foreground">{notice.event_time}</span></TableCell>
                    <TableCell>{notice.line_area}</TableCell>
                    {isDisposal && <TableCell><Badge variant="outline">{notice.disposal_route_label}</Badge></TableCell>}
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => onDownload(type, notice)} title="Download PDF"><Download className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => onEmail(type, notice)} title="Email PDF"><Mail className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const DistributionLists = ({ lists, companies, isSystemAdmin, onChanged }) => {
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [saving, setSaving] = useState(false);

  const parsedRecipients = useMemo(() => recipients.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean), [recipients]);

  const createList = async (event) => {
    event.preventDefault();
    if (isSystemAdmin && !companyId) return toast.error('Select a company');
    if (parsedRecipients.length === 0) return toast.error('Add at least one email address');
    setSaving(true);
    try {
      const response = await axios.post(`${API}/distribution-lists`, {
        name,
        recipients: parsedRecipients,
        ...(isSystemAdmin ? { company_id: companyId } : {}),
      });
      toast.success(`Distribution list “${response.data.name}” created`);
      setName('');
      setRecipients('');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to create distribution list');
    } finally {
      setSaving(false);
    }
  };

  const deleteList = async (list) => {
    if (!window.confirm(`Delete distribution list “${list.name}”?`)) return;
    try {
      await axios.delete(`${API}/distribution-lists/${list.id}`);
      toast.success('Distribution list deleted');
      onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to delete distribution list');
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />New Distribution List</CardTitle><CardDescription>Create a reusable group once, then send future notices to the whole group in one click.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={createList} className="space-y-4">
            {isSystemAdmin && (
              <div className="space-y-2"><Label>Company</Label><Select value={companyId} onValueChange={setCompanyId}><SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent></Select></div>
            )}
            <div className="space-y-2"><Label>List Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Technical + Warehouse + Production" required /></div>
            <div className="space-y-2"><Label>Email Addresses</Label><Textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={8} placeholder={'technical@example.com\nwarehouse@example.com\nproduction@example.com'} required /><p className="text-xs text-muted-foreground">Enter one per line, or separate addresses with commas or semicolons.</p></div>
            <Button type="submit" className="w-full" disabled={saving}><Users className="mr-2 h-4 w-4" />{saving ? 'Saving...' : 'Save Distribution List'}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Saved Distribution Lists</CardTitle><CardDescription>{lists.length} saved list{lists.length === 1 ? '' : 's'}</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {lists.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No distribution lists yet.</div> : lists.map((list) => (
            <div key={list.id} className="rounded-lg border p-4 flex items-start justify-between gap-4">
              <div className="min-w-0"><p className="font-medium">{list.name}</p><p className="mt-1 text-sm text-muted-foreground">{list.recipients?.length || 0} recipient{list.recipients?.length === 1 ? '' : 's'}</p><p className="mt-2 text-xs text-muted-foreground break-words">{(list.recipients || []).join(' · ')}</p></div>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteList(list)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

const HoldDisposal = () => {
  const { user } = useAuth();
  const [holds, setHolds] = useState([]);
  const [disposals, setDisposals] = useState([]);
  const [distributionLists, setDistributionLists] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailTarget, setEmailTarget] = useState(null);
  const [emailListId, setEmailListId] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailing, setEmailing] = useState(false);

  const isSystemAdmin = user?.role === 'system_admin';

  const fetchData = async () => {
    try {
      const calls = [
        axios.get(`${API}/hold-notices`),
        axios.get(`${API}/disposal-notices`),
        axios.get(`${API}/distribution-lists`),
      ];
      if (isSystemAdmin) calls.push(axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/companies`));
      const [holdsRes, disposalsRes, listsRes, companiesRes] = await Promise.all(calls);
      setHolds(holdsRes.data);
      setDisposals(disposalsRes.data);
      setDistributionLists(listsRes.data);
      if (companiesRes) setCompanies(companiesRes.data);
    } catch (error) {
      toast.error('Failed to load hold and disposal records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const created = (type) => (notice) => {
    if (type === 'hold') setHolds((current) => [notice, ...current]);
    else setDisposals((current) => [notice, ...current]);
  };

  const downloadPdf = async (type, notice) => {
    const endpoint = type === 'hold' ? 'hold-notices' : 'disposal-notices';
    try {
      const response = await axios.get(`${API}/${endpoint}/${notice.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${notice.reference}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to download notice PDF');
    }
  };

  const openEmail = (type, notice) => {
    if (distributionLists.length === 0) {
      toast.error('Create a distribution list first');
      return;
    }
    setEmailTarget({ type, notice });
    setEmailListId('');
    setEmailMessage('');
  };

  const sendEmail = async () => {
    if (!emailTarget || !emailListId) return toast.error('Select a distribution list');
    setEmailing(true);
    try {
      const endpoint = emailTarget.type === 'hold' ? 'hold-notices' : 'disposal-notices';
      const response = await axios.post(`${API}/${endpoint}/${emailTarget.notice.id}/email`, {
        distribution_list_id: emailListId,
        message: emailMessage || null,
      });
      toast.success(response.data.message);
      setEmailTarget(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to email notice');
    } finally {
      setEmailing(false);
    }
  };

  if (loading) return <div className="py-16 text-center text-muted-foreground">Loading hold and disposal records...</div>;

  return (
    <div className="space-y-6" data-testid="hold-disposal-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Hold & Disposal</h1>
        <p className="mt-1 text-muted-foreground">Raise controlled hold/disposal notices, generate PDFs and distribute them by email.</p>
      </div>

      <Tabs defaultValue="hold" className="space-y-6">
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="hold"><AlertTriangle className="mr-2 h-4 w-4" />Hold Notices</TabsTrigger>
          <TabsTrigger value="disposal"><PackageX className="mr-2 h-4 w-4" />Disposal Notices</TabsTrigger>
          <TabsTrigger value="lists"><Users className="mr-2 h-4 w-4" />Distribution Lists</TabsTrigger>
        </TabsList>

        <TabsContent value="hold" className="space-y-6">
          <NoticeForm type="hold" companies={companies} isSystemAdmin={isSystemAdmin} onCreated={created('hold')} />
          <NoticeHistory type="hold" notices={holds} onDownload={downloadPdf} onEmail={openEmail} />
        </TabsContent>

        <TabsContent value="disposal" className="space-y-6">
          <NoticeForm type="disposal" companies={companies} isSystemAdmin={isSystemAdmin} onCreated={created('disposal')} />
          <NoticeHistory type="disposal" notices={disposals} onDownload={downloadPdf} onEmail={openEmail} />
        </TabsContent>

        <TabsContent value="lists">
          <DistributionLists lists={distributionLists} companies={companies} isSystemAdmin={isSystemAdmin} onChanged={fetchData} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!emailTarget} onOpenChange={(open) => !open && setEmailTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email {emailTarget?.notice?.reference}</DialogTitle>
            <DialogDescription>The generated PDF will be sent separately to every address in the selected distribution list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Distribution List</Label>
              <Select value={emailListId} onValueChange={setEmailListId}>
                <SelectTrigger><SelectValue placeholder="Select distribution list" /></SelectTrigger>
                <SelectContent>{distributionLists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name} ({list.recipients?.length || 0})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Optional Email Message</Label><Textarea value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} rows={4} placeholder="Optional note to accompany the notice" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEmailTarget(null)}>Cancel</Button><Button onClick={sendEmail} disabled={emailing || !emailListId}><Send className="mr-2 h-4 w-4" />{emailing ? 'Sending...' : 'Send PDF'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HoldDisposal;
