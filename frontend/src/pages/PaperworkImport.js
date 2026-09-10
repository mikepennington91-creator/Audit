import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'sonner';
import { ArrowLeft, Bot, Download, FileCheck2, FileSpreadsheet, Files, RefreshCw, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const statusLabel = {
  uploaded: 'Uploaded', extracting: 'Reading', review_ready: 'Ready to review',
  duplicate: 'Duplicate', failed: 'Needs attention', published: 'Published',
};

const PaperworkImport = () => {
  const navigate = useNavigate();
  const scanInput = useRef(null);
  const excelInput = useRef(null);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [config, setConfig] = useState(null);
  const [batches, setBatches] = useState([]);
  const [scanFiles, setScanFiles] = useState([]);
  const [excelFile, setExcelFile] = useState(null);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);

  const selectedTemplate = useMemo(() => templates.find(template => template.id === templateId), [templates, templateId]);

  useEffect(() => {
    const load = async () => {
      try {
        const [summary, importConfig, history] = await Promise.all([
          axios.get(`${API}/documents/summary`),
          axios.get(`${API}/document-imports/config`),
          axios.get(`${API}/document-imports`),
        ]);
        const available = summary.data.templates || [];
        setTemplates(available);
        setTemplateId(available[0]?.id || '');
        setConfig(importConfig.data);
        setBatches(history.data || []);
      } catch (error) {
        toast.error(error.response?.data?.detail || 'Could not load the Paperwork Import Centre');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const updateItem = (batchId, itemId, changes) => {
    setBatches(current => current.map(batch => batch.id !== batchId ? batch : {
      ...batch,
      items: (batch.items || []).map(item => item.id === itemId ? { ...item, ...changes } : item),
    }));
  };

  const uploadScans = async () => {
    if (!templateId) return toast.error('Choose the paperwork form first');
    if (!scanFiles.length) return toast.error('Choose at least one scan');
    setWorking(true);
    try {
      const form = new FormData();
      form.append('template_id', templateId);
      scanFiles.forEach(file => form.append('files', file));
      const uploaded = await axios.post(`${API}/document-imports/scans`, form);
      const batch = { ...uploaded.data, source: 'scan', created_at: new Date().toISOString() };
      setBatches(current => [batch, ...current]);
      setScanFiles([]);
      if (scanInput.current) scanInput.current.value = '';

      if (!config?.ai_enabled) {
        toast.info('Scans saved. AI extraction will be available when the API key is configured.');
        return;
      }
      for (const item of batch.items.filter(entry => entry.status === 'uploaded')) {
        updateItem(batch.id, item.id, { status: 'extracting' });
        try {
          const extracted = await axios.post(`${API}/document-imports/items/${item.id}/extract`);
          updateItem(batch.id, item.id, extracted.data);
        } catch (error) {
          updateItem(batch.id, item.id, { status: 'failed', error: error.response?.data?.detail || 'Extraction failed' });
        }
      }
      toast.success('Import finished. Review the drafts before publishing them.');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Could not upload scans');
    } finally {
      setWorking(false);
    }
  };

  const retryExtraction = async (batchId, itemId) => {
    updateItem(batchId, itemId, { status: 'extracting', error: null });
    try {
      const response = await axios.post(`${API}/document-imports/items/${itemId}/extract`);
      updateItem(batchId, itemId, response.data);
      toast.success('Draft is ready to review');
    } catch (error) {
      updateItem(batchId, itemId, { status: 'failed', error: error.response?.data?.detail || 'Extraction failed' });
      toast.error(error.response?.data?.detail || 'Could not read this scan');
    }
  };

  const downloadWorkbook = async () => {
    if (!templateId) return toast.error('Choose the paperwork form first');
    try {
      const response = await axios.get(`${API}/document-imports/templates/${templateId}/workbook`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedTemplate?.document_reference || 'paperwork'}_bulk_import.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Could not download the workbook');
    }
  };

  const uploadWorkbook = async () => {
    if (!templateId) return toast.error('Choose the paperwork form first');
    if (!excelFile) return toast.error('Choose the completed Excel workbook');
    setWorking(true);
    try {
      const form = new FormData();
      form.append('template_id', templateId);
      form.append('file', excelFile);
      const response = await axios.post(`${API}/document-imports/excel`, form);
      setBatches(current => [{ ...response.data, source: 'excel', created_at: new Date().toISOString() }, ...current]);
      setExcelFile(null);
      if (excelInput.current) excelInput.current.value = '';
      toast.success(`${response.data.items.length} unpublished draft(s) created`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Could not import the workbook');
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="paperwork-import-page">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/documents')} aria-label="Back to documents"><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Paperwork Import Centre</h1>
          <p className="mt-1 text-muted-foreground">Turn scanned or spreadsheet records into reviewable drafts.</p>
        </div>
      </div>

      <Alert className="border-amber-500/50 bg-amber-500/5">
        <FileCheck2 className="h-4 w-4 text-amber-600" />
        <AlertTitle>Nothing is published automatically</AlertTitle>
        <AlertDescription>Every imported record stays as a draft until a person checks it and presses Complete Document.</AlertDescription>
      </Alert>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose the production form</CardTitle></CardHeader>
        <CardContent>
          <Label htmlFor="paperwork-template">Paperwork template</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id="paperwork-template" className="mt-2 w-full sm:max-w-xl" data-testid="paperwork-template-select"><SelectValue placeholder="Choose a form" /></SelectTrigger>
            <SelectContent>{templates.map(template => <SelectItem key={template.id} value={template.id}>{template.title} — {template.document_reference} v{template.version}</SelectItem>)}</SelectContent>
          </Select>
          {!templates.length && <p className="mt-2 text-sm text-muted-foreground">Create a document template before importing paperwork.</p>}
        </CardContent>
      </Card>

      <Tabs defaultValue="scans">
        <TabsList className="grid w-full grid-cols-2 sm:w-[420px]"><TabsTrigger value="scans">Scans with AI</TabsTrigger><TabsTrigger value="excel">Excel upload</TabsTrigger></TabsList>
        <TabsContent value="scans" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-5 w-5 text-primary" />2. Add completed paper forms</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!config?.ai_enabled && <Alert><AlertTitle>AI extraction needs configuring</AlertTitle><AlertDescription>You can use Excel import now. Scans can be extracted after OPENAI_API_KEY is added to the server.</AlertDescription></Alert>}
              <div className="rounded-lg border-2 border-dashed p-6 text-center">
                <Files className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
                <Label htmlFor="paperwork-scans" className="cursor-pointer font-medium">Choose PDF or photo scans</Label>
                <input ref={scanInput} id="paperwork-scans" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={event => setScanFiles(Array.from(event.target.files || []))} />
                <p className="mt-2 text-xs text-muted-foreground">Up to {config?.max_files || 20} files, {config?.max_file_size_mb || 10} MB each</p>
                {!!scanFiles.length && <p className="mt-3 text-sm font-medium">{scanFiles.length} file(s) selected</p>}
              </div>
              {config?.ai_enabled && <p className="text-xs text-muted-foreground">The selected scans are sent to the configured OpenAI API solely to extract the draft values. Keep sensitive paperwork within your company policy.</p>}
              <Button onClick={uploadScans} disabled={working || !scanFiles.length} data-testid="upload-scans-btn"><Upload className="mr-2 h-4 w-4" />{working ? 'Reading paperwork…' : config?.ai_enabled ? 'Upload and create drafts' : 'Save scans for extraction'}</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="excel" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-5 w-5 text-primary" />2. Fill and upload the mapped workbook</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">The workbook is generated for the form selected above, so each column maps to the right field.</p>
              <Button variant="outline" onClick={downloadWorkbook} disabled={!templateId}><Download className="mr-2 h-4 w-4" />Download form workbook</Button>
              <div>
                <Label htmlFor="paperwork-workbook">Completed workbook</Label>
                <input ref={excelInput} id="paperwork-workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-2 block w-full max-w-xl text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground" onChange={event => setExcelFile(event.target.files?.[0] || null)} />
              </div>
              <Button onClick={uploadWorkbook} disabled={working || !excelFile} data-testid="upload-workbook-btn"><Upload className="mr-2 h-4 w-4" />{working ? 'Creating drafts…' : 'Create unpublished drafts'}</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent imports</h2>
        {!batches.length ? <Card className="border-dashed"><CardContent className="py-8 text-center text-sm text-muted-foreground">No paperwork has been imported yet.</CardContent></Card> : batches.map(batch => (
          <Card key={batch.id}>
            <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">{batch.template_title}</CardTitle><Badge variant="outline">{batch.source === 'excel' ? 'Excel' : 'Scans'} · {batch.item_count || batch.items?.length || 0}</Badge></div></CardHeader>
            <CardContent className="space-y-2">
              {(batch.items || []).map(item => (
                <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{item.import_id || item.filename}</p><div className="mt-1 flex flex-wrap items-center gap-2"><Badge variant={item.status === 'failed' || item.status === 'duplicate' ? 'destructive' : 'secondary'}>{statusLabel[item.status] || item.status}</Badge>{item.review_flags?.length > 0 && <span className="text-xs text-amber-600">{item.review_flags.length} field(s) need attention</span>}</div>{item.error && <p className="mt-1 text-xs text-destructive">{item.error}</p>}{item.status === 'duplicate' && <p className="mt-1 text-xs text-muted-foreground">This exact file was already uploaded, so no second record was created.</p>}</div>
                  <div className="flex shrink-0 gap-2">{['uploaded', 'failed'].includes(item.status) && config?.ai_enabled && <Button size="sm" variant="outline" onClick={() => retryExtraction(batch.id, item.id)}><RefreshCw className="mr-1 h-4 w-4" />{item.status === 'uploaded' ? 'Extract now' : 'Retry'}</Button>}{item.draft_document_id && <Button size="sm" onClick={() => navigate(`/documents/fill/${item.draft_document_id}`)}>Review draft</Button>}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
};

export default PaperworkImport;
