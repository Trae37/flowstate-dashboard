import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function Signup() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);
    try {
      const result = await signup(email, password, username || undefined);
      if (!result.success) {
        setError(result.error || 'Signup failed');
        
        // Track signup failure
        try {
          const { trackError } = await import('../utils/analytics');
          trackError('signup_failed', result.error || 'Unknown error');
        } catch (analyticsError) {
          // Don't fail if analytics fails
        }
      } else {
        // Track successful signup
        try {
          const { trackEvent } = await import('../utils/analytics');
          trackEvent('user_signed_up');
        } catch (analyticsError) {
          // Don't fail if analytics fails
        }
      }
      // Navigation is handled by AuthContext after successful signup
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      
      // Track signup error
      try {
        const { trackError } = await import('../utils/analytics');
        trackError('signup_error', err instanceof Error ? err.message : 'Unknown error');
      } catch (analyticsError) {
        // Don't fail if analytics fails
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 dark:from-[#0F172A] dark:via-[#1E293B] dark:to-[#0F172A]">
      <div className="w-full max-w-md px-6">
        <div className="bg-white/80 dark:bg-[#1E293B]/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 dark:border-white/10">
          <div className="flex justify-center">
            <img src="./assets/logo.png" alt="FlowState Logo" className="w-48 h-48 object-contain" />
          </div>

          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 text-center">Create your account</h1>
          <p className="text-gray-600 dark:text-slate-400 text-center mb-8">Start capturing your development context.</p>

          <form onSubmit={handleSignup} className="space-y-6">
          <div>
            <label className="block text-sm text-gray-700 dark:text-slate-300 mb-2">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1E293B] text-gray-900 dark:text-white rounded-lg border border-gray-300 dark:border-white/10 focus:border-primary/50 focus:outline-none transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 dark:text-slate-300 mb-2">Username (optional)</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-[#1E293B] text-gray-900 dark:text-white rounded-lg border border-gray-300 dark:border-white/10 focus:border-primary/50 focus:outline-none transition-colors"
              placeholder="Choose a username"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 dark:text-slate-300 mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 bg-gray-50 dark:bg-[#1E293B] text-gray-900 dark:text-white rounded-lg border border-gray-300 dark:border-white/10 focus:border-primary/50 focus:outline-none transition-colors"
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <span className="material-symbols-outlined text-xl">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Must be at least 8 characters</p>
          </div>

          <div>
            <label className="block text-sm text-gray-700 dark:text-slate-300 mb-2">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 bg-gray-50 dark:bg-[#1E293B] text-gray-900 dark:text-white rounded-lg border border-gray-300 dark:border-white/10 focus:border-primary/50 focus:outline-none transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors p-1"
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                <span className="material-symbols-outlined text-xl">
                  {showConfirmPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium border border-slate-600 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

          <p className="text-center mt-6 text-gray-600 dark:text-slate-400 text-sm">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:text-primary-hover transition-colors font-medium">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Signup;
