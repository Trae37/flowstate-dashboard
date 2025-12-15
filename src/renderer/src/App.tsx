import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import TitleBar from './components/TitleBar';
import UpdateNotification from './components/UpdateNotification';
import Dashboard from './pages/Dashboard';
import ContextDetail from './pages/ContextDetail';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Onboarding from './pages/Onboarding';
import Archive from './pages/Archive';
import { useEffect } from 'react';

// Protected route component
function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 dark:from-[#1a1d35] dark:via-[#1e2542] dark:to-[#151829]">
        <div className="text-gray-900 dark:text-white">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check if onboarding is needed (but allow access to onboarding page)
  if (!user.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

// Public route (redirects to dashboard if already logged in)
function PublicRoute({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 dark:from-[#1a1d35] dark:via-[#1e2542] dark:to-[#151829]">
        <div className="text-gray-900 dark:text-white">Loading...</div>
      </div>
    );
  }

  if (user) {
    if (!user.onboarding_completed) {
      return <Navigate to="/onboarding" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return children;
}

function AppRoutes() {
  const location = useLocation();
  const { user } = useAuth();

  // Track page views
  useEffect(() => {
    if (user?.id) {
      const trackPageView = async () => {
        try {
          const { trackPageView } = await import('./utils/analytics');
          trackPageView(location.pathname);
        } catch (error) {
          // Analytics not available or disabled
        }
      };
      trackPageView();
    }
  }, [location.pathname, user?.id]);

  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/context/:id" element={<ProtectedRoute><ContextDetail /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/archive" element={<ProtectedRoute><Archive /></ProtectedRoute>} />
      <Route path="/archive/:date" element={<ProtectedRoute><Archive /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <HashRouter>
          <AuthProvider>
            <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 dark:from-[#0F172A] dark:via-[#1E293B] dark:to-[#0F172A] noise-bg">
              <TitleBar />
              <div className="flex-1">
                <AppRoutes />
              </div>
              <UpdateNotification />
            </div>
          </AuthProvider>
        </HashRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
