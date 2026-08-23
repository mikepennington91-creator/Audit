import { useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Groups from './Groups';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';
import { Building2, FolderOpen, Layers, Pencil, Plus, Settings, Trash2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Configuration = () => {
  const { user } = useAuth();
  const isSystemAdmin = user?.role === 'system_admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const allowedTabs = isSystemAdmin ? ['companies', 'lines-shifts', 'groups'] : ['lines-shifts', 'groups'];
  const [companies, setCompanies] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(
    allowedTabs.includes(requestedTab) ? requestedTab : (isSystemAdmin ? 'companies' : 'lines-shifts')
  );
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [companyForm, setCompanyForm] = useState({ name: '', description: '' });
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
  const [editingLine, setEditingLine] = useState(null);
  const [lineTitle, setLineTitle] = useState('');

  const fetchData = async () => {
    try {
      const requests = [axios.get(`${API}/lines-shifts`)];
      if (isSystemAdmin) requests.push(axios.get(`${API}/companies`));
      const [linesRes, companiesRes] = await Promise.all(requests);
      setLines(linesRes.data);
      if (companiesRes) setCompanies(companiesRes.data);
    } catch (error) {
      toast.error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetCompany = () => {
    setEditingCompany(null);
    setCompanyForm({ name: '', description: '' });
  };

  const saveCompany = async (event) => {
    event.preventDefault();
    try {
      if (editingCompany) {
        await axios.put(`${API}/companies/${editingCompany.id}`, companyForm);
      } else {
        await axios.post(`${API}/companies`, companyForm);
      }
      toast.success(`Company ${editingCompany ? 'updated' : 'created'} successfully`);
      setCompanyDialogOpen(false);
      resetCompany();
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to save company');
    }
  };

  const editCompany = (company) => {
    setEditingCompany(company);
    setCompanyForm({ name: company.name, description: company.description || '' });
    setCompanyDialogOpen(true);
  };

  const deleteCompany = async (companyId) => {
    if (!window.confirm('Delete this company? Companies with assigned users cannot be deleted.')) return;
    try {
      await axios.delete(`${API}/companies/${companyId}`);
      setCompanies((current) => current.filter((company) => company.id !== companyId));
      toast.success('Company deleted successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete company');
    }
  };

  const resetLine = () => {
    setEditingLine(null);
    setLineTitle('');
  };

  const saveLine = async (event) => {
    event.preventDefault();
    try {
      if (editingLine) {
        await axios.put(`${API}/lines-shifts/${editingLine.id}`, { title: lineTitle });
      } else {
        await axios.post(`${API}/lines-shifts`, { title: lineTitle });
      }
      toast.success(`Line/shift ${editingLine ? 'updated' : 'created'} successfully`);
      setLineDialogOpen(false);
      resetLine();
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to save line/shift');
    }
  };

  const editLine = (line) => {
    setEditingLine(line);
    setLineTitle(line.title);
    setLineDialogOpen(true);
  };

  const deleteLine = async (lineId) => {
    if (!window.confirm('Delete this line/shift?')) return;
    try {
      await axios.delete(`${API}/lines-shifts/${lineId}`);
      setLines((current) => current.filter((line) => line.id !== lineId));
      toast.success('Line/shift deleted successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete line/shift');
    }
  };

  const changeTab = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="configuration-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground mt-1">Manage company-wide options used across Infinit-Audit.</p>
      </div>

      <Tabs value={activeTab} onValueChange={changeTab}>
        <TabsList className={`grid w-full max-w-2xl ${isSystemAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {isSystemAdmin && <TabsTrigger value="companies"><Building2 className="w-4 h-4 mr-2" />Companies</TabsTrigger>}
          <TabsTrigger value="lines-shifts"><Layers className="w-4 h-4 mr-2" />Lines/Shifts</TabsTrigger>
          <TabsTrigger value="groups"><FolderOpen className="w-4 h-4 mr-2" />Groups</TabsTrigger>
        </TabsList>

        {isSystemAdmin && (
          <TabsContent value="companies" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div><CardTitle className="text-lg">Companies ({companies.length})</CardTitle><p className="text-sm text-muted-foreground mt-1">Organisations using the platform.</p></div>
                <Dialog open={companyDialogOpen} onOpenChange={(open) => { setCompanyDialogOpen(open); if (!open) resetCompany(); }}>
                  <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Company</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>{editingCompany ? 'Edit Company' : 'Add Company'}</DialogTitle></DialogHeader>
                    <form onSubmit={saveCompany} className="space-y-4">
                      <div className="space-y-2"><Label htmlFor="company-name">Company Name</Label><Input id="company-name" value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} required /></div>
                      <div className="space-y-2"><Label htmlFor="company-description">Description (optional)</Label><Textarea id="company-description" value={companyForm.description} onChange={(e) => setCompanyForm({ ...companyForm, description: e.target.value })} rows={3} /></div>
                      <div className="flex gap-3"><Button type="button" variant="outline" className="flex-1" onClick={() => setCompanyDialogOpen(false)}>Cancel</Button><Button type="submit" className="flex-1">{editingCompany ? 'Update' : 'Create'}</Button></div>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-32 w-full" /> : (
                  <Table><TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Description</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{companies.map((company) => <TableRow key={company.id}><TableCell className="font-medium">{company.name}</TableCell><TableCell className="text-muted-foreground">{company.description || '-'}</TableCell><TableCell>{new Date(company.created_at).toLocaleDateString('en-GB')}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => editCompany(company)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteCompany(company.id)}><Trash2 className="w-4 h-4" /></Button></TableCell></TableRow>)}</TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="lines-shifts" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div><CardTitle className="text-lg">Lines / Shifts ({lines.length})</CardTitle><p className="text-sm text-muted-foreground mt-1">Values available when users run an audit.</p></div>
              <Dialog open={lineDialogOpen} onOpenChange={(open) => { setLineDialogOpen(open); if (!open) resetLine(); }}>
                <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Add Line/Shift</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{editingLine ? 'Edit Line/Shift' : 'Add Line/Shift'}</DialogTitle></DialogHeader>
                  <form onSubmit={saveLine} className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="line-title">Title</Label><Input id="line-title" value={lineTitle} onChange={(e) => setLineTitle(e.target.value)} placeholder="e.g. Line 1, Morning Shift or Area A" required /></div>
                    <div className="flex gap-3"><Button type="button" variant="outline" className="flex-1" onClick={() => setLineDialogOpen(false)}>Cancel</Button><Button type="submit" className="flex-1">{editingLine ? 'Update' : 'Create'}</Button></div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-32 w-full" /> : lines.length ? (
                <Table><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{lines.map((line) => <TableRow key={line.id}><TableCell><div className="flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Settings className="w-4 h-4 text-primary" /></span><span className="font-medium">{line.title}</span></div></TableCell><TableCell>{new Date(line.created_at).toLocaleDateString('en-GB')}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => editLine(line)}><Pencil className="w-4 h-4" /></Button><Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteLine(line.id)}><Trash2 className="w-4 h-4" /></Button></TableCell></TableRow>)}</TableBody>
                </Table>
              ) : <div className="text-center py-12 text-muted-foreground">No lines or shifts have been created yet.</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups" className="mt-6">
          <Groups embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Configuration;
