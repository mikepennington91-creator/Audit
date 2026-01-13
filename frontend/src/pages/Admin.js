import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Users, Shield, UserCircle, Building2, Upload, Download, FileSpreadsheet } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Admin = () => {
  const { user: currentUser } = useAuth();
  const fileInputRef = useRef(null);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('users');
  const [importing, setImporting] = useState(false);
  
  // User Dialog
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userFormData, setUserFormData] = useState({
    email: '',
    password: '',
    name: '',
    role: 'user',
    company_id: ''
  });

  // Company Dialog
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [companyFormData, setCompanyFormData] = useState({
    name: '',
    description: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [usersRes, companiesRes] = await Promise.all([
        axios.get(`${API}/users`),
        axios.get(`${API}/companies`)
      ]);
      setUsers(usersRes.data);
      setCompanies(companiesRes.data);
    } catch (error) {
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // User handlers
  const handleUserSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const updateData = { 
          name: userFormData.name, 
          role: userFormData.role,
          company_id: userFormData.company_id || null
        };
        if (userFormData.password) updateData.password = userFormData.password;
        await axios.put(`${API}/users/${editingUser.id}`, updateData);
        toast.success('User updated successfully');
      } else {
        await axios.post(`${API}/auth/register`, {
          ...userFormData,
          company_id: userFormData.company_id || null
        });
        toast.success('User created successfully');
      }
      setUserDialogOpen(false);
      resetUserForm();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await axios.delete(`${API}/users/${userId}`);
      toast.success('User deleted successfully');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete user');
    }
  };

  const openEditUserDialog = (user) => {
    setEditingUser(user);
    setUserFormData({
      email: user.email,
      password: '',
      name: user.name,
      role: user.role,
      company_id: user.company_id || ''
    });
    setUserDialogOpen(true);
  };

  const resetUserForm = () => {
    setEditingUser(null);
    setUserFormData({ email: '', password: '', name: '', role: 'user', company_id: '' });
  };

  // Company handlers
  const handleCompanySubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingCompany) {
        await axios.put(`${API}/companies/${editingCompany.id}`, companyFormData);
        toast.success('Company updated successfully');
      } else {
        await axios.post(`${API}/companies`, companyFormData);
        toast.success('Company created successfully');
      }
      setCompanyDialogOpen(false);
      resetCompanyForm();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Operation failed');
    }
  };

  const handleDeleteCompany = async (companyId) => {
    if (!window.confirm('Are you sure you want to delete this company? All assigned users will be unassigned.')) return;
    try {
      await axios.delete(`${API}/companies/${companyId}`);
      toast.success('Company deleted successfully');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete company');
    }
  };

  const openEditCompanyDialog = (company) => {
    setEditingCompany(company);
    setCompanyFormData({
      name: company.name,
      description: company.description || ''
    });
    setCompanyDialogOpen(true);
  };

  const resetCompanyForm = () => {
    setEditingCompany(null);
    setCompanyFormData({ name: '', description: '' });
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'admin': return <Shield className="w-4 h-4" />;
      case 'audit_creator': return <UserCircle className="w-4 h-4" />;
      default: return <Users className="w-4 h-4" />;
    }
  };

  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case 'admin': return 'destructive';
      case 'audit_creator': return 'default';
      default: return 'secondary';
    }
  };

  const getCompanyUserCount = (companyId) => {
    return users.filter(u => u.company_id === companyId).length;
  };

  // Bulk import handlers
  const downloadTemplate = async () => {
    try {
      const response = await axios.get(`${API}/users/export-template`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'user_import_template.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Template downloaded');
    } catch (error) {
      toast.error('Failed to download template');
    }
  };

  const handleBulkImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await axios.post(`${API}/users/bulk-import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      const { success, failed, errors } = response.data;
      
      if (success > 0) {
        toast.success(`${success} users imported successfully`);
      }
      if (failed > 0) {
        toast.error(`${failed} users failed to import`);
        console.log('Import errors:', errors);
      }
      
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Administration</h1>
        <p className="text-muted-foreground mt-1">
          Manage companies and system users
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="users" data-testid="users-tab">
            <Users className="w-4 h-4 mr-2" />
            Users
          </TabsTrigger>
          <TabsTrigger value="companies" data-testid="companies-tab">
            <Building2 className="w-4 h-4 mr-2" />
            Companies
          </TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-4">
              <CardTitle className="text-lg">All Users ({users.length})</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Bulk Import */}
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={handleBulkImport}
                  className="hidden"
                />
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={downloadTemplate}
                  data-testid="download-template-btn"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Template
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  data-testid="bulk-import-btn"
                >
                  {importing ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  Import CSV
                </Button>
                <Dialog open={userDialogOpen} onOpenChange={(open) => { setUserDialogOpen(open); if (!open) resetUserForm(); }}>
                  <DialogTrigger asChild>
                    <Button data-testid="add-user-btn">
                      <Plus className="w-4 h-4 mr-2" />
                      Add User
                    </Button>
                  </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleUserSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name</Label>
                      <Input
                        id="name"
                        value={userFormData.name}
                        onChange={(e) => setUserFormData({ ...userFormData, name: e.target.value })}
                        required
                        data-testid="user-name-input"
                      />
                    </div>
                    
                    {!editingUser && (
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={userFormData.email}
                          onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                          required
                          data-testid="user-email-input"
                        />
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <Label htmlFor="password">
                        {editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={userFormData.password}
                        onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                        required={!editingUser}
                        minLength={6}
                        data-testid="user-password-input"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select 
                        value={userFormData.role} 
                        onValueChange={(value) => setUserFormData({ ...userFormData, role: value })}
                      >
                        <SelectTrigger data-testid="user-role-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="audit_creator">Audit Creator</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="company">Company</Label>
                      <Select 
                        value={userFormData.company_id || "none"} 
                        onValueChange={(value) => setUserFormData({ ...userFormData, company_id: value === "none" ? "" : value })}
                      >
                        <SelectTrigger data-testid="user-company-select">
                          <SelectValue placeholder="Select company (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Company</SelectItem>
                          {companies.map(company => (
                            <SelectItem key={company.id} value={company.id}>
                              {company.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setUserDialogOpen(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button type="submit" className="flex-1" data-testid="save-user-btn">
                        {editingUser ? 'Update' : 'Create'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                      <Skeleton className="h-6 w-20" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id} data-testid={`user-row-${user.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-primary font-medium text-sm">
                                  {user.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <span className="font-medium">{user.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{user.email}</TableCell>
                          <TableCell>
                            {user.company_name ? (
                              <Badge variant="outline" className="gap-1">
                                <Building2 className="w-3 h-3" />
                                {user.company_name}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getRoleBadgeVariant(user.role)} className="gap-1">
                              {getRoleIcon(user.role)}
                              {user.role.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(user.created_at).toLocaleDateString('en-GB')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => openEditUserDialog(user)}
                                data-testid={`edit-user-${user.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              {user.id !== currentUser?.id && (
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => handleDeleteUser(user.id)}
                                  className="text-destructive hover:text-destructive"
                                  data-testid={`delete-user-${user.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Companies Tab */}
        <TabsContent value="companies" className="mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Companies ({companies.length})</CardTitle>
              <Dialog open={companyDialogOpen} onOpenChange={(open) => { setCompanyDialogOpen(open); if (!open) resetCompanyForm(); }}>
                <DialogTrigger asChild>
                  <Button data-testid="add-company-btn">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Company
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingCompany ? 'Edit Company' : 'Add New Company'}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCompanySubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="companyName">Company Name</Label>
                      <Input
                        id="companyName"
                        value={companyFormData.name}
                        onChange={(e) => setCompanyFormData({ ...companyFormData, name: e.target.value })}
                        required
                        placeholder="e.g., ABC Foods Ltd"
                        data-testid="company-name-input"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="companyDesc">Description (Optional)</Label>
                      <Textarea
                        id="companyDesc"
                        value={companyFormData.description}
                        onChange={(e) => setCompanyFormData({ ...companyFormData, description: e.target.value })}
                        placeholder="Brief description of the company..."
                        rows={3}
                        data-testid="company-description-input"
                      />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setCompanyDialogOpen(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button type="submit" className="flex-1" data-testid="save-company-btn">
                        {editingCompany ? 'Update' : 'Create'}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-12 w-12 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : companies.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Users</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {companies.map((company) => (
                        <TableRow key={company.id} data-testid={`company-row-${company.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Building2 className="w-5 h-5 text-primary" />
                              </div>
                              <span className="font-medium">{company.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-xs truncate">
                            {company.description || '-'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {getCompanyUserCount(company.id)} users
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(company.created_at).toLocaleDateString('en-GB')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => openEditCompanyDialog(company)}
                                data-testid={`edit-company-${company.id}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleDeleteCompany(company.id)}
                                className="text-destructive hover:text-destructive"
                                data-testid={`delete-company-${company.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                  <p className="text-muted-foreground mb-4">No companies created yet</p>
                  <Button onClick={() => setCompanyDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Company
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Admin;
