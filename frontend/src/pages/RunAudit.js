import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import AuditPassRule from '../components/AuditPassRule';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Skeleton } from '../components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { useOffline } from '../context/OfflineContext';
import { useAuth } from '../context/AuthContext';
import { saveOfflineAudit, getCachedData, cacheData } from '../utils/offlineDB';
import { 
  Play, 
  ArrowLeft, 
  ArrowRight,
  Camera,
  X,
  AlertCircle,
  ClipboardCheck,
  Clock,
  Save,
  Send,
  WifiOff,
  Layers,
  Type,
  Hash,
  TextCursorInput,
  Pencil,
  CheckCircle2,
  XCircle,
  PenLine,
  BarChart3,
  UserCheck
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const localDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const RunAudit = () => {
  const navigate = useNavigate();
  const { runId } = useParams();
  const fileInputRef = useRef(null);
  const { isOnline, updatePendingCount } = useOffline();
  const { isAuditCreator, isAdmin, user } = useAuth();
  
  const [audits, setAudits] = useState([]);
  const [responseGroups, setResponseGroups] = useState([]);
  const [linesShifts, setLinesShifts] = useState([]);
  const [actionAssignees, setActionAssignees] = useState([]);
  const [savedRuns, setSavedRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exiting, setExiting] = useState(false);
  
  const [activeRun, setActiveRun] = useState(null);
  const [currentAudit, setCurrentAudit] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState('');
  const [selectedLineShift, setSelectedLineShift] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [currentPhotoQuestion, setCurrentPhotoQuestion] = useState(null);
  
  const [signature, setSignature] = useState(null);
  const signatureCanvasRef = useRef(null);
  const [isSignatureDrawing, setIsSignatureDrawing] = useState(false);

  useEffect(() => {
    fetchData();
  }, [runId]);

  useEffect(() => {
    if (activeRun) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentQuestionIndex]);

  const fetchData = async () => {
    try {
      let auditsData, groupsData, linesShiftsData, assigneesData;
      
      if (isOnline) {
        const [auditsRes, groupsRes, linesShiftsRes, assigneesRes, savedRunsRes] = await Promise.all([
          axios.get(`${API}/audits`),
          axios.get(`${API}/response-groups`),
          axios.get(`${API}/lines-shifts`),
          axios.get(`${API}/action-assignees`),
          axios.get(`${API}/run-audits?completed=false`)
        ]);
        auditsData = auditsRes.data;
        groupsData = groupsRes.data;
        linesShiftsData = linesShiftsRes.data;
        assigneesData = assigneesRes.data;
        setSavedRuns(savedRunsRes.data);
        
        await cacheData('audits', auditsData);
        await cacheData('responseGroups', groupsData);
        await cacheData('linesShifts', linesShiftsData);
        await cacheData('actionAssignees', assigneesData);
      } else {
        auditsData = await getCachedData('audits') || [];
        groupsData = await getCachedData('responseGroups') || [];
        linesShiftsData = await getCachedData('linesShifts') || [];
        assigneesData = await getCachedData('actionAssignees') || [];
        
        if (auditsData.length === 0) {
          toast.warning('No cached data available. Connect to internet to load audits.');
        }
      }
      
      setAudits(auditsData);
      setResponseGroups(groupsData);
      setLinesShifts(linesShiftsData);
      setActionAssignees(assigneesData);
      
      if (runId && isOnline) {
        const runRes = await axios.get(`${API}/run-audits/${runId}`);
        if (runRes.data.completed || runRes.data.closed_at) {
          toast.error(runRes.data.closed_at ? 'This audit was closed because it was not completed in time.' : 'This audit is already completed.');
          navigate(`/audits/${runRes.data.audit_id}`);
          return;
        }
        setActiveRun(runRes.data);
        const audit = auditsData.find(a => a.id === runRes.data.audit_id);
        setCurrentAudit(audit);
        
        const savedAnswers = {};
        runRes.data.answers?.forEach(a => {
          savedAnswers[a.question_id] = a;
        });
        setAnswers(savedAnswers);
        setNotes(runRes.data.notes || '');
        const firstUnanswered = audit?.questions?.findIndex(q => !savedAnswers[q.id]?.response_value) ?? -1;
        setCurrentQuestionIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
      }
    } catch (error) {
      const cachedAudits = await getCachedData('audits');
      const cachedGroups = await getCachedData('responseGroups');
      const cachedLinesShifts = await getCachedData('linesShifts');
      const cachedActionAssignees = await getCachedData('actionAssignees');
      
      if (cachedAudits) {
        setAudits(cachedAudits);
        setResponseGroups(cachedGroups || []);
        setLinesShifts(cachedLinesShifts || []);
        setActionAssignees(cachedActionAssignees || []);
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
          location: null,
          line_shift_id: selectedLineShift || null
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
      const selectedLine = linesShifts.find(l => l.id === selectedLineShift);
      const offlineRun = {
        id: `offline_${Date.now()}`,
        audit_id: audit.id,
        location: null,
        line_shift_id: selectedLineShift || null,
        line_shift_title: selectedLine?.title || null,
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
    if (question.response_group_id) {
      const group = responseGroups.find(g => g.id === question.response_group_id);
      return group?.options || [];
    }
    if (question.custom_responses?.length > 0) {
      return question.custom_responses;
    }
    return [];
  };

  const isNegativeResponse = (option) => {
    if (option.is_negative) return true;
    const negativeKeywords = ['fail', 'no', 'reject', 'non-compliant', 'non compliant', 'unsatisfactory', 'poor', 'bad', 'n/a'];
    const label = option.label.toLowerCase();
    return negativeKeywords.some(keyword => label.includes(keyword));
  };

  const handleAnswer = (question, option) => {
    const isNegative = isNegativeResponse(option);
    const existingAnswer = answers[question.id] || {};
    setAnswers({
      ...answers,
      [question.id]: {
        ...existingAnswer,
        question_id: question.id,
        response_value: option.value,
        response_label: option.label,
        score: option.score,
        notes: existingAnswer.notes || '',
        photos: existingAnswer.photos || [],
        is_negative: isNegative,
        pass_fail: isNegative ? 'fail' : 'pass',
        repeat_non_conformance: isNegative ? (existingAnswer.repeat_non_conformance || false) : false
      }
    });
  };

  const handleTextAnswer = (question, value) => {
    const existingAnswer = answers[question.id] || {};
    setAnswers({
      ...answers,
      [question.id]: {
        ...existingAnswer,
        question_id: question.id,
        response_value: value,
        response_label: value,
        score: null,
        notes: existingAnswer.notes || '',
        photos: existingAnswer.photos || [],
        is_negative: existingAnswer.pass_fail === 'fail',
        pass_fail: existingAnswer.pass_fail || null
      }
    });
  };

  const handlePassFail = (questionId, status) => {
    const currentAns = answers[questionId] || {
      question_id: questionId,
      response_value: '',
      response_label: '',
      score: null,
      notes: '',
      photos: [],
    };
    setAnswers({
      ...answers,
      [questionId]: {
        ...currentAns,
        pass_fail: status,
        is_negative: status === 'fail',
        repeat_non_conformance: status === 'fail' ? (currentAns.repeat_non_conformance || false) : false
      }
    });
  };

  const startSignatureDrawing = (e) => {
    e.preventDefault();
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = ((e.touches?.[0]?.clientX ?? e.clientX) - rect.left) * scaleX;
    const y = ((e.touches?.[0]?.clientY ?? e.clientY) - rect.top) * scaleY;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    setIsSignatureDrawing(true);
  };

  const drawSignature = (e) => {
    e.preventDefault();
    if (!isSignatureDrawing) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = ((e.touches?.[0]?.clientX ?? e.clientX) - rect.left) * scaleX;
    const y = ((e.touches?.[0]?.clientY ?? e.clientY) - rect.top) * scaleY;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopSignatureDrawing = () => {
    if (isSignatureDrawing) {
      setIsSignatureDrawing(false);
      const canvas = signatureCanvasRef.current;
      if (canvas) setSignature(canvas.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setSignature(null);
  };

  const compressAuditPhoto = (file) => new Promise((resolve) => {
    if (!file?.type?.startsWith('image/')) return resolve(file);
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      try {
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) return resolve(file);
          const baseName = (file.name || 'audit-photo').replace(/\.[^.]+$/, '');
          resolve(new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', 0.72);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    image.src = objectUrl;
  });

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !currentPhotoQuestion) return;
    const questionId = currentPhotoQuestion.id;
    e.target.value = '';
    setUploadingPhoto(true);
    try {
      const compressedFile = await compressAuditPhoto(file);
      const formData = new FormData();
      formData.append('file', compressedFile);
      const response = await axios.post(`${API}/upload-photo`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAnswers(prev => {
        const currentAnswer = prev[questionId] || { question_id: questionId, response_value: '', response_label: '', score: null, notes: '', photos: [] };
        return { ...prev, [questionId]: { ...currentAnswer, photos: [...(currentAnswer.photos || []), response.data.url] } };
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
      [questionId]: { ...currentAnswer, photos: currentAnswer.photos.filter((_, i) => i !== photoIndex) }
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
    setAnswers({ ...answers, [questionId]: { ...currentAnswer, notes: note } });
  };

  const updateActionField = (questionId, field, value) => {
    const currentAnswer = answers[questionId];
    if (!currentAnswer) return;
    setAnswers({ ...answers, [questionId]: { ...currentAnswer, [field]: value } });
  };

  const setActionOwner = (questionId, userId) => {
    const currentAnswer = answers[questionId];
    if (!currentAnswer) return;
    const selectedOwner = actionAssignees.find(assignee => assignee.id === userId);
    setAnswers({
      ...answers,
      [questionId]: {
        ...currentAnswer,
        action_assignee_type: 'user',
        assigned_user_id: userId,
        assigned_user_name: selectedOwner?.name || null,
        assigned_user_email: selectedOwner?.email || null,
        assigned_department: null,
      }
    });
  };

  const leaveActiveRun = () => {
    setActiveRun(null);
    setCurrentAudit(null);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setNotes('');
    setSignature(null);
    setSelectedLineShift('');
    navigate('/run-audit', { replace: true });
  };

  const cancelAudit = async () => {
    if (!activeRun || exiting) return;
    if (!activeRun.offline && activeRun.auditor_id !== user?.id && !isAdmin()) {
      await saveProgress(true);
      return;
    }
    const confirmed = window.confirm(
      'Cancel this audit? Any unsaved answers will be discarded. Use Save & Exit if you want to continue it later.'
    );
    if (!confirmed) return;

    setExiting(true);
    try {
      if (!activeRun.offline) {
        await axios.delete(`${API}/run-audits/${activeRun.id}`, {
          data: { reason: 'Cancelled by auditor' }
        });
      }
      toast.success('Audit cancelled');
      leaveActiveRun();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to cancel audit');
    } finally {
      setExiting(false);
    }
  };

  const saveProgress = async (exitAfterSave = false) => {
    if (!activeRun || exiting) return;
    if (!isOnline || activeRun.offline) {
      toast.info('Connect to the internet to save this audit as a resumable draft.');
      return;
    }
    setExiting(exitAfterSave);
    try {
      const saved = await axios.put(`${API}/run-audits/${activeRun.id}`, { expected_version: activeRun.version || 0, answers: Object.values(answers), notes, completed: false });
      setActiveRun(saved.data);
      toast.success(exitAfterSave ? 'Audit saved. You can continue it later.' : 'Progress saved');
      if (exitAfterSave) leaveActiveRun();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save progress');
    } finally {
      setExiting(false);
    }
  };

  const submitAudit = async () => {
    if (!activeRun || !currentAudit) return;
    const unanswered = currentAudit.questions.filter(q => q.required && !answers[q.id]?.response_value);
    if (unanswered.length > 0) {
      toast.error(`Please answer all required questions (${unanswered.length} remaining)`);
      const firstUnanswered = currentAudit.questions.findIndex(q => q.required && !answers[q.id]?.response_value);
      setCurrentQuestionIndex(firstUnanswered);
      return;
    }

    const negativeWithoutComments = Object.values(answers).filter(a => a.is_negative && !a.notes?.trim());
    if (negativeWithoutComments.length > 0) {
      toast.error(`Comments are required for all fail/negative responses. ${negativeWithoutComments.length} missing.`);
      const firstNegativeIdx = currentAudit.questions.findIndex(q => {
        const answer = answers[q.id];
        return answer?.is_negative && !answer?.notes?.trim();
      });
      if (firstNegativeIdx !== -1) setCurrentQuestionIndex(firstNegativeIdx);
      return;
    }

    const incompleteActions = Object.values(answers).filter(a =>
      a.is_negative && (!a.action_required?.trim() || !a.action_due_date || !a.assigned_user_id)
    );
    if (incompleteActions.length > 0) {
      toast.error(`Action required, registered action owner and due date must be completed for every non-conformance. ${incompleteActions.length} incomplete.`);
      const firstIncompleteIdx = currentAudit.questions.findIndex(q => incompleteActions.some(a => a.question_id === q.id));
      if (firstIncompleteIdx !== -1) setCurrentQuestionIndex(firstIncompleteIdx);
      return;
    }

    if (!signature) {
      toast.error('Please sign off the audit before submitting');
      return;
    }
    setSubmitting(true);
    
    if (!isOnline || activeRun.offline) {
      try {
        const offlineAuditData = {
          audit_id: currentAudit.id,
          run_id: activeRun.offline ? null : activeRun.id,
          location: activeRun.location,
          line_shift_id: activeRun.line_shift_id || null,
          answers: Object.values(answers),
          notes,
          started_at: activeRun.started_at,
          completed_at: new Date().toISOString(),
          data: {
            start: { audit_id: currentAudit.id, location: activeRun.location, line_shift_id: activeRun.line_shift_id || null },
            submission: { expected_version: activeRun.version || 0, answers: Object.values(answers), notes, completed: true, signature, signoff_name: user?.name, signoff_email: user?.email }
          }
        };
        await saveOfflineAudit(offlineAuditData);
        await updatePendingCount();
        toast.success('Audit saved offline! It will sync when you\'re back online.', { icon: <WifiOff className="w-4 h-4" /> });
        navigate('/reports');
      } catch (error) {
        toast.error('Failed to save offline audit');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    
    try {
      await axios.put(`${API}/run-audits/${activeRun.id}`, {
        expected_version: activeRun.version || 0,
        answers: Object.values(answers),
        notes,
        completed: true,
        signature,
        signoff_name: user?.name,
        signoff_email: user?.email
      });
      toast.success('Audit submitted successfully!');
      navigate('/reports');
    } catch (error) {
      if (error.message === 'Network Error' || !navigator.onLine) {
        try {
          const offlineAuditData = {
            audit_id: currentAudit.id,
            run_id: activeRun.id,
            location: activeRun.location,
            answers: Object.values(answers),
            notes,
            data: {
              start: { audit_id: currentAudit.id, location: activeRun.location, line_shift_id: activeRun.line_shift_id || null },
              submission: { expected_version: activeRun.version || 0, answers: Object.values(answers), notes, completed: true, signature, signoff_name: user?.name, signoff_email: user?.email }
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

  if (!activeRun) {
    return (
      <div className="space-y-6" data-testid="run-audit-page">
        <div><h1 className="text-3xl font-bold tracking-tight">Run Audit</h1><p className="text-muted-foreground mt-1">Select an audit to begin</p></div>

        {!isOnline && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <div className="flex items-center gap-3"><WifiOff className="w-5 h-5 text-amber-500" /><div><p className="font-medium text-amber-500">Offline Mode</p><p className="text-sm text-muted-foreground">You can still run audits. They will sync automatically when you&apos;re back online.</p></div></div>
          </div>
        )}

        {isOnline && savedRuns.length > 0 && (
          <Card className="border-primary/30">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Save className="w-5 h-5" />Open Audits</CardTitle><CardDescription>Continue any open audit in your company. Due Friday; unfinished audits close at the start of Monday.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {savedRuns.map(run => (
                <div key={run.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{run.audit_name}</p><p className="text-xs text-muted-foreground">Started by {run.auditor_name} • {new Date(run.started_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })} • Due {run.due_date?.split('-').reverse().join('/')}</p></div><Button onClick={() => navigate(`/run-audit/${run.id}`)} data-testid={`continue-audit-${run.id}`}><Play className="w-4 h-4 mr-2" />Continue Audit</Button></div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6 space-y-4">
            {linesShifts.length > 0 && (
              <div className="flex items-center gap-4"><Layers className="w-5 h-5 text-muted-foreground" /><div className="flex-1"><Select value={selectedLineShift || "none"} onValueChange={(value) => setSelectedLineShift(value === "none" ? "" : value)}><SelectTrigger data-testid="line-shift-select"><SelectValue placeholder="Select line/shift (optional)" /></SelectTrigger><SelectContent><SelectItem value="none">No Line/Shift</SelectItem>{linesShifts.map(line => <SelectItem key={line.id} value={line.id}>{line.title}</SelectItem>)}</SelectContent></Select></div></div>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[1, 2, 3].map(i => <Card key={i}><CardContent className="p-6"><Skeleton className="h-6 w-3/4 mb-2" /><Skeleton className="h-4 w-1/2 mb-4" /><Skeleton className="h-10 w-full" /></CardContent></Card>)}</div>
        ) : audits.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {audits.map((audit) => (
              <Card key={audit.id} className="hover:border-primary transition-colors" data-testid={`audit-card-${audit.id}`}>
                <CardHeader className="cursor-pointer" onClick={() => navigate(`/audits/${audit.id}`)}><div className="flex items-center justify-between"><CardTitle className="text-lg">{audit.name}</CardTitle><BarChart3 className="w-4 h-4 text-muted-foreground" /></div>{audit.audit_type_name && <Badge variant="secondary">{audit.audit_type_name}</Badge>}</CardHeader>
                <CardContent><p className="text-sm text-muted-foreground mb-4 line-clamp-2">{audit.description || 'No description'}</p><div className="flex items-center justify-between gap-3 text-sm text-muted-foreground mb-4"><span>{audit.questions.length} questions</span><AuditPassRule audit={audit} /></div><div className="flex items-center gap-2"><Button className="flex-1" onClick={() => startAudit(audit)} data-testid={`start-audit-${audit.id}`}><Play className="w-4 h-4 mr-2" />Start Audit</Button>{isAuditCreator() && <Button variant="outline" size="icon" onClick={() => navigate(`/create-audit/${audit.id}`)} data-testid={`edit-audit-${audit.id}`}><Pencil className="w-4 h-4" /></Button>}</div></CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed"><CardContent className="py-12 text-center"><ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" /><p className="text-muted-foreground mb-4">No audits available</p><Button variant="outline" onClick={() => navigate('/create-audit')}>Create Your First Audit</Button></CardContent></Card>
        )}
      </div>
    );
  }

  const currentQuestion = currentAudit?.questions[currentQuestionIndex];
  const options = currentQuestion ? getResponseOptions(currentQuestion) : [];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : null;
  const questionType = currentQuestion?.question_type || 'response_group';

  return (
    <div className="space-y-4" data-testid="active-audit">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={cancelAudit}
            disabled={exiting || submitting}
            aria-label={activeRun.auditor_id === user?.id || isAdmin() ? 'Cancel audit and go back' : 'Save audit and go back'}
            title="Go back"
            data-testid="cancel-audit-btn"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0"><h1 className="text-xl font-bold">{currentAudit?.name}</h1><p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap"><Clock className="w-3 h-3" />Started by {activeRun.auditor_name} at {new Date(activeRun.started_at).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false })}{activeRun.line_shift_title && <><span>•</span><Layers className="w-3 h-3" />{activeRun.line_shift_title}</>}</p></div>
        </div>
        <Button variant="outline" onClick={() => saveProgress(true)} disabled={exiting || submitting} data-testid="save-progress-btn"><Save className="w-4 h-4 mr-2" />{exiting ? 'Exiting...' : 'Save & Exit'}</Button>
      </div>

      <p className="text-sm text-muted-foreground">{activeRun.offline ? 'This offline audit will become available to colleagues once synced.' : <>Due Friday {activeRun.due_date?.split('-').reverse().join('/')}. Unfinished audits automatically close at the start of Monday.</>}</p>
      <Card><CardContent className="py-4"><div className="flex items-center justify-between text-sm mb-2"><span>Question {currentQuestionIndex + 1} of {currentAudit?.questions.length}</span><span>{Math.round(progress)}% complete</span></div><Progress value={progress} className="h-2" /></CardContent></Card>

      {currentQuestion && (
        <Card className="animate-fadeIn">
          <CardHeader>
            <div className="flex items-start justify-between"><div><div className="flex items-center gap-2 mb-2"><Badge variant={currentQuestion.required ? 'default' : 'secondary'}>{currentQuestion.required ? 'Required' : 'Optional'}</Badge>{questionType === 'text' && <Badge variant="outline" className="gap-1"><Type className="w-3 h-3" />Text</Badge>}{questionType === 'number' && <Badge variant="outline" className="gap-1"><Hash className="w-3 h-3" />Number</Badge>}{questionType === 'alphanumeric' && <Badge variant="outline" className="gap-1"><TextCursorInput className="w-3 h-3" />Alphanumeric</Badge>}</div><CardTitle className="text-xl">{currentQuestion.text}</CardTitle></div><span className="text-sm text-muted-foreground">#{currentQuestionIndex + 1}</span></div>
          </CardHeader>
          <CardContent className="space-y-6">
            {questionType === 'response_group' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {options.map((option, i) => (
                  <Button key={i} variant={currentAnswer?.response_value === option.value ? 'default' : 'outline'} className={`h-auto py-4 px-3 flex flex-col items-center gap-1 ${currentAnswer?.response_value === option.value ? option.label.toLowerCase().includes('pass') || option.label.toLowerCase().includes('yes') || option.label.toLowerCase().includes('accept') ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600' : option.label.toLowerCase().includes('fail') || option.label.toLowerCase().includes('no') || option.label.toLowerCase().includes('reject') ? 'bg-red-600 hover:bg-red-700 border-red-600' : '' : ''}`} onClick={() => handleAnswer(currentQuestion, option)} data-testid={`option-${option.value}`}><span className="font-medium">{option.label}</span>{option.score !== null && <span className="text-xs opacity-70">Score: {option.score}</span>}</Button>
                ))}
              </div>
            )}

            {questionType === 'text' && <div className="space-y-2"><Label>Your Answer</Label><Textarea placeholder="Enter your response..." value={currentAnswer?.response_value || ''} onChange={(e) => handleTextAnswer(currentQuestion, e.target.value)} rows={4} data-testid="text-answer-input" /></div>}
            {questionType === 'number' && <div className="space-y-2"><Label>Your Answer (Numbers only)</Label><Input type="number" placeholder="Enter a number..." value={currentAnswer?.response_value || ''} onChange={(e) => handleTextAnswer(currentQuestion, e.target.value)} data-testid="number-answer-input" className="text-lg" /></div>}
            {questionType === 'alphanumeric' && <div className="space-y-2"><Label>Your Answer (Letters & Numbers)</Label><Input placeholder="Enter value (e.g., batch code, serial number)..." value={currentAnswer?.response_value || ''} onChange={(e) => handleTextAnswer(currentQuestion, e.target.value.replace(/[^a-zA-Z0-9\s-]/g, ''))} data-testid="alphanumeric-answer-input" className="text-lg" /><p className="text-xs text-muted-foreground">Only letters, numbers, spaces, and hyphens are allowed</p></div>}

            {questionType !== 'response_group' && (
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg" data-testid="pass-fail-toggle"><Label className="text-sm font-medium">Assessment:</Label><div className="flex gap-2"><Button type="button" variant={currentAnswer?.pass_fail === 'pass' ? 'default' : 'outline'} size="sm" className={currentAnswer?.pass_fail === 'pass' ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white' : ''} onClick={() => handlePassFail(currentQuestion.id, 'pass')} data-testid="pass-btn"><CheckCircle2 className="w-4 h-4 mr-1" />Pass</Button><Button type="button" variant={currentAnswer?.pass_fail === 'fail' ? 'default' : 'outline'} size="sm" className={currentAnswer?.pass_fail === 'fail' ? 'bg-red-600 hover:bg-red-700 border-red-600 text-white' : ''} onClick={() => handlePassFail(currentQuestion.id, 'fail')} data-testid="fail-btn"><XCircle className="w-4 h-4 mr-1" />Fail</Button></div></div>
            )}

            {currentAnswer?.is_negative && (
              <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/20" data-testid="repeat-nc-toggle"><div><Label htmlFor={`repeat-nc-${currentQuestion.id}`}>Repeat Non-Conformance</Label><p className="text-xs text-muted-foreground">Counts this failure as 2 non-conformances.</p></div><input id={`repeat-nc-${currentQuestion.id}`} type="checkbox" className="h-5 w-5 accent-red-600" checked={!!currentAnswer.repeat_non_conformance} onChange={(e) => updateActionField(currentQuestion.id, 'repeat_non_conformance', e.target.checked)} /></div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Photos</Label><input type="file" accept="image/*" ref={fileInputRef} onChange={handlePhotoUpload} className="hidden" /><Button variant="outline" size="sm" onClick={() => { setCurrentPhotoQuestion(currentQuestion); fileInputRef.current?.click(); }} disabled={uploadingPhoto} data-testid="add-photo-btn"><Camera className="w-4 h-4 mr-2" />{uploadingPhoto ? 'Uploading...' : 'Add Photo'}</Button></div>
              {currentAnswer?.photos?.length > 0 && <div className="flex flex-wrap gap-2">{currentAnswer.photos.map((photo, i) => <div key={i} className="relative group"><img src={photo} alt={`Evidence ${i + 1}`} className="w-20 h-20 object-cover rounded-lg" /><button onClick={() => removePhoto(currentQuestion.id, i)} className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3" /></button></div>)}</div>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label className={currentAnswer?.is_negative && !currentAnswer?.notes?.trim() ? 'text-destructive' : ''}>{currentAnswer?.is_negative ? 'Comment (Required for negative response)' : 'Notes (Optional)'}{currentAnswer?.is_negative && !currentAnswer?.notes?.trim() && <span className="ml-2 text-destructive">*</span>}</Label>{currentAnswer?.is_negative && <Badge variant="destructive" className="text-xs"><AlertCircle className="w-3 h-3 mr-1" />Comment Required</Badge>}</div>
              <Textarea placeholder={currentAnswer?.is_negative ? "Please explain why this item failed or did not pass..." : "Add any notes or observations..."} value={currentAnswer?.notes || ''} onChange={(e) => addNoteToAnswer(currentQuestion.id, e.target.value)} rows={currentAnswer?.is_negative ? 3 : 2} className={currentAnswer?.is_negative && !currentAnswer?.notes?.trim() ? 'border-destructive focus:ring-destructive' : ''} data-testid="question-notes" />
            </div>

            {currentAnswer?.is_negative && (
              <div className="space-y-4 rounded-lg border border-red-200 bg-red-50/60 p-4 dark:border-red-900 dark:bg-red-950/20" data-testid="corrective-action-fields">
                <div><div className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-600" /><h3 className="font-semibold">Corrective Action</h3><Badge variant="destructive" className="text-xs">Required</Badge></div><p className="text-sm text-muted-foreground mt-1">Create the action and give it one accountable registered owner.</p></div>

                <div className="space-y-2"><Label htmlFor={`action-required-${currentQuestion.id}`}>Action Required *</Label><Textarea id={`action-required-${currentQuestion.id}`} placeholder="What needs to be done to correct or prevent this issue?" value={currentAnswer.action_required || ''} onChange={(e) => updateActionField(currentQuestion.id, 'action_required', e.target.value)} rows={3} data-testid="action-required" /></div>

                <div className="space-y-2">
                  <Label>Action Owner *</Label>
                  <Select value={currentAnswer.assigned_user_id || undefined} onValueChange={(value) => setActionOwner(currentQuestion.id, value)}>
                    <SelectTrigger data-testid="action-assigned-user"><SelectValue placeholder="Choose a registered user..." /></SelectTrigger>
                    <SelectContent>{actionAssignees.map((assignee) => <SelectItem key={assignee.id} value={assignee.id}>{assignee.name} ({assignee.email})</SelectItem>)}</SelectContent>
                  </Select>
                  {actionAssignees.length > 0 ? (
                    <p className="text-xs text-muted-foreground flex items-start gap-1.5"><UserCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />The owner will receive the assignment email and will be responsible for reviewing and signing off the action after completion.</p>
                  ) : (
                    <p className="text-xs text-destructive">No registered users are available from the cached/company user list. Connect to the internet or ask an administrator to add the required user before submitting this non-conformance.</p>
                  )}
                </div>

                <div className="space-y-2 sm:max-w-xs"><Label htmlFor={`action-due-${currentQuestion.id}`}>Due Date *</Label><Input id={`action-due-${currentQuestion.id}`} type="date" min={localDateInputValue()} value={currentAnswer.action_due_date || ''} onChange={(e) => updateActionField(currentQuestion.id, 'action_due_date', e.target.value)} data-testid="action-due-date" /></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))} disabled={currentQuestionIndex === 0} data-testid="prev-question-btn"><ArrowLeft className="w-4 h-4 mr-2" />Previous</Button>
        {currentQuestionIndex === (currentAudit?.questions.length || 0) - 1 ? <Button onClick={submitAudit} disabled={submitting} data-testid="submit-audit-btn"><Send className="w-4 h-4 mr-2" />{submitting ? 'Submitting...' : 'Submit Audit'}</Button> : <Button onClick={() => setCurrentQuestionIndex(prev => Math.min((currentAudit?.questions.length || 1) - 1, prev + 1))} data-testid="next-question-btn">Next<ArrowRight className="w-4 h-4 ml-2" /></Button>}
      </div>

      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Questions Overview</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-2">{currentAudit?.questions.map((q, i) => { const answer = answers[q.id]; const answered = answer?.response_value; const failed = answer?.is_negative || answer?.pass_fail === 'fail'; return <button key={q.id} onClick={() => setCurrentQuestionIndex(i)} className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${failed ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : i === currentQuestionIndex ? 'bg-primary text-primary-foreground' : answered ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`} data-testid={`question-nav-${i}`}>{i + 1}</button>; })}</div></CardContent></Card>

      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">General Notes</CardTitle></CardHeader><CardContent><Textarea placeholder="Add overall audit notes..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="general-notes" /></CardContent></Card>

      <Card>
        <CardHeader className="pb-2"><div className="flex items-center gap-2"><PenLine className="w-4 h-4 text-primary" /><CardTitle className="text-sm">Sign Off</CardTitle></div></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4"><div><Label className="text-xs text-muted-foreground">Name</Label><p className="text-sm font-medium" data-testid="signoff-name">{user?.name}</p></div><div><Label className="text-xs text-muted-foreground">Email</Label><p className="text-sm font-medium" data-testid="signoff-email">{user?.email}</p></div></div>
          <div className="space-y-2"><div className="flex items-center justify-between"><Label>Signature *</Label><Button type="button" variant="ghost" size="sm" onClick={clearSignature} data-testid="clear-signature-btn">Clear</Button></div><canvas ref={signatureCanvasRef} width={600} height={200} className="w-full border rounded-lg bg-white cursor-crosshair touch-none" style={{ maxHeight: '150px' }} onMouseDown={startSignatureDrawing} onMouseMove={drawSignature} onMouseUp={stopSignatureDrawing} onMouseLeave={stopSignatureDrawing} onTouchStart={startSignatureDrawing} onTouchMove={drawSignature} onTouchEnd={stopSignatureDrawing} data-testid="signature-canvas" />{!signature && <p className="text-xs text-muted-foreground">Draw your signature above to sign off the audit</p>}{signature && <p className="text-xs text-emerald-600">Signature captured</p>}</div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RunAudit;