import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useOffline } from '../context/OfflineContext';
import { Button } from './ui/button';
import { 
  ClipboardList,
  ClipboardCheck,
  Package,
  Factory,
  Settings,
  Menu, 
  X, 
  LogOut, 
  Sun, 
  Moon,
  ChevronRight,
  WifiOff,
  RefreshCw,
  Cloud
} from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png";

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isOnline, pendingCount, isSyncing, triggerSync } = useOffline();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navSections = [
    {
      title: 'Traceability',
      items: [
        { path: '/traceability', label: 'Overview', icon: ClipboardList },
        { path: '/traceability#intake', label: 'Raw Material Intake', icon: Package },
        { path: '/traceability#finished', label: 'Finished Batches', icon: Factory },
        { path: '/traceability#usage', label: 'Material Usage', icon: ClipboardCheck },
        { path: '/traceability#reports', label: 'Reports', icon: ClipboardList },
        { path: '/traceability#config', label: 'Config', icon: Settings },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 glass border-b">
        <div className="flex items-center justify-between h-16 px-4">
          <button 
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            data-testid="mobile-menu-btn"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <img src={LOGO_URL} alt="Infinit-Audit" className="h-12" />
            {!isOnline && (
              <span className="flex items-center gap-1 text-xs bg-amber-500/20 text-amber-500 px-2 py-1 rounded-full">
                <WifiOff className="w-3 h-3" />
                Offline
              </span>
            )}
          </div>
          <button 
            onClick={toggleTheme}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            data-testid="theme-toggle-mobile"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-50"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full w-64 bg-card border-r z-50 
        transform transition-transform duration-300 ease-in-out
        lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="h-20 flex items-center justify-between px-4 border-b">
            <img src={LOGO_URL} alt="Infinit-Audit" className="h-14" />
            <button 
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 hover:bg-muted rounded-lg transition-colors"
              data-testid="close-sidebar-btn"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Offline Status Banner */}
          {!isOnline && (
            <div className="mx-4 mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 text-amber-500">
                <WifiOff className="w-4 h-4" />
                <span className="text-sm font-medium">Offline Mode</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Changes will sync when back online
              </p>
              {pendingCount > 0 && (
                <p className="text-xs text-amber-500 mt-1">
                  {pendingCount} item(s) pending sync
                </p>
              )}
            </div>
          )}
          
          {/* Online with pending items */}
          {isOnline && pendingCount > 0 && (
            <div className="mx-4 mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-blue-500">
                  <Cloud className="w-4 h-4" />
                  <span className="text-sm font-medium">{pendingCount} pending</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={triggerSync}
                  disabled={isSyncing}
                  className="h-7 px-2"
                  data-testid="sync-btn"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-6">
            {navSections.map(section => (
              <div key={section.title} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3">
                  {section.title}
                </p>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = location.pathname === item.path && !item.path.includes('#');
                    const hash = item.path.split('#')[1];
                    const isHashActive = hash && location.hash === `#${hash}`;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setSidebarOpen(false)}
                        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                        className={`
                          flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                          ${(isActive || isHashActive)
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }
                        `}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="font-medium">{item.label}</span>
                        {(isActive || isHashActive) && <ChevronRight className="w-4 h-4 ml-auto" />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* User Section */}
          <div className="p-4 border-t">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold">
                  {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role?.replace('_', ' ')}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={toggleTheme}
                className="flex-1 hidden lg:flex"
                data-testid="theme-toggle-desktop"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                {theme === 'dark' ? 'Light' : 'Dark'}
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleLogout}
                className="flex-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                data-testid="logout-btn"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 pt-16 lg:pt-0 min-h-screen">
        <div className="p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
