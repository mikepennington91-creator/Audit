import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { emailExport } from '../utils/emailExport';
import { ArrowLeft, Download, FileText, Calendar, User, Hash, Table2, LayoutList, Mail } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DocumentView = () => {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const { user } = useAuth();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { loadDocument(); }, [documentId]);

  const loadDocument = async () => {
    try { const res = await axios.get(`${API}/traceability/documents/${documentId}`); setDoc(res.data); }
    catch { toast.error('Failed to load document'); navigate('/documents'); }
    finally { setLoading(false); }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await axios.get(`${API}/traceability/documents/${documentId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a'); link.href = url; link.setAttribute('download', `${doc?.document_reference || 'document'}.pdf`);
      document.body.appendChild(link); link.click(); link.remove(); window.URL.revokeObjectURL(url); toast.success('PDF downloaded');
    } catch { toast.error('Failed to download PDF'); }
    finally { setDownloading(false); }
  };

  const emailPdf = () => emailExport({ kind: 'document', resourceId: documentId, defaultEmail: user?.email || '' });
  const formatDate = (iso) => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '-';

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!doc) return null;

  const headerFields = (doc.fields || []).filter(f => f.section !== 'table').sort((a, b) => a.order - b.order);
  const tableFields = (doc.fields || []).filter(f => f.section === 'table').sort((a, b) => a.order - b.order);
  const getDisplayValue = (field, value) => value === undefined || value === null || value === '' ? '-' : field?.field_type === 'checkbox' ? (value ? 'Yes' : 'No') : String(value);

  return (
    <div className="space-y-6" data-testid="document-view-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4"><Button variant="ghost" size="sm" onClick={() => navigate('/documents')}><ArrowLeft className="w-4 h-4" /></Button><div><h1 className="text-2xl font-bold tracking-tight">{doc.template_title}</h1><div className="flex items-center gap-2 mt-1"><Badge variant="secondary">{doc.document_reference}</Badge><Badge variant="outline">v{doc.version}</Badge><Badge className={doc.completed ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-800'}>{doc.completed ? 'Completed' : 'In Progress'}</Badge>{doc.admin_closed_out && <Badge variant="outline">Admin Closed Out</Badge>}</div></div></div>
        {doc.completed && <div className="flex gap-2"><Button variant="outline" onClick={downloadPdf} disabled={downloading} data-testid="download-pdf-btn">{downloading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}Download PDF</Button><Button variant="outline" onClick={emailPdf}><Mail className="w-4 h-4 mr-2" />Email PDF</Button></div>}
      </div>

      <Card><CardContent className="py-6 text-center"><FileText className="w-8 h-8 mx-auto mb-2 text-primary" /><h2 className="text-xl font-bold">{doc.template_title}</h2></CardContent></Card>

      {headerFields.length > 0 && <Card><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><LayoutList className="w-4 h-4 text-primary" />Document Details</CardTitle></CardHeader><CardContent><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{headerFields.map((field, idx) => { const fv = (doc.field_values || []).find(v => v.field_id === field.id); return <div key={field.id} className="py-2 border-b last:border-0" data-testid={`view-header-${idx}`}><p className="text-xs text-muted-foreground">{field.label}</p><p className="font-medium">{getDisplayValue(field, fv?.value)}</p></div>; })}</div></CardContent></Card>}

      {tableFields.length > 0 && (doc.table_rows || []).length > 0 && <Card><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Table2 className="w-4 h-4 text-primary" />Production Data ({doc.table_rows.length} rows)</CardTitle></CardHeader><CardContent><div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm"><thead><tr className="bg-muted/50 border-b"><th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>{tableFields.map(f => <th key={f.id} className="px-3 py-2 text-left font-medium text-muted-foreground">{f.label}</th>)}</tr></thead><tbody>{doc.table_rows.map((row, ri) => <tr key={ri} className="border-b last:border-0 hover:bg-muted/30" data-testid={`view-row-${ri}`}><td className="px-3 py-2 text-muted-foreground font-medium">{ri + 1}</td>{tableFields.map(f => <td key={f.id} className="px-3 py-2">{getDisplayValue(f, row[f.id])}</td>)}</tr>)}</tbody></table></div></CardContent></Card>}

      <Card><CardContent className="py-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"><div><p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />Date</p><p className="font-medium">{formatDate(doc.completed_at || doc.created_at)}</p></div><div><p className="text-xs text-muted-foreground flex items-center gap-1"><Hash className="w-3 h-3" />Version</p><p className="font-medium">v{doc.version}</p></div><div><p className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="w-3 h-3" />Document Ref</p><p className="font-medium">{doc.document_reference}</p></div><div><p className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />Authorised By</p><p className="font-medium">{doc.authorised_by}</p></div>{doc.admin_closed_out && <><div><p className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />Started By</p><p className="font-medium">{doc.completed_by_name}</p></div><div><p className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />Closed Out By</p><p className="font-medium">{doc.closed_out_by_name}</p></div></>}</div></CardContent></Card>
    </div>
  );
};

export default DocumentView;
