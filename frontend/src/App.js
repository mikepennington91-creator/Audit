import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { OfflineProvider } from "./context/OfflineContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Configuration from "./pages/Configuration";
import UserManagement from "./pages/UserManagement";
import CreateAudit from "./pages/CreateAudit";
import Schedule from "./pages/Schedule";
import RunAudit from "./pages/RunAudit";
import Reports from "./pages/Reports";
import Traceability from "./pages/Traceability";
import AuditOverview from "./pages/AuditOverview";
import DocumentList from "./pages/DocumentList";
import DocumentDesigner from "./pages/DocumentDesigner";
import DocumentFill from "./pages/DocumentFill";
import DocumentView from "./pages/DocumentView";

// Protected Route Component
const ProtectedRoute = ({ children, allowedRoles, feature }) => {
  const { user, loading, hasFeature } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (feature && !hasFeature(feature)) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return <Layout>{children}</Layout>;
};

// Public Route (redirects to dashboard if logged in)
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={
        <PublicRoute>
          <Login />
        </PublicRoute>
      } />
      
      {/* Protected Routes */}
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      } />
      
      <Route path="/user-management" element={
        <ProtectedRoute allowedRoles={['system_admin', 'company_admin', 'admin']}>
          <UserManagement />
        </ProtectedRoute>
      } />

      <Route path="/configuration" element={
        <ProtectedRoute allowedRoles={['system_admin', 'company_admin', 'admin']}>
          <Configuration />
        </ProtectedRoute>
      } />

      <Route path="/admin" element={<Navigate to="/configuration" replace />} />
      
      <Route path="/groups" element={<Navigate to="/configuration?tab=groups" replace />} />
      
      <Route path="/create-audit" element={
        <ProtectedRoute feature="audits" allowedRoles={['system_admin', 'company_admin', 'admin', 'audit_creator']}>
          <CreateAudit />
        </ProtectedRoute>
      } />
      
      <Route path="/create-audit/:auditId" element={
        <ProtectedRoute feature="audits" allowedRoles={['system_admin', 'company_admin', 'admin', 'audit_creator']}>
          <CreateAudit />
        </ProtectedRoute>
      } />
      
      <Route path="/schedule" element={
        <ProtectedRoute feature="audits" allowedRoles={['system_admin', 'company_admin', 'admin', 'audit_creator']}>
          <Schedule />
        </ProtectedRoute>
      } />
      
      <Route path="/audits/:auditId" element={
        <ProtectedRoute feature="audits">
          <AuditOverview />
        </ProtectedRoute>
      } />
      
      <Route path="/run-audit" element={
        <ProtectedRoute feature="audits">
          <RunAudit />
        </ProtectedRoute>
      } />
      
      <Route path="/run-audit/:runId" element={
        <ProtectedRoute feature="audits">
          <RunAudit />
        </ProtectedRoute>
      } />
      
      <Route path="/reports" element={
        <ProtectedRoute feature="audits">
          <Reports />
        </ProtectedRoute>
      } />
      
      <Route path="/traceability" element={
        <ProtectedRoute feature="traceability">
          <Traceability />
        </ProtectedRoute>
      } />
      
      <Route path="/documents" element={
        <ProtectedRoute feature="documents">
          <DocumentList />
        </ProtectedRoute>
      } />
      
      <Route path="/documents/design" element={
        <ProtectedRoute feature="documents" allowedRoles={['system_admin', 'company_admin', 'admin', 'audit_creator']}>
          <DocumentDesigner />
        </ProtectedRoute>
      } />
      
      <Route path="/documents/design/:templateId" element={
        <ProtectedRoute feature="documents" allowedRoles={['system_admin', 'company_admin', 'admin', 'audit_creator']}>
          <DocumentDesigner />
        </ProtectedRoute>
      } />
      
      <Route path="/documents/fill/:documentId" element={
        <ProtectedRoute feature="documents">
          <DocumentFill />
        </ProtectedRoute>
      } />
      
      <Route path="/documents/view/:documentId" element={
        <ProtectedRoute feature="documents">
          <DocumentView />
        </ProtectedRoute>
      } />
      
      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <OfflineProvider>
          <BrowserRouter>
            <AppRoutes />
            <Toaster position="top-right" richColors />
          </BrowserRouter>
        </OfflineProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
