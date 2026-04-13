import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Separator } from '../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft, Play, Pencil, TrendingUp, ClipboardCheck, XCircle,
  Calendar as CalendarIcon, Eye, FileDown, Download, MessageSquare,
  Image, X, Filter, BarChart3
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const AuditOverview = () => {
  const { auditId } = useParams();
  const navigate = useNavigate();
  const { isAuditCreator } = useAuth();

  const [audit, setAudit] = useState(null);
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
  const [passFilter, setPassFilter] = useState('all');

  const [selectedRun, setSelectedRun] = useState(null);
  const [runDetails, setRunDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  useEffect(() => {
    fetchAuditRuns();
  }, [auditId, dateRange, passFilter]);

  const fetchAuditRuns = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateRange.from) params.append('date_from', dateRange.from.toISOString());
      if (dateRange.to) {
        const endOfDay = new Date(dateRange.to);
        endOfDay.setHours(23, 59, 59, 999);
        params.append('date_to', endOfDay.toISOString());
      }
      if (passFilter !== 'all') params.append('pass_status', passFilter);

      const response = await axios.get(`${API}/audits/${auditId}/runs?${params}`);
      setAudit(response.data.audit);
      setRuns(response.data.runs);
      setStats(response.data.stats);
    } catch (error) {
      toast.error('Failed to load audit data');
    } finally {
      setLoading(false);
    }
  };

  const openDetails = async (run) => {
    setSelectedRun(run);
    setDetailsLoading(true);
    try {
      const response = await axios.get(`${API}/run-audits/${run.id}/details`);
      setRunDetails(response.data);
    } catch (error) {
      toast.error('Failed to load audit details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const downloadPdf = async (runId, auditName) => {
    setDownloadingPdf(runId);
    try {
      const response = await axios.get(`${API}/run-audits/${runId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_report_${auditName?.replace(/\s+/g, '_')}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (error) {
      toast.error('Failed to download PDF');
    } finally {
      setDownloadingPdf(null);
    }
  };

  const formatUKDateTime = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London'
    });
  };

  const clearFilters = () => {
    setDateRange({ from: undefined, to: undefined });
    setPassFilter('all');
  };

  const hasActiveFilters = dateRange.from || dateRange.to || passFilter !== 'all';

  return (
    <div className="space-y-6" data-testid="audit-overview-page">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/run-audit')} data-testid="back-to-audits">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{audit?.name || 'Audit Overview'}</h1>
            <p className="text-muted-foreground mt-1">
              {audit?.description || 'View audit performance and completed runs'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAuditCreator() && (
            <Button variant="outline" onClick={() => navigate(`/create-audit/${auditId}`)} data-testid="edit-audit-btn">
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </Button>
          )}
          <Button onClick={() => navigate('/run-audit')} data-testid="run-audit-btn">
            <Play className="w-4 h-4 mr-2" />
            Run Audit
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="pass-percentage">
                  {loading ? '-' : `${stats?.pass_percentage || 0}%`}
                </p>
                <p className="text-sm text-muted-foreground">Pass Percentage</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <ClipboardCheck className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="total-completed">
                  {loading ? '-' : stats?.total_completed || 0}
                </p>
                <p className="text-sm text-muted-foreground">Audits Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="total-failed">
                  {loading ? '-' : stats?.failed || 0}
                </p>
                <p className="text-sm text-muted-foreground">Failed Audits</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="date-range-picker">
                  <CalendarIcon className="w-4 h-4" />
                  {dateRange.from ? (
                    dateRange.to
                      ? `${format(dateRange.from, 'dd/MM/yyyy')} - ${format(dateRange.to, 'dd/MM/yyyy')}`
                      : format(dateRange.from, 'dd/MM/yyyy')
                  ) : 'Select date range'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => setDateRange(range || { from: undefined, to: undefined })}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>

            <Select value={passFilter} onValueChange={setPassFilter}>
              <SelectTrigger className="w-[140px]" data-testid="pass-fail-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pass">Passed</SelectItem>
                <SelectItem value="fail">Failed</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="clear-filters">
                <X className="w-4 h-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Completed Runs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Completed Audit Runs ({runs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : runs.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Auditor</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Date & Time (UK)</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id} data-testid={`run-row-${run.id}`} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetails(run)}>
                      <TableCell className="font-medium">{run.auditor_name}</TableCell>
                      <TableCell className="text-muted-foreground">{run.location || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <CalendarIcon className="w-3 h-3" />
                          {formatUKDateTime(run.completed_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {run.total_score !== null ? (
                          <span className="font-semibold">{Math.round(run.total_score)}%</span>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {run.pass_status ? (
                          <Badge className={run.pass_status === 'pass' ? 'badge-pass' : 'badge-fail'}>
                            {run.pass_status === 'pass' ? 'Passed' : 'Failed'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Completed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openDetails(run); }} data-testid={`view-run-${run.id}`}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); downloadPdf(run.id, audit?.name); }} disabled={downloadingPdf === run.id} data-testid={`download-run-${run.id}`}>
                            {downloadingPdf === run.id ? (
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <FileDown className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
              <p className="text-muted-foreground mb-2">No completed audit runs found</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!selectedRun} onOpenChange={(open) => { if (!open) { setSelectedRun(null); setRunDetails(null); } }}>
        <DialogContent className="max-w-3xl w-[95vw] h-[90vh] sm:h-auto sm:max-h-[85vh] overflow-y-auto flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-8">
              <span>{audit?.name}</span>
              <div className="flex items-center gap-2">
                {selectedRun?.pass_status && (
                  <Badge className={selectedRun.pass_status === 'pass' ? 'badge-pass' : 'badge-fail'}>
                    {selectedRun.pass_status === 'pass' ? 'Passed' : 'Failed'}
                    {selectedRun.total_score !== null && ` - ${Math.round(selectedRun.total_score)}%`}
                  </Badge>
                )}
                <Button variant="outline" size="sm" onClick={() => downloadPdf(selectedRun?.id, audit?.name)} disabled={downloadingPdf === selectedRun?.id} data-testid="modal-download-pdf">
                  {downloadingPdf === selectedRun?.id ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  PDF
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>

          {detailsLoading ? (
            <div className="space-y-4 p-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          ) : runDetails ? (
            <div className="flex-1 overflow-y-auto pr-2">
              <div className="space-y-6 pb-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Auditor</p>
                    <p className="font-medium">{runDetails.auditor_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Location</p>
                    <p className="font-medium">{runDetails.location || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Started</p>
                    <p className="font-medium">{formatUKDateTime(runDetails.started_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Completed</p>
                    <p className="font-medium">{formatUKDateTime(runDetails.completed_at)}</p>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-4">
                    Questions & Responses ({runDetails.enriched_answers?.length || 0})
                  </h4>
                  <div className="space-y-4">
                    {runDetails.enriched_answers?.map((answer, index) => (
                      <Card key={answer.question_id} className={answer.is_negative || answer.pass_fail === 'fail' ? 'border-l-4 border-l-red-500' : ''}>
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="text-xs">Q{index + 1}</Badge>
                                {(answer.pass_fail || answer.is_negative !== undefined) && (
                                  <Badge className={
                                    (answer.pass_fail === 'fail' || answer.is_negative)
                                      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                                  }>
                                    {(answer.pass_fail === 'fail' || answer.is_negative) ? 'Fail' : 'Pass'}
                                  </Badge>
                                )}
                              </div>
                              <p className="font-medium mb-3">{answer.question_text}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Response:</span>
                                <Badge className={
                                  (answer.is_negative || answer.pass_fail === 'fail')
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                                }>
                                  {answer.response_label}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          {answer.notes && (
                            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                                <MessageSquare className="w-4 h-4" />Comment
                              </div>
                              <p className="text-sm">{answer.notes}</p>
                            </div>
                          )}
                          {answer.photos?.length > 0 && (
                            <div className="mt-4">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                <Image className="w-4 h-4" />Photos ({answer.photos.length})
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {answer.photos.map((photo, pIndex) => (
                                  <button key={pIndex} onClick={() => setPhotoPreview(photo)} className="w-16 h-16 rounded-lg overflow-hidden border hover:border-primary transition-colors">
                                    <img src={photo} alt={`Evidence ${pIndex + 1}`} className="w-full h-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {runDetails.signoff_name && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold text-muted-foreground mb-2">Sign Off</h4>
                      <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                        <p className="text-sm"><span className="font-medium">Signed by:</span> {runDetails.signoff_name}</p>
                        <p className="text-sm"><span className="font-medium">Email:</span> {runDetails.signoff_email}</p>
                        {runDetails.signature && (
                          <img src={runDetails.signature} alt="Signature" className="max-h-24 border rounded bg-white" />
                        )}
                      </div>
                    </div>
                  </>
                )}

                {runDetails.notes && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold text-muted-foreground mb-2">General Notes</h4>
                      <p className="text-sm p-3 bg-muted/50 rounded-lg">{runDetails.notes}</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Photo Preview */}
      <Dialog open={!!photoPreview} onOpenChange={() => setPhotoPreview(null)}>
        <DialogContent className="max-w-4xl p-0">
          <div className="relative">
            <button onClick={() => setPhotoPreview(null)} className="absolute top-2 right-2 z-10 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70">
              <X className="w-4 h-4" />
            </button>
            <img src={photoPreview} alt="Photo preview" className="w-full h-auto max-h-[80vh] object-contain" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AuditOverview;
