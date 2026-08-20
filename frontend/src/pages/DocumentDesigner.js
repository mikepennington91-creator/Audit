import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, ArrowLeft,
  Type, Hash, Clock, CheckSquare, FileText, Settings
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const FIELD_TYPES = [
  { value: 'text', label: 'Text', icon: Type, hint: 'Free text input' },
  { value: 'number', label: 'Number', icon: Hash, hint: 'Numeric values only' },
  { value: 'time', label: 'Time', icon: Clock, hint: 'Time picker (HH:MM)' },
  { value: 'checkbox', label: 'Checkbox', icon: CheckSquare, hint: 'Yes/No checkbox' },
  { value: 'blank', label: 'Blank Field', icon: FileText, hint: 'Generic open field' },
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

  useEffect(() => {
    if (isEdit) loadTemplate();
  }, [templateId]);

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
        required: f.required,
        min_length: f.min_length,
        max_length: f.max_length,
        min_value: f.min_value,
        max_value: f.max_value
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
      label: '',
      field_type: 'text',
      required: false,
      min_length: null,
      max_length: null,
      min_value: null,
      max_value: null
    }]);
  };

  const updateField = (index, key, value) => {
    const updated = [...fields];
    updated[index][key] = value;
    setFields(updated);
  };

  const removeField = (index) => setFields(fields.filter((_, i) => i !== index));

  const moveField = (index, direction) => {
    const newIdx = direction === 'up' ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= fields.length) return;
    const updated = [...fields];
    [updated[index], updated[newIdx]] = [updated[newIdx], updated[index]];
    setFields(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return toast.error('Title is required');
    if (!docRef.trim()) return toast.error('Document reference is required');
    if (fields.length === 0) return toast.error('Add at least one field');
    for (let i = 0; i < fields.length; i++) {
      if (!fields[i].label.trim()) return toast.error(`Field ${i + 1} needs a label`);
    }

    setLoading(true);
    try {
      const payload = {
        title: title.trim(),
        document_reference: docRef.trim(),
        fields: fields.map((f, i) => ({
          label: f.label.trim(),
          field_type: f.field_type,
          required: f.required,
          min_length: f.field_type === 'text' ? f.min_length : null,
          max_length: f.field_type === 'text' || f.field_type === 'blank' ? f.max_length : null,
          min_value: f.field_type === 'number' ? f.min_value : null,
          max_value: f.field_type === 'number' ? f.max_value : null,
          order: i
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="document-designer-page">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/documents')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{isEdit ? 'Edit Template' : 'Design New Template'}</h1>
          <p className="text-muted-foreground mt-1">Build your document template with custom fields</p>
        </div>
      </div>

      {loadingTemplate ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Fields */}
          <div className="lg:col-span-8 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />Fields ({fields.length})
                  </CardTitle>
                  <Button type="button" onClick={addField} data-testid="add-field-btn">
                    <Plus className="w-4 h-4 mr-2" />Add Field
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {fields.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed rounded-lg">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground mb-4">No fields added yet</p>
                    <Button type="button" variant="outline" onClick={addField}>
                      <Plus className="w-4 h-4 mr-2" />Add Your First Field
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {fields.map((field, idx) => {
                      const typeInfo = FIELD_TYPES.find(t => t.value === field.field_type) || FIELD_TYPES[0];
                      const Icon = typeInfo.icon;
                      return (
                        <Card key={field.id} className="border-l-4 border-l-primary" data-testid={`field-${idx}`}>
                          <CardContent className="pt-4">
                            <div className="flex items-start gap-3">
                              <div className="flex flex-col gap-1 pt-2">
                                <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => moveField(idx, 'up')} disabled={idx === 0} data-testid={`field-up-${idx}`}>
                                  <ChevronUp className="w-4 h-4" />
                                </Button>
                                <span className="text-center text-xs text-muted-foreground font-medium">{idx + 1}</span>
                                <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => moveField(idx, 'down')} disabled={idx === fields.length - 1} data-testid={`field-down-${idx}`}>
                                  <ChevronDown className="w-4 h-4" />
                                </Button>
                              </div>

                              <div className="flex-1 space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Field Label *</Label>
                                    <Input
                                      placeholder="e.g., Temperature Reading"
                                      value={field.label}
                                      onChange={(e) => updateField(idx, 'label', e.target.value)}
                                      data-testid={`field-label-${idx}`}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Field Type</Label>
                                    <Select value={field.field_type} onValueChange={(v) => updateField(idx, 'field_type', v)}>
                                      <SelectTrigger data-testid={`field-type-${idx}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {FIELD_TYPES.map(t => (
                                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                <div className="flex items-center gap-4">
                                  <div className="flex items-center gap-2">
                                    <Switch checked={field.required} onCheckedChange={(c) => updateField(idx, 'required', c)} id={`req-${idx}`} />
                                    <Label htmlFor={`req-${idx}`} className="text-xs">Required</Label>
                                  </div>
                                  <Badge variant="outline" className="gap-1 text-xs">
                                    <Icon className="w-3 h-3" />{typeInfo.label}
                                  </Badge>
                                </div>

                                {/* Validation options */}
                                {(field.field_type === 'text' || field.field_type === 'blank') && (
                                  <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Min Characters</Label>
                                      <Input type="number" min="0" placeholder="No min" value={field.min_length ?? ''} onChange={(e) => updateField(idx, 'min_length', e.target.value ? parseInt(e.target.value) : null)} />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Max Characters</Label>
                                      <Input type="number" min="0" placeholder="No max" value={field.max_length ?? ''} onChange={(e) => updateField(idx, 'max_length', e.target.value ? parseInt(e.target.value) : null)} />
                                    </div>
                                  </div>
                                )}
                                {field.field_type === 'number' && (
                                  <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Min Value</Label>
                                      <Input type="number" placeholder="No min" value={field.min_value ?? ''} onChange={(e) => updateField(idx, 'min_value', e.target.value ? parseFloat(e.target.value) : null)} />
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-xs">Max Value</Label>
                                      <Input type="number" placeholder="No max" value={field.max_value ?? ''} onChange={(e) => updateField(idx, 'max_value', e.target.value ? parseFloat(e.target.value) : null)} />
                                    </div>
                                  </div>
                                )}
                              </div>

                              <Button type="button" variant="ghost" size="sm" onClick={() => removeField(idx)} className="text-destructive hover:text-destructive" data-testid={`field-delete-${idx}`}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
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
                  <Input placeholder="e.g., Production Line Checklist" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="template-title" />
                </div>
                <div className="space-y-1">
                  <Label>Document Reference *</Label>
                  <Input placeholder="e.g., SD-GMP-001" value={docRef} onChange={(e) => setDocRef(e.target.value)} data-testid="template-ref" />
                  <p className="text-xs text-muted-foreground">Unique reference code for this document</p>
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

export default DocumentDesigner;
