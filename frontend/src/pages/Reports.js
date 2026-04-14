import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { 
  BarChart3, ClipboardCheck, TrendingUp, Calendar, 
  Building2, Users, ChevronRight, FileText
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Reports = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [audits, setAudits] = useState([]);
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [companyDashboard, setCompanyDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const requests = [
        axios.get(`${API}/audits`),
        axios.get(`${API}/run-audits?completed=true`),
        axios.get(`${API}/dashboard/stats`)
      ];
      
      if (isAdmin()) {
        requests.push(axios.get(`${API}/companies`));
      }
      
      const responses = await Promise.all(requests);
      setAudits(responses[0].data);
      setRuns(responses[1].data);
      setStats(responses[2].data);
      
      if (isAdmin() && responses[3]) {
        setCompanies(responses[3].data);
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

  // Compute per-audit stats from runs
  const auditStats = audits.map(audit => {
    const auditRuns = runs.filter(r => r.audit_id === audit.id);
    const completed = auditRuns.length;
    const passed = auditRuns.filter(r => r.pass_status === 'pass').length;
    const failed = auditRuns.filter(r => r.pass_status === 'fail').length;
    const passRate = completed > 0 ? Math.round((passed / completed) * 100) : 0;
    const lastRun = auditRuns.length > 0 ? auditRuns[0]?.completed_at : null;

    return { ...audit, completed, passed, failed, passRate, lastRun };
  });

  const formatUKDate = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleDateString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: 'Europe/London'
    });
  };

  return (
    <div className="space-y-6" data-testid="reports-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">
          Select an audit to view detailed results, filter by date and pass/fail
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
                <p className="text-2xl font-bold" data-testid="total-completed">{loading ? '-' : stats?.completed_runs || 0}</p>
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
                <p className="text-2xl font-bold" data-testid="overall-pass-rate">{loading ? '-' : `${stats?.pass_rate || 0}%`}</p>
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
                <p className="text-2xl font-bold" data-testid="total-passed">{loading ? '-' : stats?.passed_runs || 0}</p>
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

      {/* Audit List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Audits ({auditStats.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-6 w-3/4 mb-4" />
                    <Skeleton className="h-4 w-1/2 mb-6" />
                    <div className="grid grid-cols-3 gap-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : auditStats.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {auditStats.map(audit => (
                <Card
                  key={audit.id}
                  className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
                  onClick={() => navigate(`/audits/${audit.id}`)}
                  data-testid={`audit-report-card-${audit.id}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base truncate">{audit.name}</CardTitle>
                        {audit.audit_type_name && (
                          <Badge variant="secondary" className="mt-1 text-xs">{audit.audit_type_name}</Badge>
                        )}
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
                    </div>
                    {audit.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{audit.description}</p>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-2 bg-muted/50 rounded-lg">
                        <p className="text-lg font-bold">{audit.completed}</p>
                        <p className="text-xs text-muted-foreground">Completed</p>
                      </div>
                      <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{audit.passRate}%</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-500">Pass Rate</p>
                      </div>
                      <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded-lg">
                        <p className="text-lg font-bold text-red-600 dark:text-red-400">{audit.failed}</p>
                        <p className="text-xs text-red-600 dark:text-red-500">Failed</p>
                      </div>
                    </div>
                    {audit.lastRun && (
                      <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Last run: {formatUKDate(audit.lastRun)}
                      </p>
                    )}
                    {audit.pass_rate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Pass threshold: {audit.pass_rate}%
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
              <p className="text-muted-foreground">No audits created yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;
