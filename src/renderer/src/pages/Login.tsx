import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);
      if (!result.success) {
        setError(result.error || 'Login failed');
      }
      // Navigation is handled by AuthContext after successful login
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 dark:from-[#1a1d35] dark:via-[#1e2542] dark:to-[#151829]">
      <div className="w-full max-w-md px-6">
        <div className="bg-white/80 dark:bg-[#1E293B]/80 backdrop-blur-sm rounded-2xl p-8 border border-gray-200 dark:border-white/10">
          <div className="flex justify-center mb-2">
            <img src="./assets/logo.png" alt="FlowState Logo" className="w-48 h-48 object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 text-center">Welcome Back</h1>
          <p className="text-gray-600 dark:text-slate-400 text-center mb-8">Log in to access your workspace captures.</p>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-gray-600 dark:text-slate-400">person</span>
                Email or Username
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 dark:bg-[#0F172A] text-gray-900 dark:text-white rounded-lg border border-gray-300 dark:border-white/10 focus:border-primary/50 focus:outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-gray-600 dark:text-slate-400">lock</span>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 bg-gray-50 dark:bg-[#0F172A] text-gray-900 dark:text-white rounded-lg border border-gray-300 dark:border-white/10 focus:border-primary/50 focus:outline-none transition-colors"
                  required
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
              <div className="text-right mt-2">
                <Link to="/forgot-password" className="text-sm text-gray-600 dark:text-slate-400 hover:text-primary transition-colors">
                  Forgot Password?
                </Link>
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
                  Logging in...
                </>
              ) : (
                'Login'
              )}
            </button>
          </form>

          <p className="text-center mt-6 text-gray-600 dark:text-slate-400 text-sm">
            Don't have an account?{' '}
            <Link to="/signup" className="text-primary hover:text-primary-hover transition-colors font-medium">
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
