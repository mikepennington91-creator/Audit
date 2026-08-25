import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Checkbox } from '../components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { toast } from 'sonner';
import { Building2, Crown, Download, Info, Pencil, Plus, Shield, Trash2, Upload, UserCircle, Users } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const DEFAULT_ACCESS = { audits: false, traceability: false, traceability_release: false, traceability_dispatch: false, documents: false };
const FULL_ACCESS = { audits: true, traceability: true, traceability_release: true, traceability_dispatch: true, documents: true };
const FEATURES = [
  { key: 'audits', label: 'Audits', description: 'Run audits, view audit reports and access audit-related pages.' },
  { key: 'traceability', label: 'Traceability', description: 'View and record raw materials, finished batches, usage and traceability reports.' },
  { key: 'traceability_release', label: 'Release / Quarantine', description: 'Set or change the release status of finished product batches.' },
  { key: 'traceability_dispatch', label: 'Dispatch Finished Product', description: 'Record where released finished product batches have been sent.' },
  { key: 'documents', label: 'Documents', description: 'View and complete controlled documents and production records.' },
];

const isAdminRole = (role) => ['system_admin', 'company_admin', 'admin'].includes(role);
const accessFor = (user) => isAdminRole(user?.role)
  ? FULL_ACCESS
  : { ...DEFAULT_ACCESS, ...(user?.feature_access || {}) };

const emptyUserForm = {
  email: '',
  password: '',
  name: '',
  is_admin: false,
  company_id: '',
  feature_access: { ...DEFAULT_ACCESS },
};

