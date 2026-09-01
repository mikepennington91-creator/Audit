import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import { toast } from 'sonner';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, ArrowLeft,
  Type, Hash, Clock, FileText, Settings,
  Calendar, ChevronDown as DropdownIcon, Table2, LayoutList
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'time', label: 'Time' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'blank', label: 'Blank Field' },
];

const DocumentDesigner = () => {
  const navigate = useNavigate();
  const { templateId } = useParams();
  const isEdit = !!templateId;
  const [loading, setLoading] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const [title, setTitle] = useState('');
  const [docRef, setDocRef] = useState('');
  const [fields, setFields] = useState([]);

  useEffect(() => { if (isEdit) loadTemplate(); }, [templateId]);

  const loadTemplate = async () => {
    setLoadingTemplate(true);
    try {
      const res = await axios.get(`${API}/traceability/templates/${templateId}`);
      const t = res.data;
      setTitle(t.title);
      setDocRef(t.document_reference);
      setFields((t.fields || []).map(f => ({
        id: f.id || Date.now() + Math.random(),
        label: f.label,
        field_type: f.field_type,
        section: f.section || 'header',
        required: f.required,
        min_length: f.min_length,
        max_length: f.max_length,
        min_value: f.min_value,
        max_value: f.max_value,
        dropdown_options: f.dropdown_options || [],
      })));
    } catch {
      toast.error('Failed to load template');
      navigate('/documents');
    } finally {
      setLoadingTemplate(false);
    }
  };

  const addField = () => {
    setFields([...fields, {
      id: Date.now() + Math.random(),
      label: '', field_type: 'text', section: 'header',
      required: false, min_length: null, max_length: null,
      min_value: null, max_value: null, dropdown_options: [],
    }]);
  };

  const updateField = (i, key, val) => {
    const u = [...fields]; u[i][key] = val; setFields(u);
  };
  const removeField = (i) => setFields(fields.filter((_, idx) => idx !== i));
  const moveField = (i, dir) => {
    const n = dir === 'up' ? i - 1 : i + 1;
    if (n < 0 || n >= fields.length) return;
    const u = [...fields]; [u[i], u[n]] = [u[n], u[i]]; setFields(u);
  };

  const addDropdownOption = (fi) => {
    const u = [...fields];
    u[fi].dropdown_options = [...(u[fi].dropdown_options || []), ''];
    setFields(u);
  };
  const updateDropdownOption = (fi, oi, val) => {
    const u = [...fields];
    u[fi].dropdown_options[oi] = val;
    setFields(u);
  };
  const removeDropdownOption = (fi, oi) => {
    const u = [...fields];
    u[fi].dropdown_options = u[fi].dropdown_options.filter((_, i) => i !== oi);
    setFields(u);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return toast.error('Title is required');
    if (!docRef.trim()) return toast.error('Document reference is required');
    if (fields.length === 0) return toast.error('Add at least one field');
    for (let i = 0; i < fields.length; i++) {
      if (!fields[i].label.trim()) return toast.error(`Field ${i + 1} needs a label`);
      if (fields[i].field_type === 'dropdown' && (!fields[i].dropdown_options || fields[i].dropdown_options.filter(o => o.trim()).length < 2)) {
        return toast.error(`Field "${fields[i].label}" needs at least 2 dropdown options`);
      }
    }
    setLoading(true);
    try {
      const payload = {
        title: title.trim(), document_reference: docRef.trim(),
        fields: fields.map((f, i) => ({
          label: f.label.trim(), field_type: f.field_type, section: f.section,
          required: f.required,
          min_length: (f.field_type === 'text' || f.field_type === 'blank') ? f.min_length : null,
          max_length: (f.field_type === 'text' || f.field_type === 'blank') ? f.max_length : null,
          min_value: f.field_type === 'number' ? f.min_value : null,
          max_value: f.field_type === 'number' ? f.max_value : null,
          dropdown_options: f.field_type === 'dropdown' ? f.dropdown_options.filter(o => o.trim()) : null,
          order: i,
        }))
      };
      if (isEdit) {
        await axios.put(`${API}/traceability/templates/${templateId}`, payload);
        toast.success('Template updated (version incremented)');
      } else {
        await axios.post(`${API}/traceability/templates`, payload);
        toast.success('Template created');
      }
      navigate('/documents');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save');
    } finally { setLoading(false); }
  };

  const headerFields = fields.filter(f => f.section === 'header');
  const tableFields = fields.filter(f => f.section === 'table');

  return (
    <div className="space-y-6" data-testid="document-designer-page">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/documents')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{isEdit ? 'Edit Template' : 'Design New Template'}</h1>
          <p className="text-muted-foreground mt-1">Build your document with header fields and a data table</p>
        </div>
      </div>

      {loadingTemplate ? (
        <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            {/* Header Fields Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <LayoutList className="w-5 h-5 text-primary" />Header Fields ({headerFields.length})
                  </CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">Standalone fields that appear once at the top of the document</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {fields.map((field, idx) => field.section !== 'header' ? null : (
                  <FieldEditor key={field.id} field={field} idx={idx} fields={fields}
                    updateField={updateField} removeField={removeField} moveField={moveField}
                    addDropdownOption={addDropdownOption} updateDropdownOption={updateDropdownOption}
                    removeDropdownOption={removeDropdownOption} />
                ))}
                {headerFields.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No header fields yet</p>}
              </CardContent>
            </Card>

            {/* Table Fields Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Table2 className="w-5 h-5 text-primary" />Table Columns ({tableFields.length})
                  </CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">These become columns in the data table — users add rows when filling in (30+ rows supported)</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {fields.map((field, idx) => field.section !== 'table' ? null : (
                  <FieldEditor key={field.id} field={field} idx={idx} fields={fields}
                    updateField={updateField} removeField={removeField} moveField={moveField}
                    addDropdownOption={addDropdownOption} updateDropdownOption={updateDropdownOption}
                    removeDropdownOption={removeDropdownOption} />
                ))}
                {tableFields.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No table columns yet</p>}
              </CardContent>
            </Card>

            {/* Add Field Buttons */}
            <Card className="border-dashed">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" onClick={() => {
                    setFields([...fields, {
                      id: Date.now() + Math.random(), label: '', field_type: 'text',
                      section: 'header', required: false, min_length: null, max_length: null,
                      min_value: null, max_value: null, dropdown_options: [],
                    }]);
                  }} data-testid="add-header-field-btn">
                    <Plus className="w-4 h-4 mr-2" />Add Header Field
                  </Button>
                  <Button type="button" variant="outline" onClick={() => {
                    setFields([...fields, {
                      id: Date.now() + Math.random(), label: '', field_type: 'text',
                      section: 'table', required: false, min_length: null, max_length: null,
                      min_value: null, max_value: null, dropdown_options: [],
                    }]);
                  }} data-testid="add-table-field-btn">
                    <Plus className="w-4 h-4 mr-2" />Add Table Column
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="w-5 h-5 text-primary" />Document Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label>Title *</Label>
                  <Input placeholder="e.g., Production Line Log" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="template-title" />
                </div>
                <div className="space-y-1">
                  <Label>Document Reference *</Label>
                  <Input placeholder="e.g., SD-PLC-001" value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="template-ref" />
                </div>
                <Separator />
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Header fields: {headerFields.length}</p>
                  <p>Table columns: {tableFields.length}</p>
                  <p>Total: {fields.length}</p>
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={loading} data-testid="save-template-btn">
                  <Save className="w-4 h-4 mr-2" />
                  {loading ? 'Saving...' : isEdit ? 'Update Template' : 'Create Template'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
      )}
    </div>
  );
};

