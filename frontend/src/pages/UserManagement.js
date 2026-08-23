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
import { Switch } from '../components/ui/switch';
import { toast } from 'sonner';
import { Building2, Crown, Download, Pencil, Plus, Shield, Trash2, Upload, UserCircle, Users } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const DEFAULT_ACCESS = { audits: true, traceability: true, documents: true, actions: false };
const FULL_ACCESS = { audits: true, traceability: true, documents: true, actions: true };
const FEATURES = [
  { key: 'audits', label: 'Audits' },
  { key: 'traceability', label: 'Traceability' },
  { key: 'documents', label: 'Documents' },
  { key: 'actions', label: 'Actions' },
];

const isAdminRole = (role) => ['system_admin', 'company_admin', 'admin'].includes(role);
const accessFor = (user) => isAdminRole(user?.role)
  ? FULL_ACCESS
  : { ...DEFAULT_ACCESS, ...(user?.feature_access || {}) };

const emptyUserForm = {
  email: '',
  password: '',
  name: '',
  role: 'user',
  company_id: '',
  feature_access: { ...DEFAULT_ACCESS },
};

const UserManagement = () => {
  const { user: currentUser } = useAuth();
  const fileInputRef = useRef(null);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [savingToggle, setSavingToggle] = useState('');
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
      role: user.role,
      company_id: user.company_id || '',
      feature_access: accessFor(user),
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        name: form.name,
        role: form.role,
        company_id: isSystemAdmin ? (form.company_id || null) : currentUser?.company_id,
        feature_access: isAdminRole(form.role) ? { ...FULL_ACCESS } : form.feature_access,
      };
      if (form.password) payload.password = form.password;

      if (editingUser) {
        await axios.put(`${API}/users/${editingUser.id}`, payload);
        toast.success('User updated successfully');
      } else {
        await axios.post(`${API}/auth/register`, { ...payload, email: form.email, password: form.password });
        toast.success('User created successfully');
      }
      setDialogOpen(false);
      resetForm();
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

  const handleFeatureToggle = async (targetUser, feature, enabled) => {
    if (isAdminRole(targetUser.role)) return;
    const toggleId = `${targetUser.id}-${feature}`;
    const nextAccess = { ...accessFor(targetUser), [feature]: enabled };
    const previousUsers = users;
    setSavingToggle(toggleId);
    setUsers((current) => current.map((user) => user.id === targetUser.id
      ? { ...user, feature_access: nextAccess }
      : user));
    try {
      await axios.put(`${API}/users/${targetUser.id}`, { feature_access: nextAccess });
      toast.success(`${feature.charAt(0).toUpperCase() + feature.slice(1)} access ${enabled ? 'enabled' : 'disabled'} for ${targetUser.name}`);
    } catch (error) {
      setUsers(previousUsers);
      toast.error(error.response?.data?.detail || 'Failed to update access');
    } finally {
      setSavingToggle('');
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
              <DialogContent className="max-w-xl">
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
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={form.role} onValueChange={(role) => setForm({ ...form, role, feature_access: isAdminRole(role) ? { ...FULL_ACCESS } : form.feature_access })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="audit_creator">Audit Creator</SelectItem>
                          <SelectItem value="company_admin">Company Admin</SelectItem>
                          {isSystemAdmin && <SelectItem value="system_admin">System Admin</SelectItem>}
                        </SelectContent>
                      </Select>
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
                      {isAdminRole(form.role) && <p className="text-xs text-muted-foreground mt-1">Administrators automatically have full access.</p>}
                    </div>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {FEATURES.map((feature) => (
                        <label key={feature.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
                          <span className="text-sm font-medium">{feature.label}</span>
                          <Switch
                            checked={isAdminRole(form.role) || form.feature_access[feature.key]}
                            disabled={isAdminRole(form.role)}
                            onCheckedChange={(checked) => setForm({ ...form, feature_access: { ...form.feature_access, [feature.key]: checked } })}
                          />
                        </label>
                      ))}
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
                    {FEATURES.map((feature) => <TableHead key={feature.key} className="text-center">{feature.label}</TableHead>)}
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
                        {FEATURES.map((feature) => (
                          <TableCell key={feature.key} className="text-center">
                            <Switch
                              aria-label={`${feature.label} access for ${user.name}`}
                              checked={access[feature.key]}
                              disabled={fullAccess || savingToggle === `${user.id}-${feature.key}`}
                              onCheckedChange={(checked) => handleFeatureToggle(user, feature.key, checked)}
                              data-testid={`toggle-${feature.key}-${user.id}`}
                            />
                          </TableCell>
                        ))}
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
