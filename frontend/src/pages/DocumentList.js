import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import DeleteRecordDialog from '../components/DeleteRecordDialog';
import { useAuth } from '../context/AuthContext';
import EmailReportDialog from '../components/EmailReportDialog';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import {
  Plus, FileText, ChevronRight, Trash2,
  AlertTriangle, Eye, FileDown, ClipboardCheck, PenLine, Copy, CircleCheck, Mail
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DocumentList = () => {
  const navigate = useNavigate();
  const { isAdmin, hasFeature } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteRecord, setDeleteRecord] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [documentAction, setDocumentAction] = useState(null);
  const [processingDocument, setProcessingDocument] = useState(false);
  const [duplicating, setDuplicating] = useState(null);
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  const [downloadingBatch, setDownloadingBatch] = useState(false);
  const [emailBatchOpen, setEmailBatchOpen] = useState(false);

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

  const handleDuplicate = async (template) => {
    setDuplicating(template.id);
    try {
      const res = await axios.post(`${API}/traceability/templates/${template.id}/duplicate`);
      toast.success(`Template duplicated as "${res.data.title}"`);
      setTemplates(prev => [res.data, ...prev]);
    } catch (error) {
      toast.error('Failed to duplicate');
    } finally {
      setDuplicating(null);
    }
  };

  const handleDocumentAction = async () => {
    if (!documentAction) return;
    setProcessingDocument(true);
    const { type, document: target } = documentAction;
    try {
      if (type === 'close') {
        const res = await axios.put(`${API}/traceability/documents/${target.id}/close-out`);
        setDocuments(prev => prev.map(d => d.id === target.id ? res.data : d));
        toast.success('Document closed out');
      } else {
        await axios.delete(`${API}/traceability/documents/${target.id}`);
        setDocuments(prev => prev.filter(d => d.id !== target.id));
        toast.success('In-progress document deleted');
      }
      setDocumentAction(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || `Failed to ${type === 'close' ? 'close out' : 'delete'} document`);
    } finally {
      setProcessingDocument(false);
    }
  };

  const toggleDocSelection = (docId) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const selectAllCompleted = () => {
    const completed = documents.filter(d => d.completed);
    if (selectedDocs.size === completed.length) setSelectedDocs(new Set());
    else setSelectedDocs(new Set(completed.map(d => d.id)));
  };

  const downloadBatchPdf = async () => {
    if (selectedDocs.size === 0) return toast.error('Select at least one document');
    setDownloadingBatch(true);
    try {
      const res = await axios.post(`${API}/traceability/documents/batch-pdf`, { document_ids: Array.from(selectedDocs) }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'batch_documents.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Downloaded ${selectedDocs.size} document(s) as PDF`);
    } catch (error) {
      toast.error('Failed to download batch PDF');
    } finally {
      setDownloadingBatch(false);
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div><h1 className="text-3xl font-bold tracking-tight">Documents</h1><p className="text-muted-foreground mt-1">Production paperwork and traceability documents</p></div>
        {hasFeature('documents_edit') && <Button onClick={() => navigate('/documents/design')} data-testid="create-template-btn"><Plus className="w-4 h-4 mr-2" />New Template</Button>}
      </div>

      <Tabs defaultValue="templates">
        <TabsList><TabsTrigger value="templates" data-testid="templates-tab">Templates ({templates.length})</TabsTrigger><TabsTrigger value="completed" data-testid="completed-tab">Completed ({completedDocs.length})</TabsTrigger>{inProgressDocs.length > 0 && <TabsTrigger value="progress" data-testid="progress-tab">In Progress ({inProgressDocs.length})</TabsTrigger>}</TabsList>

        <TabsContent value="templates" className="mt-4">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}</div>
          ) : templates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map(t => (
                <Card key={t.id} className="hover:border-primary hover:shadow-md transition-all group" data-testid={`template-card-${t.id}`}>
                  <CardHeader className="pb-3"><div className="flex items-start justify-between"><div className="flex-1 min-w-0"><CardTitle className="text-base truncate">{t.title}</CardTitle><div className="flex items-center gap-2 mt-1"><Badge variant="secondary" className="text-xs">{t.document_reference}</Badge><Badge variant="outline" className="text-xs">v{t.version}</Badge></div></div></div><p className="text-xs text-muted-foreground mt-1">{t.fields?.length || 0} fields | Authorised by {t.authorised_by}</p></CardHeader>
                  <CardContent className="pt-0"><div className="flex items-center gap-2"><Button size="sm" className="flex-1" onClick={() => startDocument(t.id)} data-testid={`fill-template-${t.id}`}><PenLine className="w-4 h-4 mr-1" />Fill In</Button>{hasFeature('documents_edit') && <><Button variant="outline" size="sm" onClick={() => navigate(`/documents/design/${t.id}`)} data-testid={`edit-template-${t.id}`}>Edit</Button><Button variant="outline" size="sm" onClick={() => handleDuplicate(t)} disabled={duplicating === t.id} data-testid={`duplicate-template-${t.id}`}>{duplicating === t.id ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Copy className="w-4 h-4" />}</Button></>}{isAdmin() && <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(t)} data-testid={`delete-template-${t.id}`}><Trash2 className="w-4 h-4" /></Button>}</div></CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" /><p className="text-muted-foreground">No document templates yet</p>{hasFeature('documents_edit') && <Button variant="outline" className="mt-4" onClick={() => navigate('/documents/design')}><Plus className="w-4 h-4 mr-2" />Create Your First Template</Button>}</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          {completedDocs.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg flex-wrap">
                <div className="flex items-center gap-3"><Checkbox checked={selectedDocs.size === completedDocs.length && completedDocs.length > 0} onCheckedChange={selectAllCompleted} data-testid="select-all-docs" /><span className="text-sm text-muted-foreground">{selectedDocs.size > 0 ? `${selectedDocs.size} selected` : 'Select all'}</span></div>
                {selectedDocs.size > 0 && <div className="flex gap-2 flex-wrap"><Button size="sm" variant="outline" onClick={downloadBatchPdf} disabled={downloadingBatch} data-testid="batch-pdf-btn">{downloadingBatch ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" /> : <FileDown className="w-4 h-4 mr-2" />}Download {selectedDocs.size} as PDF</Button><Button size="sm" variant="outline" onClick={() => setEmailBatchOpen(true)} data-testid="batch-email-btn"><Mail className="w-4 h-4 mr-2" />Email {selectedDocs.size} as PDF</Button></div>}
              </div>

              {completedDocs.map(d => (
                <Card key={d.id} className="hover:bg-muted/50 transition-colors" data-testid={`completed-doc-${d.id}`}><CardContent className="py-4 flex items-center gap-3"><Checkbox checked={selectedDocs.has(d.id)} onCheckedChange={() => toggleDocSelection(d.id)} onClick={(e) => e.stopPropagation()} data-testid={`select-doc-${d.id}`} /><div className="flex-1 cursor-pointer flex items-center justify-between" onClick={() => navigate(`/documents/view/${d.id}`)}><div className="flex items-center gap-3"><ClipboardCheck className="w-5 h-5 text-emerald-600" /><div><p className="font-medium">{d.template_title}</p><p className="text-xs text-muted-foreground">{d.document_reference} | v{d.version} | {formatDate(d.completed_at)} | {d.admin_closed_out ? `closed out by ${d.closed_out_by_name}` : `by ${d.completed_by_name}`}</p></div></div><div className="flex items-center gap-2"><Eye className="w-4 h-4 text-muted-foreground" /><ChevronRight className="w-4 h-4 text-muted-foreground" /></div></div>{isAdmin() && <Button variant="ghost" aria-label={`Delete ${d.template_title}`} onClick={() => setDeleteRecord(d)}><Trash2 className="w-4 h-4" /></Button>}</CardContent></Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" /><p className="text-muted-foreground">No completed documents yet</p></CardContent></Card>
          )}
        </TabsContent>

        {inProgressDocs.length > 0 && (
          <TabsContent value="progress" className="mt-4"><div className="space-y-3">{inProgressDocs.map(d => <Card key={d.id} className="hover:bg-muted/50 transition-colors" data-testid={`progress-doc-${d.id}`}><CardContent className="py-4 flex items-center justify-between"><div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => navigate(`/documents/fill/${d.id}`)}><PenLine className="w-5 h-5 text-amber-500" /><div><p className="font-medium">{d.template_title}</p><p className="text-xs text-muted-foreground">{d.document_reference} | Started {formatDate(d.created_at)} | by {d.completed_by_name}</p></div></div><div className="flex items-center gap-2"><Badge variant="outline">In Progress</Badge>{isAdmin() && <><Button variant="outline" size="sm" onClick={() => setDocumentAction({ type: 'close', document: d })} data-testid={`close-out-document-${d.id}`}><CircleCheck className="w-4 h-4 mr-1" />Close Out</Button><Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteRecord(d)} data-testid={`delete-document-${d.id}`} aria-label={`Delete ${d.template_title}`}><Trash2 className="w-4 h-4" /></Button></>}</div></CardContent></Card>)}</div></TabsContent>
        )}
      </Tabs>

      <DeleteRecordDialog record={deleteRecord} onClose={() => setDeleteRecord(null)} onDelete={async reason => {
        try {
          await axios.delete(`${API}/traceability/documents/${deleteRecord.id}`, { data: { reason } });
          setDocuments(prev => prev.filter(d => d.id !== deleteRecord.id));
          setSelectedDocs(prev => { const next = new Set(prev); next.delete(deleteRecord.id); return next; });
          setDeleteRecord(null);
          toast.success('Record deleted; reason logged');
        } catch (error) { toast.error(error.response?.data?.detail || 'Could not delete record'); }
      }} />
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" />Delete Template</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Delete <strong>{deleteTarget?.title}</strong>? This cannot be undone.</p><DialogFooter className="gap-2"><Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button><Button variant="destructive" onClick={handleDelete} disabled={deleting} data-testid="confirm-delete">{deleting ? 'Deleting...' : 'Delete'}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!documentAction} onOpenChange={(o) => !o && setDocumentAction(null)}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className={`w-5 h-5 ${documentAction?.type === 'delete' ? 'text-destructive' : 'text-amber-500'}`} />{documentAction?.type === 'delete' ? 'Delete In-Progress Document' : 'Close Out Document'}</DialogTitle></DialogHeader><div className="space-y-2 text-sm text-muted-foreground"><p>{documentAction?.type === 'delete' ? <>Permanently delete <strong>{documentAction?.document?.template_title}</strong>? This cannot be undone.</> : <>Close out <strong>{documentAction?.document?.template_title}</strong> as completed?</>}</p>{documentAction?.type === 'close' && <p>This keeps the values currently recorded and logs you as the admin who closed it out.</p>}</div><DialogFooter className="gap-2"><Button variant="outline" onClick={() => setDocumentAction(null)} disabled={processingDocument}>Cancel</Button><Button variant={documentAction?.type === 'delete' ? 'destructive' : 'default'} onClick={handleDocumentAction} disabled={processingDocument} data-testid="confirm-document-action">{processingDocument ? 'Processing...' : documentAction?.type === 'delete' ? 'Delete Document' : 'Close Out'}</Button></DialogFooter></DialogContent></Dialog>

      <EmailReportDialog
        open={emailBatchOpen}
        onOpenChange={setEmailBatchOpen}
        endpoint="/reports/documents/batch/email"
        title="Email selected documents"
        description={`Send the ${selectedDocs.size} selected completed document(s) as one PDF attachment.`}
        extraPayload={{ document_ids: Array.from(selectedDocs) }}
      />
    </div>
  );
};

export default DocumentList;
