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
      const [runsRes, statsRes] = await Promise.all([
        axios.get(`${API}/run-audits?completed=true`),
        axios.get(`${API}/dashboard/stats`)
      ]);
      setRuns(runsRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
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
      console.error('Failed to fetch run details:', error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDetails = () => {
    setSelectedRun(null);
    setRunDetails(null);
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

      {/* Placeholder for Charts */}
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <BarChart3 className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h3 className="text-lg font-semibold mb-2">Analytics Coming Soon</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Detailed charts and trend analysis will be available in the next update. 
            For now, click on any audit below to view full details.
          </p>
        </CardContent>
      </Card>

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
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); openDetails(run); }}
                          data-testid={`view-details-${run.id}`}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-8">
              <span>{selectedRun?.audit_name}</span>
              {selectedRun?.pass_status && (
                <Badge className={selectedRun.pass_status === 'pass' ? 'badge-pass' : 'badge-fail'}>
                  {selectedRun.pass_status === 'pass' ? 'Passed' : 'Failed'}
                  {selectedRun.total_score !== null && ` - ${Math.round(selectedRun.total_score)}%`}
                </Badge>
              )}
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
            <ScrollArea className="flex-1 pr-4">
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
            </ScrollArea>
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