const FieldEditor = ({ field, idx, fields, updateField, removeField, moveField, addDropdownOption, updateDropdownOption, removeDropdownOption }) => (
  <Card className="border-l-4 border-l-primary" data-testid={`field-${idx}`}>
    <CardContent className="pt-4">
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-1 pt-2">
          <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => moveField(idx, 'up')} disabled={idx === 0}><ChevronUp className="w-4 h-4" /></Button>
          <span className="text-center text-xs text-muted-foreground font-medium">{idx + 1}</span>
          <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => moveField(idx, 'down')} disabled={idx === fields.length - 1}><ChevronDown className="w-4 h-4" /></Button>
        </div>
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Label *</Label>
              <Input placeholder="Field name" value={field.label} onChange={(e) => updateField(idx, 'label', e.target.value)} data-testid={`field-label-${idx}`} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Select value={field.field_type} onValueChange={(v) => updateField(idx, 'field_type', v)}>
                <SelectTrigger data-testid={`field-type-${idx}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Section</Label>
              <Select value={field.section} onValueChange={(v) => updateField(idx, 'section', v)}>
                <SelectTrigger data-testid={`field-section-${idx}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="header">Header</SelectItem>
                  <SelectItem value="table">Table Column</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={field.required} onCheckedChange={(c) => updateField(idx, 'required', c)} id={`req-${idx}`} />
              <Label htmlFor={`req-${idx}`} className="text-xs">Required</Label>
            </div>
            <Badge variant="outline" className="text-xs">{field.section === 'table' ? 'Table' : 'Header'}</Badge>
          </div>
          {/* Validation for text/blank */}
          {(field.field_type === 'text' || field.field_type === 'blank') && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="space-y-1"><Label className="text-xs">Min Chars</Label><Input type="number" min="0" placeholder="No min" value={field.min_length ?? ''} onChange={(e) => updateField(idx, 'min_length', e.target.value ? parseInt(e.target.value) : null)} /></div>
              <div className="space-y-1"><Label className="text-xs">Max Chars</Label><Input type="number" min="0" placeholder="No max" value={field.max_length ?? ''} onChange={(e) => updateField(idx, 'max_length', e.target.value ? parseInt(e.target.value) : null)} /></div>
            </div>
          )}
          {/* Validation for number */}
          {field.field_type === 'number' && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="space-y-1"><Label className="text-xs">Min Value</Label><Input type="number" placeholder="No min" value={field.min_value ?? ''} onChange={(e) => updateField(idx, 'min_value', e.target.value ? parseFloat(e.target.value) : null)} /></div>
              <div className="space-y-1"><Label className="text-xs">Max Value</Label><Input type="number" placeholder="No max" value={field.max_value ?? ''} onChange={(e) => updateField(idx, 'max_value', e.target.value ? parseFloat(e.target.value) : null)} /></div>
            </div>
          )}
          {/* Dropdown options */}
          {field.field_type === 'dropdown' && (
            <div className="p-3 bg-muted/50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Dropdown Options</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => addDropdownOption(idx)}><Plus className="w-3 h-3 mr-1" />Add</Button>
              </div>
              {(field.dropdown_options || []).map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <Input placeholder={`Option ${oi + 1}`} value={opt} onChange={(e) => updateDropdownOption(idx, oi, e.target.value)} className="flex-1" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeDropdownOption(idx, oi)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
              {(!field.dropdown_options || field.dropdown_options.length === 0) && <p className="text-xs text-muted-foreground">Add at least 2 options</p>}
            </div>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => removeField(idx)} className="text-destructive hover:text-destructive" data-testid={`field-delete-${idx}`}><Trash2 className="w-4 h-4" /></Button>
      </div>
    </CardContent>
  </Card>
);

export default DocumentDesigner;