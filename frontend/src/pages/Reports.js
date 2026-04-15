import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import { 
  BarChart3, ClipboardCheck, TrendingUp, Calendar, 
  ChevronRight, ArrowLeft, Trash2, FolderOpen, FileText, AlertTriangle
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Reports = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [auditTypes, setAuditTypes] = useState([]);
  const [audits, setAudits] = useState([]);
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Drill-down state
  const [selectedCategory, setSelectedCategory] = useState(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [typesRes, auditsRes, runsRes, statsRes] = await Promise.all([
        axios.get(`${API}/audit-types`),
        axios.get(`${API}/audits`),
        axios.get(`${API}/run-audits?completed=true`),
        axios.get(`${API}/dashboard/stats`)
      ]);
      setAuditTypes(typesRes.data);
      setAudits(auditsRes.data);
      setRuns(runsRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    } finally {
      setLoading(false);
    }
  };

  // Build categories with audit counts
  const categories = (() => {
    const catMap = {};

    // Start with all audit types
    auditTypes.forEach(t => {
      catMap[t.id] = { id: t.id, name: t.name, auditCount: 0 };
    });

    // Count audits per type
    audits.forEach(a => {
      const typeId = a.audit_type_id;
      if (typeId && catMap[typeId]) {
        catMap[typeId].auditCount++;
      } else if (typeId && !catMap[typeId]) {
        catMap[typeId] = { id: typeId, name: a.audit_type_name || 'Unknown', auditCount: 1 };
      }
    });

    // Check for uncategorized audits
    const uncategorized = audits.filter(a => !a.audit_type_id).length;
    const result = Object.values(catMap);
    if (uncategorized > 0) {
      result.push({ id: '__uncategorized__', name: 'Uncategorized', auditCount: uncategorized });
    }

    return result;
  })();

  // Audits filtered by selected category
  const filteredAudits = selectedCategory
    ? audits.filter(a =>
        selectedCategory.id === '__uncategorized__'
          ? !a.audit_type_id
          : a.audit_type_id === selectedCategory.id
      )
    : [];

  // Per-audit stats
  const getAuditStats = (audit) => {
    const auditRuns = runs.filter(r => r.audit_id === audit.id);
    const completed = auditRuns.length;
    const passed = auditRuns.filter(r => r.pass_status === 'pass').length;
    const failed = auditRuns.filter(r => r.pass_status === 'fail').length;
    const passRate = completed > 0 ? Math.round((passed / completed) * 100) : 0;
    const lastRun = auditRuns.length > 0 ? auditRuns[0]?.completed_at : null;
    return { completed, passed, failed, passRate, lastRun };
  };

  const handleDeleteAudit = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/audits/${deleteTarget.id}`);
      toast.success(`"${deleteTarget.name}" deleted`);
      setAudits(prev => prev.filter(a => a.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to delete audit');
    } finally {
      setDeleting(false);
    }
  };

  const formatUKDate = (isoString) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleDateString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/London'
    });
  };

  // ===== CATEGORY VIEW (Level 2: audits in category) =====
  if (selectedCategory) {
    return (
      <div className="space-y-6" data-testid="reports-audit-list">
        {/* Back + Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedCategory(null)} data-testid="back-to-categories">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{selectedCategory.name}</h1>
            <p className="text-muted-foreground mt-1">
              {filteredAudits.length} audit{filteredAudits.length !== 1 ? 's' : ''} in this category
            </p>
          </div>
        </div>

        {/* Audits Grid */}
        {filteredAudits.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAudits.map(audit => {
              const s = getAuditStats(audit);
              return (
                <Card
                  key={audit.id}
                  className="hover:border-primary hover:shadow-md transition-all group relative"
                  data-testid={`audit-card-${audit.id}`}
                >
                  <CardHeader className="pb-3 cursor-pointer" onClick={() => navigate(`/audits/${audit.id}`)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 pr-2">
                        <CardTitle className="text-base truncate">{audit.name}</CardTitle>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
                    </div>
                    {audit.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{audit.description}</p>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-3 gap-3 text-center cursor-pointer" onClick={() => navigate(`/audits/${audit.id}`)}>
                      <div className="p-2 bg-muted/50 rounded-lg">
                        <p className="text-lg font-bold">{s.completed}</p>
                        <p className="text-xs text-muted-foreground">Completed</p>
                      </div>
                      <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{s.passRate}%</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-500">Pass Rate</p>
                      </div>
                      <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded-lg">
                        <p className="text-lg font-bold text-red-600 dark:text-red-400">{s.failed}</p>
                        <p className="text-xs text-red-600 dark:text-red-500">Failed</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      {s.lastRun ? (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Last run: {formatUKDate(s.lastRun)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No runs yet</p>
                      )}

                      {isAdmin() && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(audit); }}
                          data-testid={`delete-audit-${audit.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
              <p className="text-muted-foreground">No audits in this category yet</p>
            </CardContent>
          </Card>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                Delete Audit
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will remove the audit template permanently. Completed audit runs will not be affected.
            </p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteAudit} disabled={deleting} data-testid="confirm-delete-audit">
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ===== CATEGORY LIST VIEW (Level 1: categories) =====
  return (
    <div className="space-y-6" data-testid="reports-page">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">
          Select a category to view audits and results
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

      {/* Category List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            Audit Categories
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          ) : categories.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map(cat => (
                <Card
                  key={cat.id}
                  className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
                  onClick={() => setSelectedCategory(cat)}
                  data-testid={`category-card-${cat.id}`}
                >
                  <CardContent className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold">{cat.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {cat.auditCount} audit{cat.auditCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-30" />
              <p className="text-muted-foreground">No audit categories created yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create audit types in the Groups page first</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;
