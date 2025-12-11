import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface User {
  id: number;
  email: string;
  username?: string;
  created_at: string;
  last_login?: string;
  onboarding_completed: boolean;
  feature_tour_completed: boolean;
}

interface AuthContextType {
  user: User | null;
  sessionToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, username?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  completeFeatureTour: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'flowstate_session_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Load session on mount
  useEffect(() => {
    loadSession();
  }, []);

  const loadSession = async () => {
    try {
      // Check if electronAPI is available
      if (!window.electronAPI || !window.electronAPI.authVerifySession) {
        console.warn('[AuthContext] electronAPI not available yet, skipping session load');
        setLoading(false);
        return;
      }

      const storedToken = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!storedToken) {
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.authVerifySession(storedToken);
      if (result.success && result.user) {
        // Ensure booleans are properly converted
        const user = {
          ...result.user,
          onboarding_completed: result.user.onboarding_completed === true || result.user.onboarding_completed === 1,
          feature_tour_completed: result.user.feature_tour_completed === true || result.user.feature_tour_completed === 1,
        };
        setUser(user);
        setSessionToken(storedToken);
        
        // Initialize analytics if enabled
        try {
          const settingsResult = await window.electronAPI.getSettings(user.id);
          if (settingsResult.success && settingsResult.data?.analyticsEnabled) {
            const { analytics } = await import('../utils/analytics');
            await analytics.initialize(user.id, {
              enabled: true,
              posthogApiKey: settingsResult.data.posthogApiKey,
              posthogHost: settingsResult.data.posthogHost,
            });
          }
        } catch (analyticsError) {
          // Don't fail session load if analytics fails
          console.warn('Failed to initialize analytics:', analyticsError);
        }
      } else {
        // Invalid session, clear it
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Error loading session:', error);
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.electronAPI.authLogin(email, password);
      if (result.success && result.session && result.user) {
        // Ensure booleans are properly converted
        const user = {
          ...result.user,
          onboarding_completed: result.user.onboarding_completed === true || result.user.onboarding_completed === 1,
          feature_tour_completed: result.user.feature_tour_completed === true || result.user.feature_tour_completed === 1,
        };
        setUser(user);
        setSessionToken(result.session.session_token);
        localStorage.setItem(SESSION_STORAGE_KEY, result.session.session_token);
        
        // Initialize analytics if enabled
        try {
          const settingsResult = await window.electronAPI.getSettings(user.id);
          if (settingsResult.success && settingsResult.data?.analyticsEnabled) {
            const { analytics } = await import('../utils/analytics');
            await analytics.initialize(user.id, {
              enabled: true,
              posthogApiKey: settingsResult.data.posthogApiKey,
              posthogHost: settingsResult.data.posthogHost,
            });
            analytics.track('user_logged_in');
          }
        } catch (analyticsError) {
          // Don't fail login if analytics fails
          console.warn('Failed to initialize analytics:', analyticsError);
        }
        
        return { success: true };
      } else {
        return { success: false, error: result.error || 'Login failed' };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Login failed' };
    }
  };

  const signup = async (email: string, password: string, username?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.electronAPI.authSignup(email, password, username);
      if (result.success && result.user) {
        // Ensure booleans are properly converted
        const user = {
          ...result.user,
          onboarding_completed: result.user.onboarding_completed === true || result.user.onboarding_completed === 1,
          feature_tour_completed: result.user.feature_tour_completed === true || result.user.feature_tour_completed === 1,
        };
        setUser(user);
        // Auto-login after signup
        const loginResult = await login(email, password);
        return loginResult;
      } else {
        return { success: false, error: result.error || 'Signup failed' };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Signup failed' };
    }
  };

  const logout = async () => {
    try {
      // Reset analytics before logout
      try {
        const { analytics } = await import('../utils/analytics');
        analytics.reset();
      } catch (analyticsError) {
        // Don't fail logout if analytics fails
        console.warn('Failed to reset analytics:', analyticsError);
      }
      
      if (sessionToken) {
        await window.electronAPI.authLogout(sessionToken);
      }
    } catch (error) {
      console.error('Error logging out:', error);
    } finally {
      setUser(null);
      setSessionToken(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      navigate('/login');
    }
  };

  const completeOnboarding = async () => {
    if (!user) return;
    try {
      const result = await window.electronAPI.authCompleteOnboarding(user.id);
      if (result.success) {
        // Ensure feature_tour_completed is preserved when updating onboarding
        setUser({ 
          ...user, 
          onboarding_completed: true,
          feature_tour_completed: user.feature_tour_completed || false,
        });
        console.log('[AuthContext] Onboarding completed, user updated:', {
          onboarding_completed: true,
          feature_tour_completed: user.feature_tour_completed || false,
        });
      }
    } catch (error) {
      console.error('Error completing onboarding:', error);
    }
  };

  const completeFeatureTour = async () => {
    if (!user) return;
    try {
      const result = await window.electronAPI.authCompleteFeatureTour(user.id);
      if (result.success) {
        setUser({ ...user, feature_tour_completed: true });
        // Also mark in sessionStorage immediately to prevent any race conditions
        sessionStorage.setItem('feature_tour_completed', 'true');
      }
    } catch (error) {
      console.error('Error completing feature tour:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, sessionToken, loading, login, signup, logout, completeOnboarding, completeFeatureTour }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

