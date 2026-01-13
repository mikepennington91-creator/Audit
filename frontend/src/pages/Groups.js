import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';
import { Plus, Trash2, FolderOpen, List, X, GripVertical } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Groups = () => {
  const { isAuditCreator } = useAuth();
  const [responseGroups, setResponseGroups] = useState([]);
  const [auditTypes, setAuditTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('responses');
  
  // Response Group Dialog
  const [responseDialogOpen, setResponseDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [enableScoring, setEnableScoring] = useState(false);
  const [options, setOptions] = useState([{ label: '', value: '', score: null, is_negative: false }]);
  
  // Audit Type Dialog
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [typeDescription, setTypeDescription] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [groupsRes, typesRes] = await Promise.all([
        axios.get(`${API}/response-groups`),
        axios.get(`${API}/audit-types`)
      ]);
      setResponseGroups(groupsRes.data);
      setAuditTypes(typesRes.data);
    } catch (error) {
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateResponseGroup = async (e) => {
    e.preventDefault();
    const validOptions = options.filter(o => o.label && o.value);
    if (validOptions.length < 2) {
      toast.error('At least 2 options are required');
      return;
    }
    
    try {
      await axios.post(`${API}/response-groups`, {
        name: groupName,
        options: validOptions.map(o => ({
          label: o.label,
          value: o.value.toLowerCase().replace(/\s+/g, '_'),
          score: enableScoring ? parseFloat(o.score) || 0 : null
        })),
        enable_scoring: enableScoring
      });
      toast.success('Response group created');
      setResponseDialogOpen(false);
      resetResponseForm();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create group');
    }
  };

  const handleCreateAuditType = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/audit-types`, {
        name: typeName,
        description: typeDescription || null
      });
      toast.success('Audit type created');
      setTypeDialogOpen(false);
      resetTypeForm();
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create type');
    }
  };

  const handleDeleteResponseGroup = async (id) => {
    if (!window.confirm('Delete this response group?')) return;
    try {
      await axios.delete(`${API}/response-groups/${id}`);
      toast.success('Response group deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete group');
    }
  };

  const handleDeleteAuditType = async (id) => {
    if (!window.confirm('Delete this audit type?')) return;
    try {
      await axios.delete(`${API}/audit-types/${id}`);
      toast.success('Audit type deleted');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete type');
    }
  };

  const addOption = () => {
    setOptions([...options, { label: '', value: '', score: null, is_negative: false }]);
  };

  const removeOption = (index) => {
    if (options.length > 1) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const updateOption = (index, field, value) => {
    const newOptions = [...options];
    newOptions[index][field] = value;
    if (field === 'label') {
      newOptions[index].value = value;
      // Auto-detect negative keywords
      const negativeKeywords = ['fail', 'no', 'reject', 'non-compliant', 'unsatisfactory', 'poor', 'bad'];
      newOptions[index].is_negative = negativeKeywords.some(kw => value.toLowerCase().includes(kw));
    }
    setOptions(newOptions);
  };

  const resetResponseForm = () => {
    setGroupName('');
    setEnableScoring(false);
    setOptions([{ label: '', value: '', score: null, is_negative: false }]);
  };

  const resetTypeForm = () => {
    setTypeName('');
    setTypeDescription('');
  };

  return (
    <div className="space-y-6" data-testid="groups-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Groups</h1>
        <p className="text-muted-foreground mt-1">
          Manage response sets and audit type categories
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="responses" data-testid="responses-tab">
            <List className="w-4 h-4 mr-2" />
            Response Sets
          </TabsTrigger>
          <TabsTrigger value="types" data-testid="types-tab">
            <FolderOpen className="w-4 h-4 mr-2" />
            Audit Types
          </TabsTrigger>
        </TabsList>

        {/* Response Sets Tab */}
        <TabsContent value="responses" className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">
              Create reusable response options like Pass/Fail, Yes/No, etc.
            </p>
            {isAuditCreator() && (
              <Dialog open={responseDialogOpen} onOpenChange={(open) => { setResponseDialogOpen(open); if (!open) resetResponseForm(); }}>
                <DialogTrigger asChild>
                  <Button data-testid="add-response-group-btn">
                    <Plus className="w-4 h-4 mr-2" />
                    New Response Set
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create Response Set</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreateResponseGroup} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="groupName">Set Name</Label>
                      <Input
                        id="groupName"
                        placeholder="e.g., Pass/Fail, Yes/No"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        required
                        data-testid="response-group-name"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                      <div>
                        <Label htmlFor="scoring">Enable Scoring</Label>
                        <p className="text-xs text-muted-foreground">Add score values to each option</p>
                      </div>
                      <Switch
                        id="scoring"
                        checked={enableScoring}
                        onCheckedChange={setEnableScoring}
                        data-testid="enable-scoring-switch"
                      />
                    </div>

                    <div className="space-y-3">
                      <Label>Options</Label>
                      {options.map((option, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <Input
                            placeholder="Label (e.g., Pass)"
                            value={option.label}
                            onChange={(e) => updateOption(index, 'label', e.target.value)}
                            className="flex-1"
                            data-testid={`option-label-${index}`}
                          />
                          {enableScoring && (
                            <Input
                              type="number"
                              placeholder="Score"
                              value={option.score || ''}
                              onChange={(e) => updateOption(index, 'score', e.target.value)}
                              className="w-20"
                              step="0.1"
                              min="0"
                              max="1"
                              data-testid={`option-score-${index}`}
                            />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeOption(index)}
                            disabled={options.length === 1}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={addOption}>
                        <Plus className="w-4 h-4 mr-1" />
                        Add Option
                      </Button>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setResponseDialogOpen(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button type="submit" className="flex-1" data-testid="save-response-group-btn">
                        Create Set
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-5 w-1/2 mb-4" />
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : responseGroups.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {responseGroups.map((group) => (
                <Card key={group.id} className="group" data-testid={`response-group-${group.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{group.name}</CardTitle>
                        {group.enable_scoring && (
                          <Badge variant="secondary" className="mt-1">Scoring Enabled</Badge>
                        )}
                      </div>
                      {isAuditCreator() && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteResponseGroup(group.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                          data-testid={`delete-response-group-${group.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-2">
                      {group.options.map((option, i) => (
                        <Badge key={i} variant="outline" className="font-normal">
                          {option.label}
                          {group.enable_scoring && option.score !== null && (
                            <span className="ml-1 text-muted-foreground">({option.score})</span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <List className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-4">No response sets created yet</p>
                {isAuditCreator() && (
                  <Button onClick={() => setResponseDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Set
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Audit Types Tab */}
        <TabsContent value="types" className="mt-6">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">
              Categorize your audits by type (e.g., GMP, HACCP, Food Safety)
            </p>
            {isAuditCreator() && (
              <Dialog open={typeDialogOpen} onOpenChange={(open) => { setTypeDialogOpen(open); if (!open) resetTypeForm(); }}>
                <DialogTrigger asChild>
                  <Button data-testid="add-audit-type-btn">
                    <Plus className="w-4 h-4 mr-2" />
                    New Audit Type
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Audit Type</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreateAuditType} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="typeName">Type Name</Label>
                      <Input
                        id="typeName"
                        placeholder="e.g., GMP, HACCP, Food Safety"
                        value={typeName}
                        onChange={(e) => setTypeName(e.target.value)}
                        required
                        data-testid="audit-type-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="typeDesc">Description (Optional)</Label>
                      <Textarea
                        id="typeDesc"
                        placeholder="Brief description of this audit type..."
                        value={typeDescription}
                        onChange={(e) => setTypeDescription(e.target.value)}
                        rows={3}
                        data-testid="audit-type-description"
                      />
                    </div>

                    <div className="flex gap-3 pt-4">
                      <Button type="button" variant="outline" onClick={() => setTypeDialogOpen(false)} className="flex-1">
                        Cancel
                      </Button>
                      <Button type="submit" className="flex-1" data-testid="save-audit-type-btn">
                        Create Type
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-5 w-1/2 mb-2" />
                    <Skeleton className="h-4 w-3/4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : auditTypes.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {auditTypes.map((type) => (
                <Card key={type.id} className="group" data-testid={`audit-type-${type.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{type.name}</CardTitle>
                      {isAuditCreator() && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteAuditType(type.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                          data-testid={`delete-audit-type-${type.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {type.description || 'No description'}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <FolderOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-4">No audit types created yet</p>
                {isAuditCreator() && (
                  <Button onClick={() => setTypeDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Type
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Groups;
