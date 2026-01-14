import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from './ui/button';
import { 
  LayoutDashboard, 
  Users, 
  FolderOpen, 
  FilePlus, 
  ClipboardCheck, 
  BarChart3, 
  Menu, 
  X, 
  LogOut, 
  Sun, 
  Moon,
  ChevronRight,
  Calendar
} from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png";

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, isAdmin, isAuditCreator } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { path: '/admin', label: 'Admin', icon: Users, show: isAdmin() },
    { path: '/groups', label: 'Groups', icon: FolderOpen, show: true },
    { path: '/create-audit', label: 'Create Audit', icon: FilePlus, show: isAuditCreator() },
    { path: '/schedule', label: 'Schedule', icon: Calendar, show: isAuditCreator() },
    { path: '/run-audit', label: 'Run Audit', icon: ClipboardCheck, show: true },
    { path: '/reports', label: 'Reports', icon: BarChart3, show: true },
  ];

  const filteredNav = navItems.filter(item => item.show);

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
          <img src={LOGO_URL} alt="Infinit-Audit" className="h-12" />
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
          <div className="h-16 flex items-center justify-between px-4 border-b">
          <img src={LOGO_URL} alt="Infinit-Audit" className="h-14" />
            <button 
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 hover:bg-muted rounded-lg transition-colors"
              data-testid="close-sidebar-btn"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-1">
            {filteredNav.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  data-testid={`nav-${item.path.slice(1)}`}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200
                    ${isActive 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }
                  `}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
                </Link>
              );
            })}
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
