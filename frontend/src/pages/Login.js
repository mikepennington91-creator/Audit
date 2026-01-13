import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { Sun, Moon, Eye, EyeOff } from 'lucide-react';

const LOGO_URL = "https://customer-assets.emergentagent.com/job_c2cdf81f-38d8-495b-bbbc-bf9142927afb/artifacts/pll87efh_ChatGPT%20Image%20Jan%2013%2C%202026%2C%2007_06_32%20AM.png";
const BG_URL = "https://images.unsplash.com/photo-1669216369040-6a0a910d5bfd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwyfHxmb29kJTIwcXVhbGl0eSUyMGluc3BlY3RvciUyMHRhYmxldHxlbnwwfHx8fDE3NjgzMzUyNTJ8MA&ixlib=rb-4.1.0&q=85";

const Login = () => {
  const [activeTab, setActiveTab] = useState('login');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Register form
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regRole, setRegRole] = useState('user');
  
  const { login, register } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(loginEmail, loginPassword);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(regEmail, regPassword, regName, regRole);
      toast.success('Account created successfully!');
      navigate('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${BG_URL})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-slate-900/80 to-teal-900/70" />
      
      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-3 rounded-full glass hover:bg-white/20 transition-colors z-10"
        data-testid="theme-toggle-login"
      >
        {theme === 'dark' ? <Sun className="w-5 h-5 text-white" /> : <Moon className="w-5 h-5 text-white" />}
      </button>

      {/* Login Card */}
      <Card className="relative w-full max-w-md glass border-white/20 animate-fadeIn">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <img src={LOGO_URL} alt="Infinit-Audit" className="h-16" />
          </div>
          <div>
            <CardTitle className="text-2xl text-white">Welcome</CardTitle>
            <CardDescription className="text-slate-300">
              Food safety auditing made simple
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-white/10">
              <TabsTrigger 
                value="login" 
                className="data-[state=active]:bg-primary data-[state=active]:text-white"
                data-testid="login-tab"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger 
                value="register"
                className="data-[state=active]:bg-primary data-[state=active]:text-white"
                data-testid="register-tab"
              >
                Register
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-slate-200">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400"
                    data-testid="login-email"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-slate-200">Password</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 pr-10"
                      data-testid="login-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={loading}
                  data-testid="login-submit"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>

                <p className="text-center text-sm text-slate-400 mt-4">
                  Demo: admin@infinit-audit.co.uk / admin123
                </p>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reg-name" className="text-slate-200">Full Name</Label>
                  <Input
                    id="reg-name"
                    type="text"
                    placeholder="John Doe"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400"
                    data-testid="register-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reg-email" className="text-slate-200">Email</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="you@example.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    required
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400"
                    data-testid="register-email"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="reg-password" className="text-slate-200">Password</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    placeholder="••••••••"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    required
                    minLength={6}
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400"
                    data-testid="register-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reg-role" className="text-slate-200">Role</Label>
                  <Select value={regRole} onValueChange={setRegRole}>
                    <SelectTrigger 
                      className="bg-white/10 border-white/20 text-white"
                      data-testid="register-role"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User (Run Audits & View Reports)</SelectItem>
                      <SelectItem value="audit_creator">Audit Creator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={loading}
                  data-testid="register-submit"
                >
                  {loading ? 'Creating account...' : 'Create Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
