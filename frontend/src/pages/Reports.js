import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { BarChart3, ClipboardCheck, TrendingUp, Calendar, MapPin, Clock, Eye, MessageSquare, Image, X, Download, Building2, FileDown, Users } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Reports = () => {
  const { user, isAdmin } = useAuth();
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [companyDashboard, setCompanyDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [runDetails, setRunDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const requests = [
        axios.get(`${API}/run-audits?completed=true`),
        axios.get(`${API}/dashboard/stats`)
      ];
      
      if (isAdmin()) {
        requests.push(axios.get(`${API}/companies`));
      }
      
      const responses = await Promise.all(requests);
      setRuns(responses[0].data);
      setStats(responses[1].data);
      
      if (isAdmin() && responses[2]) {
        setCompanies(responses[2].data);
      }
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanyDashboard = async (companyId) => {
    if (!companyId || companyId === 'all') {
      setCompanyDashboard(null);
      return;
    }
    try {
      const response = await axios.get(`${API}/companies/${companyId}/dashboard`);
      setCompanyDashboard(response.data);
    } catch (error) {
      console.error('Failed to fetch company dashboard:', error);
    }
  };

  useEffect(() => {
    if (selectedCompany && selectedCompany !== 'all') {
      fetchCompanyDashboard(selectedCompany);
    } else {
      setCompanyDashboard(null);
    }
  }, [selectedCompany]);

  const openDetails = async (run) => {
    setSelectedRun(run);
    setDetailsLoading(true);
    try {
      const response = await axios.get(`${API}/run-audits/${run.id}/details`);
      setRunDetails(response.data);
    } catch (error) {
      console.error('Failed to fetch run details:', error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => {
    setSelectedRun(null);
    setRunDetails(null);
  };

  const downloadPdf = async (runId, auditName) => {
    setDownloadingPdf(runId);
    try {
      const response = await axios.get(`${API}/run-audits/${runId}/pdf`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_report_${auditName.replace(/\s+/g, '_')}.pdf`);
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
    const date = new Date(isoString);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London'
    });
  };

  const formatUKDate = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Europe/London'
    });
  };

  return (
    <div className="space-y-6" data-testid="reports-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">
          View completed audit results and analytics
        </p>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <ClipboardCheck className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{loading ? '-' : stats?.completed_runs || 0}</p>
                <p className="text-sm text-muted-foreground">Completed Audits</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{loading ? '-' : `${stats?.pass_rate || 0}%`}</p>
                <p className="text-sm text-muted-foreground">Overall Pass Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-secondary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{loading ? '-' : stats?.passed_runs || 0}</p>
                <p className="text-sm text-muted-foreground">Passed Audits</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Company Dashboard (Admin only) */}
      {isAdmin() && companies.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Company Analytics
              </CardTitle>
              <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                <SelectTrigger className="w-[200px]" data-testid="company-filter">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map(company => (
                    <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          {companyDashboard && (
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold">{companyDashboard.stats.total_users}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" />Users</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold">{companyDashboard.stats.completed_runs}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1"><ClipboardCheck className="w-3 h-3" />Completed</p>
                </div>
                <div className="p-4 bg-emerald-100 dark:bg-emerald-900/20 rounded-lg">
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{companyDashboard.stats.pass_rate}%</p>
                  <p className="text-sm text-emerald-600 dark:text-emerald-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" />Pass Rate</p>
                </div>
                <div className="p-4 bg-amber-100 dark:bg-amber-900/20 rounded-lg">
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{companyDashboard.stats.pending_schedules + companyDashboard.stats.overdue_schedules}</p>
                  <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center gap-1"><Calendar className="w-3 h-3" />Scheduled</p>
                </div>
              </div>
              
              {/* Monthly Trend */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Monthly Trend (Last 6 Months)</h4>
                <div className="flex items-end gap-2 h-32">
                  {companyDashboard.trends.map((trend, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div className="w-full bg-muted rounded-t relative" style={{ height: `${Math.max(trend.pass_rate, 5)}%` }}>
                        <div 
                          className="absolute bottom-0 left-0 right-0 bg-primary rounded-t transition-all"
                          style={{ height: `${trend.pass_rate}%` }}
                        />
                      </div>
                      <p className="text-xs mt-1 text-muted-foreground">{trend.month.split(' ')[0]}</p>
                      <p className="text-xs font-medium">{trend.pass_rate}%</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Completed Audits Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Completed Audits</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          ) : runs.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Audit</TableHead>
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
                    <TableRow 
                      key={run.id} 
                      data-testid={`report-row-${run.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDetails(run)}
                    >
                      <TableCell className="font-medium">{run.audit_name}</TableCell>
                      <TableCell>{run.auditor_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {run.location || '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatUKDateTime(run.completed_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {run.total_score !== null ? (
                          <span className="font-semibold">
                            {Math.round(run.total_score)}%
                          </span>
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
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); openDetails(run); }}
                            data-testid={`view-details-${run.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); downloadPdf(run.id, run.audit_name); }}
                            disabled={downloadingPdf === run.id}
                            data-testid={`download-pdf-${run.id}`}
                          >
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
              <p className="text-muted-foreground">No completed audits yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Modal */}
      <Dialog open={!!selectedRun} onOpenChange={(open) => !open && closeDetails()}>
        <DialogContent className="max-w-3xl w-[95vw] h-[90vh] sm:h-auto sm:max-h-[85vh] overflow-y-auto flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-8">
              <span>{selectedRun?.audit_name}</span>
              <div className="flex items-center gap-2">
                {selectedRun?.pass_status && (
                  <Badge className={selectedRun.pass_status === 'pass' ? 'badge-pass' : 'badge-fail'}>
                    {selectedRun.pass_status === 'pass' ? 'Passed' : 'Failed'}
                    {selectedRun.total_score !== null && ` - ${Math.round(selectedRun.total_score)}%`}
                  </Badge>
                )}
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => downloadPdf(selectedRun?.id, selectedRun?.audit_name)}
                  disabled={downloadingPdf === selectedRun?.id}
                  data-testid="modal-download-pdf"
                >
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
                {/* Meta Info */}
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
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Started (UK)</p>
                    <p className="font-medium">{formatUKDateTime(runDetails.started_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Completed (UK)</p>
                    <p className="font-medium">{formatUKDateTime(runDetails.completed_at)}</p>
                  </div>
                </div>

                {runDetails.audit_description && (
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-2">Audit Description</h4>
                    <p className="text-sm">{runDetails.audit_description}</p>
                  </div>
                )}

                <Separator />

                {/* Questions and Answers */}
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-4">
                    Questions & Responses ({runDetails.enriched_answers?.length || 0})
                  </h4>
                  <div className="space-y-4">
                    {runDetails.enriched_answers?.map((answer, index) => (
                      <Card key={answer.question_id} className={`${
                        answer.is_negative ? 'border-l-4 border-l-red-500' : ''
                      }`}>
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="text-xs">Q{index + 1}</Badge>
                                {answer.question_required && (
                                  <Badge variant="secondary" className="text-xs">Required</Badge>
                                )}
                              </div>
                              <p className="font-medium mb-3">{answer.question_text}</p>
                              
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Response:</span>
                                <Badge className={
                                  answer.is_negative 
                                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                                }>
                                  {answer.response_label}
                                </Badge>
                                {answer.score !== null && (
                                  <span className="text-sm text-muted-foreground ml-2">
                                    Score: {answer.score}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Notes/Comments */}
                          {answer.notes && (
                            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                                <MessageSquare className="w-4 h-4" />
                                Comment
                              </div>
                              <p className="text-sm">{answer.notes}</p>
                            </div>
                          )}

                          {/* Photos */}
                          {answer.photos?.length > 0 && (
                            <div className="mt-4">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                <Image className="w-4 h-4" />
                                Photos ({answer.photos.length})
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {answer.photos.map((photo, pIndex) => (
                                  <button
                                    key={pIndex}
                                    onClick={() => setPhotoPreview(photo)}
                                    className="w-16 h-16 rounded-lg overflow-hidden border hover:border-primary transition-colors"
                                  >
                                    <img 
                                      src={photo} 
                                      alt={`Evidence ${pIndex + 1}`}
                                      className="w-full h-full object-cover"
                                    />
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

                {/* General Notes */}
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

      {/* Photo Preview Modal */}
      <Dialog open={!!photoPreview} onOpenChange={() => setPhotoPreview(null)}>
        <DialogContent className="max-w-4xl p-0">
          <div className="relative">
            <button
              onClick={() => setPhotoPreview(null)}
              className="absolute top-2 right-2 z-10 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-black/70"
            >
              <X className="w-4 h-4" />
            </button>
            <img 
              src={photoPreview} 
              alt="Photo preview"
              className="w-full h-auto max-h-[80vh] object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reports;
