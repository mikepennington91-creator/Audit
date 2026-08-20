import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft, Download, FileText, Calendar, User, Hash } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DocumentView = () => {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { loadDocument(); }, [documentId]);

  const loadDocument = async () => {
    try {
      const res = await axios.get(`${API}/traceability/documents/${documentId}`);
      setDoc(res.data);
    } catch {
      toast.error('Failed to load document');
      navigate('/documents');
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await axios.get(`${API}/traceability/documents/${documentId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${doc?.document_reference || 'document'}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch {
      toast.error('Failed to download PDF');
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
    });
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
  if (!doc) return null;

  const fieldMap = {};
  (doc.fields || []).forEach(f => { fieldMap[f.id] = f; });

  return (
    <div className="space-y-6" data-testid="document-view-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/documents')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{doc.template_title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary">{doc.document_reference}</Badge>
              <Badge variant="outline">v{doc.version}</Badge>
              <Badge className={doc.completed ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-800'}>
                {doc.completed ? 'Completed' : 'In Progress'}
              </Badge>
            </div>
          </div>
        </div>
        {doc.completed && (
          <Button variant="outline" onClick={downloadPdf} disabled={downloading} data-testid="download-pdf-btn">
            {downloading ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Download PDF
          </Button>
        )}
      </div>

      {/* Document Content */}
      <div className="max-w-2xl mx-auto">
        {/* Title Header */}
        <Card className="mb-6">
          <CardContent className="py-6 text-center">
            <FileText className="w-8 h-8 mx-auto mb-2 text-primary" />
            <h2 className="text-xl font-bold">{doc.template_title}</h2>
          </CardContent>
        </Card>

        {/* Field Values */}
        <Card>
          <CardContent className="py-6 space-y-4">
            {(doc.fields || []).sort((a, b) => a.order - b.order).map((field, idx) => {
              const fv = (doc.field_values || []).find(v => v.field_id === field.id);
              let displayValue = fv?.value ?? '-';
              if (field.field_type === 'checkbox') {
                displayValue = fv?.value ? 'Yes' : 'No';
              }
              return (
                <div key={field.id} className="flex items-start justify-between py-2 border-b last:border-0" data-testid={`view-field-${idx}`}>
                  <div>
                    <p className="text-sm text-muted-foreground">{field.label}</p>
                    <p className="font-medium">{String(displayValue)}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{field.field_type}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Footer Metadata */}
        <Card className="mt-6">
          <CardContent className="py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />Date</p>
                <p className="font-medium">{formatDate(doc.completed_at || doc.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Hash className="w-3 h-3" />Version</p>
                <p className="font-medium">v{doc.version}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="w-3 h-3" />Document Ref</p>
                <p className="font-medium">{doc.document_reference}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />Authorised By</p>
                <p className="font-medium">{doc.authorised_by}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DocumentView;
