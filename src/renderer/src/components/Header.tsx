import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface HeaderProps {
  onCapture: () => void;
  isCapturing?: boolean;
  autoSaveEnabled?: boolean;
  onAutoSaveToggle?: (enabled: boolean) => void;
}

function Header({
  onCapture,
  isCapturing = false,
  autoSaveEnabled = false,
  onAutoSaveToggle,
}: HeaderProps) {
  const [autoSave, setAutoSave] = useState(autoSaveEnabled);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { user, logout } = useAuth();

  // Sync with parent state
  useEffect(() => {
    setAutoSave(autoSaveEnabled);
  }, [autoSaveEnabled]);

  // Handle auto-save toggle
  const handleAutoSaveToggle = (enabled: boolean) => {
    setAutoSave(enabled);
    if (onAutoSaveToggle) {
      onAutoSaveToggle(enabled);
    }
  };

  return (
    <div className="border-b border-white/5 bg-transparent backdrop-blur-sm relative z-40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex justify-between items-center">
          <button
            data-tour="capture-button"
            onClick={onCapture}
            disabled={isCapturing}
            className="flex items-center gap-2.5 text-white hover:text-accent transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
              <span className={`material-symbols-outlined text-accent text-xl ${isCapturing ? 'animate-spin' : ''}`}>
                {isCapturing ? 'hourglass_empty' : 'radio_button_checked'}
              </span>
            </div>
            <span className="text-base font-semibold">{isCapturing ? 'Capturing...' : 'Capture Now'}</span>
          </button>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 text-slate-400" data-tour="auto-save">
              <span className="text-sm font-medium">Automatic Save</span>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={autoSave}
                  onChange={(e) => handleAutoSaveToggle(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-[#1E293B] after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-slate-600 after:bg-white after:transition-all peer-checked:bg-accent peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:ring-2 peer-focus:ring-accent/50"></div>
              </label>
            </div>
            <Link
              data-tour="settings"
              to="/settings"
              className="text-white/60 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5"
            >
              <span className="material-symbols-outlined">settings</span>
            </Link>
            
            {/* User Menu */}
            <div className="relative">
              <button
                data-tour="user-menu"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 text-white/60 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <span className="material-symbols-outlined text-sm">expand_more</span>
              </button>

              {showUserMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-[#1E293B] border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                    <div className="p-4 border-b border-white/5">
                      <p className="text-white font-semibold text-sm">{user?.email}</p>
                      {user?.username && (
                        <p className="text-slate-400 text-xs mt-1">@{user.username}</p>
                      )}
                    </div>
                    <div className="p-2">
                      <button
                        onClick={async () => {
                          setShowUserMenu(false);
                          await logout();
                        }}
                        className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2 text-sm"
                      >
                        <span className="material-symbols-outlined text-sm">logout</span>
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Header;