const UserManagement = () => {
  const { user: currentUser, refreshUser } = useAuth();
  const fileInputRef = useRef(null);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState(emptyUserForm);

  const isSystemAdmin = currentUser?.role === 'system_admin';

  const fetchData = async () => {
    try {
      const [usersRes, companiesRes] = await Promise.all([
        axios.get(`${API}/users`),
        axios.get(`${API}/companies`),
      ]);
      setUsers(usersRes.data);
      setCompanies(companiesRes.data);
    } catch (error) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetForm = () => {
    setEditingUser(null);
    setForm({ ...emptyUserForm, feature_access: { ...DEFAULT_ACCESS } });
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      password: '',
      name: user.name,
      is_admin: isAdminRole(user.role),
      company_id: user.company_id || '',
      feature_access: accessFor(user),
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      const selectedCompanyId = isSystemAdmin ? (form.company_id || null) : currentUser?.company_id;
      const role = form.is_admin
        ? ((editingUser?.role === 'system_admin' || (isSystemAdmin && !selectedCompanyId)) ? 'system_admin' : 'company_admin')
        : (['user', 'audit_creator'].includes(editingUser?.role) ? editingUser.role : 'user');
      const payload = {
        name: form.name,
        role,
        company_id: selectedCompanyId,
        feature_access: form.is_admin ? { ...FULL_ACCESS } : form.feature_access,
      };
      if (form.password) payload.password = form.password;

      if (editingUser) {
        await axios.put(`${API}/users/${editingUser.id}`, payload);
        toast.success('User updated successfully');
      } else {
        await axios.post(`${API}/users`, { ...payload, email: form.email, password: form.password });
        toast.success('User created successfully');
      }
      setDialogOpen(false);
      resetForm();
      if (editingUser?.id === currentUser?.id) {
        await refreshUser();
        if (!isAdminRole(role)) return;
      }
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Unable to save user');
    }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await axios.delete(`${API}/users/${userId}`);
      setUsers((current) => current.filter((user) => user.id !== userId));
      toast.success('User deleted successfully');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete user');
    }
  };

  const downloadTemplate = async () => {
    try {
      const response = await axios.get(`${API}/users/export-template`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'user_import_template.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Failed to download template');
    }
  };

  const handleBulkImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await axios.post(`${API}/users/bulk-import`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`${response.data.success} users imported successfully`);
      if (response.data.failed) toast.error(`${response.data.failed} users failed to import`);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const roleName = (role) => ({
    system_admin: 'System Admin',
    company_admin: 'Company Admin',
    admin: 'Company Admin',
    audit_creator: 'Audit Creator',
    user: 'User',
  }[role] || 'User');

  const roleIcon = (role) => {
    if (role === 'system_admin') return <Crown className="w-4 h-4" />;
    if (isAdminRole(role)) return <Shield className="w-4 h-4" />;
    if (role === 'audit_creator') return <UserCircle className="w-4 h-4" />;
    return <Users className="w-4 h-4" />;
  };

  const adminCountFor = (targetUser) => {
    if (targetUser?.role === 'system_admin') {
      return users.filter((user) => user.role === 'system_admin').length;
    }
    return users.filter((user) => (
      isAdminRole(user.role)
      && user.role !== 'system_admin'
      && user.company_id === targetUser?.company_id
    )).length;
  };

  const lastAdminLocked = Boolean(
    editingUser
    && isAdminRole(editingUser.role)
    && adminCountFor(editingUser) <= 1,
  );

  return (
    <div className="space-y-6" data-testid="user-management-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
        <p className="text-muted-foreground mt-1">
          Manage members and choose which areas of Infinit-Audit they can access.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="text-lg">Users ({users.length})</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Company admins always have access to every feature.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleBulkImport} />
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="w-4 h-4 mr-2" />Template
            </Button>
            <Button variant="outline" size="sm" disabled={importing} onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />{importing ? 'Importing...' : 'Import CSV'}
            </Button>
            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button data-testid="add-user-btn"><Plus className="w-4 h-4 mr-2" />Add User</Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="user-name">Full Name</Label>
                      <Input id="user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                    </div>
                    {!editingUser && (
                      <div className="space-y-2">
                        <Label htmlFor="user-email">Email</Label>
                        <Input id="user-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                      </div>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="user-password">{editingUser ? 'New Password (optional)' : 'Password'}</Label>
                      <Input id="user-password" type="password" minLength={6} required={!editingUser} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                    </div>
                    <div className="space-y-2 rounded-lg border p-3">
                      <label htmlFor="user-admin" className="flex items-center gap-3 cursor-pointer">
                        <Checkbox
                          id="user-admin"
                          checked={form.is_admin}
                          disabled={form.is_admin && lastAdminLocked}
                          onCheckedChange={(checked) => setForm({ ...form, is_admin: checked === true })}
                        />
                        <span className="text-sm font-medium">Administrator</span>
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {form.is_admin && lastAdminLocked
                          ? 'Assign another administrator before downgrading this account.'
                          : 'Administrators have full access to every feature.'}
                      </p>
                    </div>
                  </div>
                  {isSystemAdmin && (
                    <div className="space-y-2">
                      <Label>Company</Label>
                      <Select value={form.company_id || 'none'} onValueChange={(value) => setForm({ ...form, company_id: value === 'none' ? '' : value })}>
                        <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Company</SelectItem>
                          {companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-3 rounded-lg border p-4">
                    <div>
                      <Label>Feature Access</Label>
                      {form.is_admin && <p className="text-xs text-muted-foreground mt-1">Administrators automatically have full access.</p>}
                    </div>
                    <div className="space-y-2">
                      <TooltipProvider>
                        {FEATURES.map((feature) => (
                          <div key={feature.key} className="flex items-center justify-between gap-4 rounded-md border p-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{feature.label}</span>
                                <Tooltip>
                                  <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                                  <TooltipContent className="max-w-xs"><p>{feature.description}</p></TooltipContent>
                                </Tooltip>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">{feature.description}</p>
                            </div>
                            <Checkbox
                              checked={form.is_admin || form.feature_access[feature.key]}
                              disabled={form.is_admin || (feature.key.startsWith('traceability_') && !form.feature_access.traceability)}
                              onCheckedChange={(checked) => setForm({
                                ...form,
                                feature_access: feature.key === 'traceability' && checked !== true
                                  ? { ...form.feature_access, traceability: false, traceability_release: false, traceability_dispatch: false }
                                  : { ...form.feature_access, [feature.key]: checked === true },
                              })}
                            />
                          </div>
                        ))}
                      </TooltipProvider>
                      <div className="rounded-md bg-muted p-3 text-sm">
                        <span className="font-medium">Actions:</span> Every user has access automatically and will only see actions assigned to them.
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" className="flex-1">{editingUser ? 'Update User' : 'Create User'}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const fullAccess = isAdminRole(user.role);
                    const access = accessFor(user);
                    return (
                      <TableRow key={user.id} data-testid={`user-row-${user.id}`}>
                        <TableCell>
                          <div className="font-medium">{user.name}</div>
                          <div className="text-sm text-muted-foreground">{user.email}</div>
                          {user.company_name && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Building2 className="w-3 h-3" />{user.company_name}</div>}
                        </TableCell>
                        <TableCell><Badge variant={fullAccess ? 'default' : 'outline'} className="gap-1">{roleIcon(user.role)}{roleName(user.role)}</Badge></TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(fullAccess ? FEATURES : FEATURES.filter((feature) => access[feature.key])).map((feature) => (
                              <Badge key={feature.key} variant="secondary">{feature.label}</Badge>
                            ))}
                            {!fullAccess && FEATURES.every((feature) => !access[feature.key]) && <span className="text-sm text-muted-foreground">Actions only</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(user)}><Pencil className="w-4 h-4" /></Button>
                          {user.id !== currentUser?.id && (
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(user.id)}><Trash2 className="w-4 h-4" /></Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UserManagement;
