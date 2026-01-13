import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { 
  ClipboardCheck, 
  FileCheck, 
  Users, 
  TrendingUp,
  ArrowRight,
  Plus,
  Play
} from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Dashboard = () => {
  const { user, isAdmin, isAuditCreator } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [statsRes, runsRes] = await Promise.all([
        axios.get(`${API}/dashboard/stats`),
        axios.get(`${API}/run-audits?completed=true`)
      ]);
      setStats(statsRes.data);
      setRecentRuns(runsRes.data.slice(0, 5));
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { 
      label: 'Total Audits', 
      value: stats?.total_audits || 0, 
      icon: FileCheck, 
      color: 'text-primary',
      bg: 'bg-primary/10'
    },
    { 
      label: 'Completed Runs', 
      value: stats?.completed_runs || 0, 
      icon: ClipboardCheck, 
      color: 'text-secondary',
      bg: 'bg-secondary/10'
    },
    { 
      label: 'Pass Rate', 
      value: `${stats?.pass_rate || 0}%`, 
      icon: TrendingUp, 
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-100 dark:bg-emerald-900/20'
    },
    { 
      label: 'Total Users', 
      value: stats?.total_users || 0, 
      icon: Users, 
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-100 dark:bg-amber-900/20',
      show: isAdmin()
    },
  ];

  return (
    <div className="space-y-8" data-testid="dashboard">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome back, {user?.name?.split(' ')[0]}
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's an overview of your audit activity
          </p>
        </div>
        <div className="flex gap-3">
          {isAuditCreator() && (
            <Button asChild data-testid="create-audit-btn">
              <Link to="/create-audit">
                <Plus className="w-4 h-4 mr-2" />
                Create Audit
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild data-testid="run-audit-btn">
            <Link to="/run-audit">
              <Play className="w-4 h-4 mr-2" />
              Run Audit
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.filter(s => s.show !== false).map((stat, index) => (
          <Card 
            key={stat.label} 
            className={`animate-fadeIn stagger-${index + 1}`}
            data-testid={`stat-${stat.label.toLowerCase().replace(' ', '-')}`}
          >
            <CardContent className="p-6">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ) : (
                <>
                  <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <p className="text-3xl font-bold">{stat.value}</p>
                  <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Completed Audits */}
        <Card className="animate-fadeIn stagger-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-semibold">Recent Audit Runs</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/reports">
                View All <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentRuns.length > 0 ? (
              <div className="space-y-4">
                {recentRuns.map((run) => (
                  <div 
                    key={run.id} 
                    className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    data-testid={`recent-run-${run.id}`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      run.pass_status === 'pass' 
                        ? 'bg-emerald-100 dark:bg-emerald-900/30' 
                        : run.pass_status === 'fail'
                        ? 'bg-red-100 dark:bg-red-900/30'
                        : 'bg-slate-100 dark:bg-slate-800'
                    }`}>
                      <ClipboardCheck className={`w-5 h-5 ${
                        run.pass_status === 'pass' 
                          ? 'text-emerald-600 dark:text-emerald-400' 
                          : run.pass_status === 'fail'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-600 dark:text-slate-400'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{run.audit_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {run.auditor_name} • {new Date(run.completed_at).toLocaleDateString()}
                      </p>
                    </div>
                    {run.total_score !== null && (
                      <div className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
                        run.pass_status === 'pass' ? 'badge-pass' : 'badge-fail'
                      }`}>
                        {Math.round(run.total_score)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ClipboardCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No completed audits yet</p>
                <Button variant="link" asChild className="mt-2">
                  <Link to="/run-audit">Run your first audit</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card className="animate-fadeIn stagger-5">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link 
              to="/run-audit"
              className="flex items-center gap-4 p-4 rounded-lg border hover:border-primary hover:bg-primary/5 transition-all group"
              data-testid="quick-run-audit"
            >
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Play className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-medium">Run an Audit</p>
                <p className="text-sm text-muted-foreground">Select and execute an audit template</p>
              </div>
              <ArrowRight className="w-5 h-5 ml-auto text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>

            {isAuditCreator() && (
              <Link 
                to="/create-audit"
                className="flex items-center gap-4 p-4 rounded-lg border hover:border-secondary hover:bg-secondary/5 transition-all group"
                data-testid="quick-create-audit"
              >
                <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center group-hover:bg-secondary/20 transition-colors">
                  <Plus className="w-6 h-6 text-secondary" />
                </div>
                <div>
                  <p className="font-medium">Create New Audit</p>
                  <p className="text-sm text-muted-foreground">Build a custom audit template</p>
                </div>
                <ArrowRight className="w-5 h-5 ml-auto text-muted-foreground group-hover:text-secondary transition-colors" />
              </Link>
            )}

            <Link 
              to="/groups"
              className="flex items-center gap-4 p-4 rounded-lg border hover:border-emerald-500 hover:bg-emerald-500/5 transition-all group"
              data-testid="quick-groups"
            >
              <div className="w-12 h-12 rounded-lg bg-emerald-100 dark:bg-emerald-900/20 flex items-center justify-center group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/30 transition-colors">
                <FileCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="font-medium">Manage Groups</p>
                <p className="text-sm text-muted-foreground">Response sets and audit types</p>
              </div>
              <ArrowRight className="w-5 h-5 ml-auto text-muted-foreground group-hover:text-emerald-500 transition-colors" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
