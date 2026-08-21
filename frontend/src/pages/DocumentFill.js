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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { toast } from 'sonner';
import { ArrowLeft, Save, Send, Plus, Trash2, Table2, LayoutList } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const DocumentFill = () => {
  const navigate = useNavigate();
  const { documentId } = useParams();
  const [doc, setDoc] = useState(null);
  const [headerValues, setHeaderValues] = useState({});
  const [tableRows, setTableRows] = useState([{}]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadDocument(); }, [documentId]);

  const loadDocument = async () => {
    try {
      const res = await axios.get(`${API}/traceability/documents/${documentId}`);
      setDoc(res.data);
      // Restore header values
      const hv = {};
      (res.data.field_values || []).forEach(fv => { hv[fv.field_id] = fv.value; });
      setHeaderValues(hv);
      // Restore table rows
      const tr = res.data.table_rows;
      setTableRows(tr && tr.length > 0 ? tr : [{}]);
    } catch {
      toast.error('Failed to load document');
      navigate('/documents');
    } finally { setLoading(false); }
  };

  const headerFields = (doc?.fields || []).filter(f => f.section !== 'table').sort((a, b) => a.order - b.order);
  const tableFields = (doc?.fields || []).filter(f => f.section === 'table').sort((a, b) => a.order - b.order);

  const setHeaderValue = (fieldId, value) => setHeaderValues(prev => ({ ...prev, [fieldId]: value }));

  const addRow = () => setTableRows([...tableRows, {}]);
  const removeRow = (idx) => {
    if (tableRows.length <= 1) return;
    setTableRows(tableRows.filter((_, i) => i !== idx));
  };
  const updateCell = (rowIdx, fieldId, value) => {
    const updated = [...tableRows];
    updated[rowIdx] = { ...updated[rowIdx], [fieldId]: value };
    setTableRows(updated);
  };

  const saveProgress = async () => {
    try {
      const fieldValues = Object.entries(headerValues).map(([field_id, value]) => ({ field_id, value }));
      await axios.put(`${API}/traceability/documents/${documentId}`, { field_values: fieldValues, table_rows: tableRows, completed: false });
      toast.success('Progress saved');
    } catch { toast.error('Failed to save'); }
  };

  const submitDocument = async () => {
    // Validate header fields
    for (const f of headerFields) {
      if (f.required) {
        const val = headerValues[f.id];
        if (val === undefined || val === null || val === '' || (f.field_type === 'checkbox' && val === false)) {
          toast.error(`"${f.label}" is required`); return;
        }
      }
    }
    // Validate table rows
    for (let ri = 0; ri < tableRows.length; ri++) {
      for (const f of tableFields) {
        if (f.required) {
          const val = tableRows[ri][f.id];
          if (val === undefined || val === null || val === '' || (f.field_type === 'checkbox' && val === false)) {
            toast.error(`Row ${ri + 1}: "${f.label}" is required`); return;
          }
        }
      }
    }

    setSubmitting(true);
    try {
      const fieldValues = Object.entries(headerValues).map(([field_id, value]) => ({ field_id, value }));
      await axios.put(`${API}/traceability/documents/${documentId}`, { field_values: fieldValues, table_rows: tableRows, completed: true });
      toast.success('Document completed!');
      navigate('/documents');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit');
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!doc) return null;

  const renderInput = (field, value, onChange) => {
    switch (field.field_type) {
      case 'text':
        return <Input placeholder={field.label} value={value || ''} onChange={(e) => onChange(e.target.value)} maxLength={field.max_length || undefined} />;
      case 'number':
        return <Input type="number" placeholder={field.label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} min={field.min_value ?? undefined} max={field.max_value ?? undefined} />;
      case 'time':
        return <Input type="time" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
      case 'date':
        return <Input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
      case 'checkbox':
        return (
          <div className="flex items-center gap-2 h-10">
            <Checkbox checked={!!value} onCheckedChange={(checked) => onChange(checked)} />
          </div>
        );
      case 'dropdown':
        return (
          <Select value={value || ''} onValueChange={onChange}>
            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {(field.dropdown_options || []).map((opt, i) => (
                <SelectItem key={i} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'blank':
        return <Textarea placeholder={field.label} value={value || ''} onChange={(e) => onChange(e.target.value)} maxLength={field.max_length || undefined} rows={2} />;
      default:
        return <Input value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    }
  };

  return (
    <div className="space-y-6" data-testid="document-fill-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/documents')}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{doc.template_title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary">{doc.document_reference}</Badge>
              <Badge variant="outline">v{doc.version}</Badge>
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={saveProgress} data-testid="save-progress-btn"><Save className="w-4 h-4 mr-2" />Save</Button>
      </div>

      {/* Header Fields */}
      {headerFields.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><LayoutList className="w-4 h-4 text-primary" />Document Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {headerFields.map((field, idx) => (
                <div key={field.id} className="space-y-1" data-testid={`header-field-${idx}`}>
                  <Label className="text-sm font-medium">
                    {field.label} {field.required && <span className="text-destructive">*</span>}
                  </Label>
                  {renderInput(field, headerValues[field.id], (val) => setHeaderValue(field.id, val))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table Section */}
      {tableFields.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Table2 className="w-4 h-4 text-primary" />Production Data ({tableRows.length} rows)
              </CardTitle>
              <Button type="button" size="sm" onClick={addRow} data-testid="add-row-btn">
                <Plus className="w-4 h-4 mr-1" />Add Row
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                    {tableFields.map(f => (
                      <th key={f.id} className="px-3 py-2 text-left font-medium text-muted-foreground min-w-[140px]">
                        {f.label} {f.required && <span className="text-destructive">*</span>}
                      </th>
                    ))}
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri} className="border-b last:border-0 hover:bg-muted/30" data-testid={`table-row-${ri}`}>
                      <td className="px-3 py-2 text-muted-foreground font-medium">{ri + 1}</td>
                      {tableFields.map(f => (
                        <td key={f.id} className="px-2 py-1">
                          {renderInput(f, row[f.id], (val) => updateCell(ri, f.id, val))}
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(ri)} disabled={tableRows.length <= 1} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" variant="outline" className="w-full mt-3" onClick={addRow} data-testid="add-row-bottom-btn">
              <Plus className="w-4 h-4 mr-2" />Add Row
            </Button>
          </CardContent>
        </Card>
      )}

      <Separator />

      <Button onClick={submitDocument} disabled={submitting} className="w-full" size="lg" data-testid="submit-document-btn">
        <Send className="w-4 h-4 mr-2" />
        {submitting ? 'Submitting...' : 'Complete Document'}
      </Button>
    </div>
  );
};

export default DocumentFill;
