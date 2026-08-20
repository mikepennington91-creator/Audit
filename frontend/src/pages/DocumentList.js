import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import {
  Plus, FileText, ChevronRight, Calendar, Trash2,
  AlertTriangle, Eye, FileDown, ClipboardCheck, PenLine
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DocumentList = () => {
  const navigate = useNavigate();
  const { isAdmin, isAuditCreator } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [tRes, dRes] = await Promise.all([
        axios.get(`${API}/traceability/templates`),
        axios.get(`${API}/traceability/documents`)
      ]);
      setTemplates(tRes.data);
      setDocuments(dRes.data);
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const startDocument = async (templateId) => {
    try {
      const res = await axios.post(`${API}/traceability/documents`, { template_id: templateId });
      navigate(`/documents/fill/${res.data.id}`);
    } catch (error) {
      toast.error('Failed to start document');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/traceability/templates/${deleteTarget.id}`);
      toast.success('Template deleted');
      setTemplates(prev => prev.filter(t => t.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      toast.error('Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/London' });
  };

  const completedDocs = documents.filter(d => d.completed);
  const inProgressDocs = documents.filter(d => !d.completed);

  return (
    <div className="space-y-6" data-testid="document-list-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground mt-1">Production paperwork and traceability documents</p>
        </div>
        {isAuditCreator() && (
          <Button onClick={() => navigate('/documents/design')} data-testid="create-template-btn">
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        )}
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" data-testid="templates-tab">Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="completed" data-testid="completed-tab">Completed ({completedDocs.length})</TabsTrigger>
          {inProgressDocs.length > 0 && (
            <TabsTrigger value="progress" data-testid="progress-tab">In Progress ({inProgressDocs.length})</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="templates" className="mt-4">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
            </div>
          ) : templates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map(t => (
                <Card key={t.id} className="hover:border-primary hover:shadow-md transition-all group" data-testid={`template-card-${t.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{t.title}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">{t.document_reference}</Badge>
                          <Badge variant="outline" className="text-xs">v{t.version}</Badge>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t.fields?.length || 0} fields | Authorised by {t.authorised_by}</p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="flex-1" onClick={() => startDocument(t.id)} data-testid={`fill-template-${t.id}`}>
                        <PenLine className="w-4 h-4 mr-1" />
                        Fill In
                      </Button>
                      {isAuditCreator() && (
                        <Button variant="outline" size="sm" onClick={() => navigate(`/documents/design/${t.id}`)} data-testid={`edit-template-${t.id}`}>
                          Edit
                        </Button>
                      )}
                      {isAdmin() && (
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(t)} data-testid={`delete-template-${t.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                <p className="text-muted-foreground">No document templates yet</p>
                {isAuditCreator() && (
                  <Button variant="outline" className="mt-4" onClick={() => navigate('/documents/design')}>
                    <Plus className="w-4 h-4 mr-2" />Create Your First Template
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          {completedDocs.length > 0 ? (
            <div className="space-y-3">
              {completedDocs.map(d => (
                <Card key={d.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate(`/documents/view/${d.id}`)} data-testid={`completed-doc-${d.id}`}>
                  <CardContent className="py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ClipboardCheck className="w-5 h-5 text-emerald-600" />
                      <div>
                        <p className="font-medium">{d.template_title}</p>
                        <p className="text-xs text-muted-foreground">{d.document_reference} | v{d.version} | {formatDate(d.completed_at)} | by {d.completed_by_name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-muted-foreground" />
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
                <p className="text-muted-foreground">No completed documents yet</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {inProgressDocs.length > 0 && (
          <TabsContent value="progress" className="mt-4">
            <div className="space-y-3">
              {inProgressDocs.map(d => (
                <Card key={d.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => navigate(`/documents/fill/${d.id}`)} data-testid={`progress-doc-${d.id}`}>
                  <CardContent className="py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <PenLine className="w-5 h-5 text-amber-500" />
                      <div>
                        <p className="font-medium">{d.template_title}</p>
                        <p className="text-xs text-muted-foreground">{d.document_reference} | Started {formatDate(d.created_at)}</p>
                      </div>
                    </div>
                    <Badge variant="outline">In Progress</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" />Delete Template</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Delete <strong>{deleteTarget?.title}</strong>? This cannot be undone.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} data-testid="confirm-delete">{deleting ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DocumentList;
