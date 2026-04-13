import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { toast } from 'sonner';
import { 
  Plus, 
  Trash2, 
  GripVertical, 
  ChevronUp, 
  ChevronDown,
  Save,
  ArrowLeft,
  FileText,
  Settings,
  ListChecks
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const CreateAudit = () => {
  const navigate = useNavigate();
  const { auditId } = useParams();
  const isEditMode = !!auditId;
  const [loading, setLoading] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditTypes, setAuditTypes] = useState([]);
  const [responseGroups, setResponseGroups] = useState([]);
  
  // Form state
  const [auditName, setAuditName] = useState('');
  const [description, setDescription] = useState('');
  const [auditTypeId, setAuditTypeId] = useState('');
  const [passRate, setPassRate] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [questions, setQuestions] = useState([]);

  // Search filter for audit types
  const [typeSearchTerm, setTypeSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (isEditMode) {
      loadAudit();
    }
  }, [auditId]);

  const loadAudit = async () => {
    setLoadingAudit(true);
    try {
      const response = await axios.get(`${API}/audits/${auditId}`);
      const audit = response.data;
      setAuditName(audit.name || '');
      setDescription(audit.description || '');
      setAuditTypeId(audit.audit_type_id || '');
      setPassRate(audit.pass_rate != null ? String(audit.pass_rate) : '');
      setIsPrivate(audit.is_private || false);
      setQuestions((audit.questions || []).map(q => ({
        id: q.id || Date.now() + Math.random(),
        text: q.text || '',
        question_type: q.question_type || 'response_group',
        response_group_id: q.response_group_id || '',
        custom_responses: q.custom_responses || [],
        enable_scoring: q.enable_scoring || false,
        required: q.required !== false,
        useCustomResponses: !q.response_group_id && (q.custom_responses?.length > 0)
      })));
    } catch (error) {
      toast.error('Failed to load audit');
      navigate('/create-audit');
    } finally {
      setLoadingAudit(false);
    }
  };

  const fetchData = async () => {
    try {
      const [typesRes, groupsRes] = await Promise.all([
        axios.get(`${API}/audit-types`),
        axios.get(`${API}/response-groups`)
      ]);
      setAuditTypes(typesRes.data);
      setResponseGroups(groupsRes.data);
    } catch (error) {
      toast.error('Failed to load data');
    }
  };

  const filteredAuditTypes = auditTypes.filter(type => 
    type.name.toLowerCase().includes(typeSearchTerm.toLowerCase())
  );

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: Date.now(),
        text: '',
        question_type: 'response_group', // response_group, text, number, alphanumeric
        response_group_id: '',
        custom_responses: [],
        enable_scoring: false,
        required: true,
        useCustomResponses: false
      }
    ]);
  };

  const updateQuestion = (index, field, value) => {
    const newQuestions = [...questions];
    newQuestions[index][field] = value;
    
    // If selecting a response group, check if it has scoring enabled
    if (field === 'response_group_id' && value) {
      const group = responseGroups.find(g => g.id === value);
      if (group) {
        newQuestions[index].enable_scoring = group.enable_scoring;
      }
    }
    
    // Reset related fields when changing question type
    if (field === 'question_type') {
      if (value !== 'response_group') {
        newQuestions[index].response_group_id = '';
        newQuestions[index].custom_responses = [];
        newQuestions[index].useCustomResponses = false;
        newQuestions[index].enable_scoring = false;
      }
    }
    
    setQuestions(newQuestions);
  };

  const removeQuestion = (index) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const moveQuestion = (index, direction) => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= questions.length) return;
    
    const newQuestions = [...questions];
    [newQuestions[index], newQuestions[newIndex]] = [newQuestions[newIndex], newQuestions[index]];
    setQuestions(newQuestions);
  };

  const addCustomResponse = (questionIndex) => {
    const newQuestions = [...questions];
    if (!newQuestions[questionIndex].custom_responses) {
      newQuestions[questionIndex].custom_responses = [];
    }
    newQuestions[questionIndex].custom_responses.push({ label: '', value: '', score: null, is_negative: false });
    setQuestions(newQuestions);
  };

  const updateCustomResponse = (questionIndex, responseIndex, field, value) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].custom_responses[responseIndex][field] = value;
    if (field === 'label') {
      newQuestions[questionIndex].custom_responses[responseIndex].value = value.toLowerCase().replace(/\s+/g, '_');
    }
    setQuestions(newQuestions);
  };

  const removeCustomResponse = (questionIndex, responseIndex) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].custom_responses = newQuestions[questionIndex].custom_responses.filter((_, i) => i !== responseIndex);
    setQuestions(newQuestions);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!auditName.trim()) {
      toast.error('Audit name is required');
      return;
    }
    
    if (questions.length === 0) {
      toast.error('Add at least one question');
      return;
    }

    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) {
        toast.error(`Question ${i + 1} text is required`);
        return;
      }
      // Only validate response options for response_group type questions
      if (q.question_type === 'response_group') {
        if (!q.response_group_id && (!q.custom_responses || q.custom_responses.length < 2)) {
          toast.error(`Question ${i + 1} needs a response group or at least 2 custom responses`);
          return;
        }
      }
    }

    setLoading(true);
    try {
      const payload = {
        name: auditName.trim(),
        description: description.trim() || null,
        audit_type_id: auditTypeId || null,
        pass_rate: passRate ? parseFloat(passRate) : null,
        is_private: isPrivate,
        questions: questions.map((q, i) => ({
          text: q.text.trim(),
          question_type: q.question_type || 'response_group',
          response_group_id: q.question_type === 'response_group' ? (q.response_group_id || null) : null,
          custom_responses: q.question_type === 'response_group' && q.custom_responses?.length > 0 ? q.custom_responses.map(r => ({
            label: r.label,
            value: r.value || r.label.toLowerCase().replace(/\s+/g, '_'),
            score: q.enable_scoring ? parseFloat(r.score) || 0 : null,
            is_negative: r.is_negative || false
          })) : null,
          enable_scoring: q.enable_scoring,
          required: q.required,
          order: i
        }))
      };

      if (isEditMode) {
        await axios.put(`${API}/audits/${auditId}`, payload);
        toast.success('Audit updated successfully!');
      } else {
        await axios.post(`${API}/audits`, payload);
        toast.success('Audit created successfully!');
      }
      navigate('/run-audit');
    } catch (error) {
      toast.error(error.response?.data?.detail || (isEditMode ? 'Failed to update audit' : 'Failed to create audit'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="create-audit-page">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{isEditMode ? 'Edit Audit' : 'Create New Audit'}</h1>
          <p className="text-muted-foreground mt-1">
            {isEditMode 
              ? 'Update this audit template — changes apply to future runs only'
              : 'Build a custom audit template with questions and response options'
            }
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {loadingAudit ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Content - Questions */}
          <div className="lg:col-span-8 space-y-4">
            {/* Audit Details Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <CardTitle className="text-lg">Audit Details</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="auditName">Audit Name *</Label>
                  <Input
                    id="auditName"
                    placeholder="e.g., Kitchen Hygiene Inspection"
                    value={auditName}
                    onChange={(e) => setAuditName(e.target.value)}
                    required
                    data-testid="audit-name-input"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="description">Details and Purpose</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe the purpose and scope of this audit..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    data-testid="audit-description"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Questions Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-5 h-5 text-primary" />
                    <CardTitle className="text-lg">Questions ({questions.length})</CardTitle>
                  </div>
                  <Button type="button" onClick={addQuestion} data-testid="add-question-btn">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Question
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {questions.length === 0 ? (
                  <div className="text-center py-12 border-2 border-dashed rounded-lg">
                    <ListChecks className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground mb-4">No questions added yet</p>
                    <Button type="button" variant="outline" onClick={addQuestion}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Your First Question
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {questions.map((question, qIndex) => (
                      <Card key={question.id} className="border-l-4 border-l-primary" data-testid={`question-${qIndex}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col gap-1 pt-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => moveQuestion(qIndex, 'up')}
                                disabled={qIndex === 0}
                              >
                                <ChevronUp className="w-4 h-4" />
                              </Button>
                              <span className="text-center text-xs text-muted-foreground font-medium">
                                {qIndex + 1}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => moveQuestion(qIndex, 'down')}
                                disabled={qIndex === questions.length - 1}
                              >
                                <ChevronDown className="w-4 h-4" />
                              </Button>
                            </div>
                            
                            <div className="flex-1 space-y-4">
                              <div className="space-y-2">
                                <Label>Question Text *</Label>
                                <Textarea
                                  placeholder="Enter your question..."
                                  value={question.text}
                                  onChange={(e) => updateQuestion(qIndex, 'text', e.target.value)}
                                  rows={2}
                                  data-testid={`question-text-${qIndex}`}
                                />
                              </div>

                              {/* Question Type Selector */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Question Type</Label>
                                  <Select
                                    value={question.question_type || 'response_group'}
                                    onValueChange={(value) => updateQuestion(qIndex, 'question_type', value)}
                                  >
                                    <SelectTrigger data-testid={`question-type-${qIndex}`}>
                                      <SelectValue placeholder="Select question type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="response_group">Response Options</SelectItem>
                                      <SelectItem value="text">Text Input (Free text)</SelectItem>
                                      <SelectItem value="number">Number Input (Numeric only)</SelectItem>
                                      <SelectItem value="alphanumeric">Alphanumeric Input (Letters & Numbers)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="flex items-center gap-4">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={question.required}
                                      onCheckedChange={(checked) => updateQuestion(qIndex, 'required', checked)}
                                      id={`required-${qIndex}`}
                                    />
                                    <Label htmlFor={`required-${qIndex}`} className="text-sm">Required</Label>
                                  </div>
                                </div>
                              </div>

                              {/* Response Set - Only show for response_group type */}
                              {(question.question_type === 'response_group' || !question.question_type) && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <Label>Response Set</Label>
                                    <Select
                                      value={question.response_group_id || (question.useCustomResponses ? 'custom' : 'select')}
                                      onValueChange={(value) => {
                                        if (value === 'custom') {
                                          updateQuestion(qIndex, 'response_group_id', '');
                                          updateQuestion(qIndex, 'useCustomResponses', true);
                                        } else if (value === 'select') {
                                          updateQuestion(qIndex, 'response_group_id', '');
                                          updateQuestion(qIndex, 'useCustomResponses', false);
                                        } else {
                                          updateQuestion(qIndex, 'response_group_id', value);
                                          updateQuestion(qIndex, 'useCustomResponses', false);
                                        }
                                      }}
                                    >
                                      <SelectTrigger data-testid={`question-response-group-${qIndex}`}>
                                        <SelectValue placeholder="Select or create custom" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="select">Select a response set...</SelectItem>
                                        <SelectItem value="custom">Use Custom Responses</SelectItem>
                                        {responseGroups.map(group => (
                                          <SelectItem key={group.id} value={group.id}>
                                            {group.name}
                                            {group.enable_scoring && ' (Scored)'}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  {(question.useCustomResponses || !question.response_group_id) && (
                                    <div className="flex items-center gap-2">
                                      <Switch
                                        checked={question.enable_scoring}
                                        onCheckedChange={(checked) => updateQuestion(qIndex, 'enable_scoring', checked)}
                                        id={`scoring-${qIndex}`}
                                      />
                                      <Label htmlFor={`scoring-${qIndex}`} className="text-sm">Enable Scoring</Label>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Text/Number/Alphanumeric Hint */}
                              {question.question_type === 'text' && (
                                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                  <p className="text-sm text-blue-700 dark:text-blue-300">
                                    Users will be able to enter free-form text for this question.
                                  </p>
                                </div>
                              )}
                              {question.question_type === 'number' && (
                                <div className="p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
                                  <p className="text-sm text-purple-700 dark:text-purple-300">
                                    Users will only be able to enter numeric values (e.g., temperature, count).
                                  </p>
                                </div>
                              )}
                              {question.question_type === 'alphanumeric' && (
                                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                                  <p className="text-sm text-amber-700 dark:text-amber-300">
                                    Users will be able to enter letters and numbers (e.g., batch codes, serial numbers).
                                  </p>
                                </div>
                              )}

                              {/* Custom Responses - Only show for response_group type */}
                              {(question.question_type === 'response_group' || !question.question_type) && (question.useCustomResponses || !question.response_group_id) && (
                                <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-sm">Custom Responses</Label>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => addCustomResponse(qIndex)}
                                    >
                                      <Plus className="w-3 h-3 mr-1" />
                                      Add
                                    </Button>
                                  </div>
                                  {question.custom_responses?.map((response, rIndex) => (
                                    <div key={rIndex} className="flex items-center gap-2">
                                      <Input
                                        placeholder="Label"
                                        value={response.label}
                                        onChange={(e) => updateCustomResponse(qIndex, rIndex, 'label', e.target.value)}
                                        className="flex-1"
                                      />
                                      <Button
                                        type="button"
                                        variant={response.is_negative ? "destructive" : "outline"}
                                        size="sm"
                                        className="min-w-[60px] text-xs"
                                        onClick={() => updateCustomResponse(qIndex, rIndex, 'is_negative', !response.is_negative)}
                                        data-testid={`response-passfail-${qIndex}-${rIndex}`}
                                      >
                                        {response.is_negative ? 'Fail' : 'Pass'}
                                      </Button>
                                      {question.enable_scoring && (
                                        <Input
                                          type="number"
                                          placeholder="Score (0-1)"
                                          value={response.score || ''}
                                          onChange={(e) => updateCustomResponse(qIndex, rIndex, 'score', e.target.value)}
                                          className="w-24"
                                          step="0.1"
                                          min="0"
                                          max="1"
                                        />
                                      )}
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeCustomResponse(qIndex, rIndex)}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeQuestion(qIndex)}
                              className="text-destructive hover:text-destructive"
                              data-testid={`delete-question-${qIndex}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Settings */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="sticky top-4">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-primary" />
                  <CardTitle className="text-lg">Settings</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="auditType">Audit Type</Label>
                  <Select value={auditTypeId || "none"} onValueChange={(val) => setAuditTypeId(val === "none" ? "" : val)}>
                    <SelectTrigger data-testid="audit-type-select">
                      <SelectValue placeholder="Select type (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="p-2">
                        <Input
                          placeholder="Search types..."
                          value={typeSearchTerm}
                          onChange={(e) => setTypeSearchTerm(e.target.value)}
                          className="mb-2"
                        />
                      </div>
                      <SelectItem value="none">No Type</SelectItem>
                      {filteredAuditTypes.map(type => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="passRate">Pass Rate (%)</Label>
                  <Input
                    id="passRate"
                    type="number"
                    placeholder="e.g., 85"
                    value={passRate}
                    onChange={(e) => setPassRate(e.target.value)}
                    min="0"
                    max="100"
                    data-testid="pass-rate-input"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum pass percentage - audits scoring below this will be flagged as failed
                  </p>
                </div>

                <Separator />

                <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                  <div>
                    <Label htmlFor="private">Make Private</Label>
                    <p className="text-xs text-muted-foreground">Only you can see this audit</p>
                  </div>
                  <Switch
                    id="private"
                    checked={isPrivate}
                    onCheckedChange={setIsPrivate}
                    data-testid="private-switch"
                  />
                </div>

                <Separator />

                <Button 
                  type="submit" 
                  className="w-full" 
                  size="lg"
                  disabled={loading}
                  data-testid="create-audit-submit"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {loading ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Audit' : 'Create Audit')}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
        )}
      </form>
    </div>
  );
};

export default CreateAudit;
