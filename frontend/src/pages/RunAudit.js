import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Skeleton } from '../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { toast } from 'sonner';
import { useOffline } from '../context/OfflineContext';
import { saveOfflineAudit, getCachedData, cacheData } from '../utils/offlineDB';
import { 
  Play, 
  ArrowLeft, 
  ArrowRight,
  Camera,
  X,
  Check,
  AlertCircle,
  ClipboardCheck,
  MapPin,
  Clock,
  Save,
  Send,
  Image as ImageIcon,
  WifiOff
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const RunAudit = () => {
  const navigate = useNavigate();
  const { runId } = useParams();
  const fileInputRef = useRef(null);
  const { isOnline, updatePendingCount } = useOffline();
  
  const [audits, setAudits] = useState([]);
  const [responseGroups, setResponseGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Active run state
  const [activeRun, setActiveRun] = useState(null);
  const [currentAudit, setCurrentAudit] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [currentPhotoQuestion, setCurrentPhotoQuestion] = useState(null);

  useEffect(() => {
    fetchData();
  }, [runId]);

  const fetchData = async () => {
    try {
      let auditsData, groupsData;
      
      if (isOnline) {
        const [auditsRes, groupsRes] = await Promise.all([
          axios.get(`${API}/audits`),
          axios.get(`${API}/response-groups`)
        ]);
        auditsData = auditsRes.data;
        groupsData = groupsRes.data;
        
        // Cache data for offline use
        await cacheData('audits', auditsData);
        await cacheData('responseGroups', groupsData);
      } else {
        // Load from cache when offline
        auditsData = await getCachedData('audits') || [];
        groupsData = await getCachedData('responseGroups') || [];
        
        if (auditsData.length === 0) {
          toast.warning('No cached data available. Connect to internet to load audits.');
        }
      }
      
      setAudits(auditsData);
      setResponseGroups(groupsData);
      
      if (runId && isOnline) {
        const runRes = await axios.get(`${API}/run-audits/${runId}`);
        setActiveRun(runRes.data);
        const audit = auditsData.find(a => a.id === runRes.data.audit_id);
        setCurrentAudit(audit);
        
        // Restore answers
        const savedAnswers = {};
        runRes.data.answers?.forEach(a => {
          savedAnswers[a.question_id] = a;
        });
        setAnswers(savedAnswers);
        setNotes(runRes.data.notes || '');
      }
    } catch (error) {
      // Try to load from cache on any error
      const cachedAudits = await getCachedData('audits');
      const cachedGroups = await getCachedData('responseGroups');
      
      if (cachedAudits) {
        setAudits(cachedAudits);
        setResponseGroups(cachedGroups || []);
        toast.info('Loaded cached data');
      } else {
        toast.error('Failed to load data');
      }
    } finally {
      setLoading(false);
    }
  };

  const startAudit = async (audit) => {
    if (isOnline) {
      try {
        const response = await axios.post(`${API}/run-audits`, {
          audit_id: audit.id,
          location: location || null
        });
        setActiveRun(response.data);
        setCurrentAudit(audit);
        setCurrentQuestionIndex(0);
        setAnswers({});
        navigate(`/run-audit/${response.data.id}`);
      } catch (error) {
        toast.error('Failed to start audit');
      }
    } else {
      // Start offline audit
      const offlineRun = {
        id: `offline_${Date.now()}`,
        audit_id: audit.id,
        location: location || null,
        started_at: new Date().toISOString(),
        status: 'in_progress',
        offline: true
      };
      setActiveRun(offlineRun);
      setCurrentAudit(audit);
      setCurrentQuestionIndex(0);
      setAnswers({});
      toast.info('Starting offline audit. It will sync when you\'re back online.');
    }
  };

  const getResponseOptions = (question) => {
    if (question.custom_responses?.length > 0) {
      return question.custom_responses;
    }
    if (question.response_group_id) {
      const group = responseGroups.find(g => g.id === question.response_group_id);
      return group?.options || [];
    }
    return [];
  };

  const isNegativeResponse = (option) => {
    // Check if option is explicitly marked as negative
    if (option.is_negative) return true;
    
    // Check common negative keywords
    const negativeKeywords = ['fail', 'no', 'reject', 'non-compliant', 'non compliant', 'unsatisfactory', 'poor', 'bad', 'n/a'];
    const label = option.label.toLowerCase();
    return negativeKeywords.some(keyword => label.includes(keyword));
  };

  const handleAnswer = (question, option) => {
    const isNegative = isNegativeResponse(option);
    setAnswers({
      ...answers,
      [question.id]: {
        question_id: question.id,
        response_value: option.value,
        response_label: option.label,
        score: option.score,
        notes: answers[question.id]?.notes || '',
        photos: answers[question.id]?.photos || [],
        is_negative: isNegative
      }
    });
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentPhotoQuestion) return;
    
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await axios.post(`${API}/upload-photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      const currentAnswer = answers[currentPhotoQuestion.id] || {
        question_id: currentPhotoQuestion.id,
        response_value: '',
        response_label: '',
        score: null,
        notes: '',
        photos: []
      };
      
      setAnswers({
        ...answers,
        [currentPhotoQuestion.id]: {
          ...currentAnswer,
          photos: [...(currentAnswer.photos || []), response.data.url]
        }
      });
      
      toast.success('Photo uploaded');
    } catch (error) {
      toast.error('Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
      setCurrentPhotoQuestion(null);
    }
  };

  const removePhoto = (questionId, photoIndex) => {
    const currentAnswer = answers[questionId];
    if (!currentAnswer) return;
    
    setAnswers({
      ...answers,
      [questionId]: {
        ...currentAnswer,
        photos: currentAnswer.photos.filter((_, i) => i !== photoIndex)
      }
    });
  };

  const addNoteToAnswer = (questionId, note) => {
    const currentAnswer = answers[questionId] || {
      question_id: questionId,
      response_value: '',
      response_label: '',
      score: null,
      notes: '',
      photos: []
    };
    
    setAnswers({
      ...answers,
      [questionId]: { ...currentAnswer, notes: note }
    });
  };

  const saveProgress = async () => {
    if (!activeRun) return;
    
    try {
      await axios.put(`${API}/run-audits/${activeRun.id}`, {
        answers: Object.values(answers),
        notes,
        completed: false
      });
      toast.success('Progress saved');
    } catch (error) {
      toast.error('Failed to save progress');
    }
  };

  const submitAudit = async () => {
    if (!activeRun || !currentAudit) return;
    
    // Check required questions
    const unanswered = currentAudit.questions.filter(q => 
      q.required && !answers[q.id]?.response_value
    );
    
    if (unanswered.length > 0) {
      toast.error(`Please answer all required questions (${unanswered.length} remaining)`);
      const firstUnanswered = currentAudit.questions.findIndex(q => 
        q.required && !answers[q.id]?.response_value
      );
      setCurrentQuestionIndex(firstUnanswered);
      return;
    }

    // Check for negative responses without comments
    const negativeWithoutComments = Object.values(answers).filter(
      a => a.is_negative && !a.notes?.trim()
    );
    
    if (negativeWithoutComments.length > 0) {
      toast.error(`Comments are required for all fail/negative responses. ${negativeWithoutComments.length} missing.`);
      // Find and navigate to the first negative response without comment
      const firstNegativeIdx = currentAudit.questions.findIndex(q => {
        const answer = answers[q.id];
        return answer?.is_negative && !answer?.notes?.trim();
      });
      if (firstNegativeIdx !== -1) {
        setCurrentQuestionIndex(firstNegativeIdx);
      }
      return;
    }
    
    setSubmitting(true);
    
    // Handle offline submission
    if (!isOnline || activeRun.offline) {
      try {
        const offlineAuditData = {
          audit_id: currentAudit.id,
          location: activeRun.location,
          answers: Object.values(answers),
          notes,
          started_at: activeRun.started_at,
          completed_at: new Date().toISOString(),
          data: {
            audit_id: currentAudit.id,
            location: activeRun.location,
            answers: Object.values(answers),
            notes
          }
        };
        
        await saveOfflineAudit(offlineAuditData);
        await updatePendingCount();
        
        toast.success('Audit saved offline! It will sync when you\'re back online.', {
          icon: <WifiOff className="w-4 h-4" />
        });
        navigate('/reports');
      } catch (error) {
        toast.error('Failed to save offline audit');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    
    // Online submission
    try {
      await axios.put(`${API}/run-audits/${activeRun.id}`, {
        answers: Object.values(answers),
        notes,
        completed: true
      });
      toast.success('Audit submitted successfully!');
      navigate('/reports');
    } catch (error) {
      // If online submission fails, save offline
      if (error.message === 'Network Error' || !navigator.onLine) {
        try {
          const offlineAuditData = {
            audit_id: currentAudit.id,
            run_id: activeRun.id,
            location: activeRun.location,
            answers: Object.values(answers),
            notes,
            data: {
              answers: Object.values(answers),
              notes,
              completed: true
            }
          };
          
          await saveOfflineAudit(offlineAuditData);
          await updatePendingCount();
          
          toast.success('Audit saved offline! It will sync when you\'re back online.');
          navigate('/reports');
        } catch (offlineError) {
          toast.error('Failed to save audit');
        }
      } else {
        toast.error(error.response?.data?.detail || 'Failed to submit audit');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const progress = currentAudit 
    ? (Object.keys(answers).filter(k => answers[k]?.response_value).length / currentAudit.questions.length) * 100
    : 0;

  // Audit Selection View
  if (!activeRun) {
    return (
      <div className="space-y-6" data-testid="run-audit-page">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Run Audit</h1>
          <p className="text-muted-foreground mt-1">
            Select an audit to begin
          </p>
        </div>

        {/* Offline Banner */}
        {!isOnline && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <WifiOff className="w-5 h-5 text-amber-500" />
              <div>
                <p className="font-medium text-amber-500">Offline Mode</p>
                <p className="text-sm text-muted-foreground">
                  You can still run audits. They will sync automatically when you&apos;re back online.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Location Input */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <MapPin className="w-5 h-5 text-muted-foreground" />
              <div className="flex-1">
                <Input
                  placeholder="Enter location (optional)"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  data-testid="location-input"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Audit List */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2 mb-4" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : audits.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {audits.map((audit) => (
              <Card key={audit.id} className="hover:border-primary transition-colors" data-testid={`audit-card-${audit.id}`}>
                <CardHeader>
                  <CardTitle className="text-lg">{audit.name}</CardTitle>
                  {audit.audit_type_name && (
                    <Badge variant="secondary">{audit.audit_type_name}</Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {audit.description || 'No description'}
                  </p>
                  <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                    <span>{audit.questions.length} questions</span>
                    {audit.pass_rate && (
                      <span>Pass rate: {audit.pass_rate}%</span>
                    )}
                  </div>
                  <Button 
                    className="w-full" 
                    onClick={() => startAudit(audit)}
                    data-testid={`start-audit-${audit.id}`}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Start Audit
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">No audits available</p>
              <Button variant="outline" onClick={() => navigate('/create-audit')}>
                Create Your First Audit
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Active Audit View
  const currentQuestion = currentAudit?.questions[currentQuestionIndex];
  const options = currentQuestion ? getResponseOptions(currentQuestion) : [];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : null;

  return (
    <div className="space-y-4" data-testid="active-audit">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/run-audit')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{currentAudit?.name}</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Started {new Date(activeRun.started_at).toLocaleTimeString()}
              {activeRun.location && (
                <>
                  <span>•</span>
                  <MapPin className="w-3 h-3" />
                  {activeRun.location}
                </>
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={saveProgress} data-testid="save-progress-btn">
          <Save className="w-4 h-4 mr-2" />
          Save
        </Button>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span>Question {currentQuestionIndex + 1} of {currentAudit?.questions.length}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </CardContent>
      </Card>

      {/* Current Question */}
      {currentQuestion && (
        <Card className="animate-fadeIn">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <Badge variant={currentQuestion.required ? 'default' : 'secondary'} className="mb-2">
                  {currentQuestion.required ? 'Required' : 'Optional'}
                </Badge>
                <CardTitle className="text-xl">{currentQuestion.text}</CardTitle>
              </div>
              <span className="text-sm text-muted-foreground">#{currentQuestionIndex + 1}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Response Options */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {options.map((option, i) => (
                <Button
                  key={i}
                  variant={currentAnswer?.response_value === option.value ? 'default' : 'outline'}
                  className={`h-auto py-4 px-3 flex flex-col items-center gap-1 ${
                    currentAnswer?.response_value === option.value 
                      ? option.label.toLowerCase().includes('pass') || option.label.toLowerCase().includes('yes') || option.label.toLowerCase().includes('accept')
                        ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600'
                        : option.label.toLowerCase().includes('fail') || option.label.toLowerCase().includes('no') || option.label.toLowerCase().includes('reject')
                        ? 'bg-red-600 hover:bg-red-700 border-red-600'
                        : ''
                      : ''
                  }`}
                  onClick={() => handleAnswer(currentQuestion, option)}
                  data-testid={`option-${option.value}`}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.score !== null && (
                    <span className="text-xs opacity-70">Score: {option.score}</span>
                  )}
                </Button>
              ))}
            </div>

            {/* Photo Upload */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Photos</Label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={fileInputRef}
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentPhotoQuestion(currentQuestion);
                    fileInputRef.current?.click();
                  }}
                  disabled={uploadingPhoto}
                  data-testid="add-photo-btn"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  {uploadingPhoto ? 'Uploading...' : 'Add Photo'}
                </Button>
              </div>
              
              {currentAnswer?.photos?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {currentAnswer.photos.map((photo, i) => (
                    <div key={i} className="relative group">
                      <img 
                        src={photo} 
                        alt={`Evidence ${i + 1}`}
                        className="w-20 h-20 object-cover rounded-lg"
                      />
                      <button
                        onClick={() => removePhoto(currentQuestion.id, i)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className={currentAnswer?.is_negative && !currentAnswer?.notes?.trim() ? 'text-destructive' : ''}>
                  {currentAnswer?.is_negative ? 'Comment (Required for negative response)' : 'Notes (Optional)'}
                  {currentAnswer?.is_negative && !currentAnswer?.notes?.trim() && (
                    <span className="ml-2 text-destructive">*</span>
                  )}
                </Label>
                {currentAnswer?.is_negative && (
                  <Badge variant="destructive" className="text-xs">
                    <AlertCircle className="w-3 h-3 mr-1" />
                    Comment Required
                  </Badge>
                )}
              </div>
              <Textarea
                placeholder={currentAnswer?.is_negative 
                  ? "Please explain why this item failed or did not pass..." 
                  : "Add any notes or observations..."}
                value={currentAnswer?.notes || ''}
                onChange={(e) => addNoteToAnswer(currentQuestion.id, e.target.value)}
                rows={currentAnswer?.is_negative ? 3 : 2}
                className={currentAnswer?.is_negative && !currentAnswer?.notes?.trim() 
                  ? 'border-destructive focus:ring-destructive' 
                  : ''}
                data-testid="question-notes"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
          disabled={currentQuestionIndex === 0}
          data-testid="prev-question-btn"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>

        {currentQuestionIndex === (currentAudit?.questions.length || 0) - 1 ? (
          <Button onClick={submitAudit} disabled={submitting} data-testid="submit-audit-btn">
            <Send className="w-4 h-4 mr-2" />
            {submitting ? 'Submitting...' : 'Submit Audit'}
          </Button>
        ) : (
          <Button
            onClick={() => setCurrentQuestionIndex(prev => Math.min((currentAudit?.questions.length || 1) - 1, prev + 1))}
            data-testid="next-question-btn"
          >
            Next
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        )}
      </div>

      {/* Question Overview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Questions Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {currentAudit?.questions.map((q, i) => {
              const answered = answers[q.id]?.response_value;
              return (
                <button
                  key={q.id}
                  onClick={() => setCurrentQuestionIndex(i)}
                  className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                    i === currentQuestionIndex
                      ? 'bg-primary text-primary-foreground'
                      : answered
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                  data-testid={`question-nav-${i}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Audit Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">General Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Add overall audit notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            data-testid="general-notes"
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default RunAudit;
