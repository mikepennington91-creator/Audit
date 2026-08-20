import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { ArrowLeft, Save, Send, FileText, AlertCircle } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DocumentFill = () => {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const [doc, setDoc] = useState(null);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadDocument(); }, [documentId]);

  const loadDocument = async () => {
    try {
      const res = await axios.get(`${API}/traceability/documents/${documentId}`);
      setDoc(res.data);
      const existing = {};
      (res.data.field_values || []).forEach(fv => { existing[fv.field_id] = fv.value; });
      setValues(existing);
    } catch {
      toast.error('Failed to load document');
      navigate('/documents');
    } finally {
      setLoading(false);
    }
  };

  const setValue = (fieldId, value) => setValues(prev => ({ ...prev, [fieldId]: value }));

  const saveProgress = async () => {
    try {
      const fieldValues = Object.entries(values).map(([field_id, value]) => ({ field_id, value }));
      await axios.put(`${API}/traceability/documents/${documentId}`, { field_values: fieldValues, completed: false });
      toast.success('Progress saved');
    } catch {
      toast.error('Failed to save');
    }
  };

  const submitDocument = async () => {
    const fields = doc?.fields || [];
    for (const f of fields) {
      if (f.required) {
        const val = values[f.id];
        if (val === undefined || val === null || val === '' || (f.field_type === 'checkbox' && val === false)) {
          toast.error(`"${f.label}" is required`);
          return;
        }
      }
      if (f.field_type === 'text' || f.field_type === 'blank') {
        const val = values[f.id] || '';
        if (f.min_length && val.length < f.min_length) {
          toast.error(`"${f.label}" must be at least ${f.min_length} characters`);
          return;
        }
        if (f.max_length && val.length > f.max_length) {
          toast.error(`"${f.label}" must be at most ${f.max_length} characters`);
          return;
        }
      }
      if (f.field_type === 'number') {
        const val = parseFloat(values[f.id]);
        if (f.min_value !== null && f.min_value !== undefined && val < f.min_value) {
          toast.error(`"${f.label}" must be at least ${f.min_value}`);
          return;
        }
        if (f.max_value !== null && f.max_value !== undefined && val > f.max_value) {
          toast.error(`"${f.label}" must be at most ${f.max_value}`);
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const fieldValues = Object.entries(values).map(([field_id, value]) => ({ field_id, value }));
      await axios.put(`${API}/traceability/documents/${documentId}`, { field_values: fieldValues, completed: true });
      toast.success('Document completed!');
      navigate('/documents');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  if (!doc) return null;

  const fields = doc.fields || [];

  return (
    <div className="space-y-6" data-testid="document-fill-page">
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
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={saveProgress} data-testid="save-progress-btn">
          <Save className="w-4 h-4 mr-2" />Save
        </Button>
      </div>

      <div className="max-w-2xl mx-auto space-y-4">
        {fields.sort((a, b) => a.order - b.order).map((field, idx) => (
          <Card key={field.id} data-testid={`fill-field-${idx}`}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center gap-2">
                <Label className="font-medium">{field.label}</Label>
                {field.required && <span className="text-destructive text-xs">*</span>}
                <Badge variant="outline" className="text-xs ml-auto">{field.field_type}</Badge>
              </div>

              {field.field_type === 'text' && (
                <div>
                  <Input
                    placeholder={`Enter ${field.label.toLowerCase()}...`}
                    value={values[field.id] || ''}
                    onChange={(e) => setValue(field.id, e.target.value)}
                    maxLength={field.max_length || undefined}
                    data-testid={`input-${idx}`}
                  />
                  {(field.min_length || field.max_length) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {field.min_length ? `Min ${field.min_length}` : ''}{field.min_length && field.max_length ? ' / ' : ''}{field.max_length ? `Max ${field.max_length}` : ''} characters
                      {field.max_length && <span className="ml-1">({(values[field.id] || '').length}/{field.max_length})</span>}
                    </p>
                  )}
                </div>
              )}

              {field.field_type === 'number' && (
                <div>
                  <Input
                    type="number"
                    placeholder={`Enter number...`}
                    value={values[field.id] ?? ''}
                    onChange={(e) => setValue(field.id, e.target.value)}
                    min={field.min_value ?? undefined}
                    max={field.max_value ?? undefined}
                    data-testid={`input-${idx}`}
                  />
                  {(field.min_value !== null || field.max_value !== null) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {field.min_value !== null ? `Min: ${field.min_value}` : ''}{field.min_value !== null && field.max_value !== null ? ' | ' : ''}{field.max_value !== null ? `Max: ${field.max_value}` : ''}
                    </p>
                  )}
                </div>
              )}

              {field.field_type === 'time' && (
                <Input
                  type="time"
                  value={values[field.id] || ''}
                  onChange={(e) => setValue(field.id, e.target.value)}
                  data-testid={`input-${idx}`}
                />
              )}

              {field.field_type === 'checkbox' && (
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <Checkbox
                    checked={!!values[field.id]}
                    onCheckedChange={(checked) => setValue(field.id, checked)}
                    id={`cb-${field.id}`}
                    data-testid={`input-${idx}`}
                  />
                  <Label htmlFor={`cb-${field.id}`} className="text-sm cursor-pointer">{field.label}</Label>
                </div>
              )}

              {field.field_type === 'blank' && (
                <div>
                  <Textarea
                    placeholder={`Enter ${field.label.toLowerCase()}...`}
                    value={values[field.id] || ''}
                    onChange={(e) => setValue(field.id, e.target.value)}
                    maxLength={field.max_length || undefined}
                    rows={3}
                    data-testid={`input-${idx}`}
                  />
                  {field.max_length && (
                    <p className="text-xs text-muted-foreground mt-1">{(values[field.id] || '').length}/{field.max_length} characters</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        <Button onClick={submitDocument} disabled={submitting} className="w-full" size="lg" data-testid="submit-document-btn">
          <Send className="w-4 h-4 mr-2" />
          {submitting ? 'Submitting...' : 'Complete Document'}
        </Button>
      </div>
    </div>
  );
};

export default DocumentFill;
