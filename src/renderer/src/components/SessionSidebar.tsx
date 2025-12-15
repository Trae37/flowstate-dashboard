import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { formatTimeOnly, formatDateOnly } from '../utils/dateUtils';

/**
 * Get the local calendar date key (YYYY-MM-DD) from a date string
 * 
 * IMPORTANT: SQLite's datetime('now') returns UTC time.
 * We need to parse it as UTC, then convert to local time to get the correct calendar date.
 * 
 * Example:
 * - Session created at 11 PM EST on Nov 25 (local time)
 * - SQLite stores: "2025-11-26 04:00:00" (UTC - 4 hours ahead of EST)
 * - We parse as UTC, convert to local: Nov 25 11 PM EST
 * - Result: "2025-11-25" (correct local calendar date)
 */
function getLocalDateKey(dateString: string): string {
  try {
    if (!dateString || typeof dateString !== 'string') {
      console.warn('[SessionSidebar] Invalid dateString:', dateString);
      return 'Invalid date';
    }
    
    // SQLite format: "YYYY-MM-DD HH:MM:SS" (stored in UTC)
    // We need to parse it as UTC and then get the local date
    let date: Date;
    
    // Check if it's already in ISO format with timezone (has Z, +, or - after the time)
    const hasTimezone = dateString.includes('Z') || 
                        dateString.match(/[+-]\d{2}:?\d{2}$/) !== null;
    
    if (hasTimezone) {
      // Already has timezone info, parse directly
      date = new Date(dateString);
    } else {
      // SQLite format without timezone - treat as UTC by appending 'Z'
      // Replace space with 'T' for ISO format, then add 'Z' for UTC
      const utcString = dateString.replace(' ', 'T') + 'Z';
      date = new Date(utcString);
    }
    
    if (isNaN(date.getTime())) {
      console.warn('[SessionSidebar] Could not parse date string:', dateString);
      return 'Invalid date';
    }
    
    // CRITICAL: Use LOCAL date components (getFullYear, getMonth, getDate)
    // These return the date in the user's local timezone after UTC conversion
    // Example: "2025-11-26 00:10:47" (UTC) -> parsed as UTC -> converted to local
    // If user is in EST (UTC-5), this becomes Nov 25 7:10 PM EST -> grouped under Nov 25
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;
    
    // Debug logging to help diagnose
    console.log(`[SessionSidebar] Date conversion: "${dateString}" (UTC) -> "${dateKey}" (local)`);
    
    return dateKey;
  } catch (error) {
    console.error('[SessionSidebar] Error getting local date key:', error, 'from:', dateString);
    return 'Invalid date';
  }
}

/**
 * Format a date key (YYYY-MM-DD) to display format (e.g., "November 25, 2025")
 */
function formatDateKeyToDisplay(dateKey: string): string {
  try {
    // Handle "Invalid date" case
    if (dateKey === 'Invalid date') {
      return 'Invalid date';
    }
    
    // Parse YYYY-MM-DD format
    const parts = dateKey.split('-');
    if (parts.length !== 3) {
      console.warn('[SessionSidebar] Invalid date key format:', dateKey);
      return dateKey;
    }
    
    const [year, month, day] = parts.map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      console.warn('[SessionSidebar] Invalid date key numbers:', dateKey);
      return dateKey;
    }
    
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) {
      console.warn('[SessionSidebar] Invalid date created from key:', dateKey);
      return dateKey;
    }
    
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (error) {
    console.error('[SessionSidebar] Error formatting date key:', error, 'key:', dateKey);
    return dateKey;
  }
}

interface WorkSession {
  id: number;
  user_id: number;
  name: string;
  description?: string;
  created_at: string;
  archived: boolean;
  archived_at?: string;
  auto_recovered: boolean;
  capture_count?: number;
}

interface SessionSidebarProps {
  currentSessionId: number | null;
  onSessionChange: (sessionId: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSessionArchive?: () => void;
  onSessionDelete?: () => void;
}

function SessionSidebar({
  currentSessionId,
  onSessionChange,
  isCollapsed,
  onToggleCollapse,
  onSessionArchive,
  onSessionDelete,
}: SessionSidebarProps) {
  // Removed console.log to prevent performance issues
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionDescription, setNewSessionDescription] = useState('');
  const isArchiveView = location.pathname === '/archive';
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [showSessionMenu, setShowSessionMenu] = useState<number | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [groupedData, setGroupedData] = useState<{ groups: { [key: string]: WorkSession[] }, sortedKeys: string[] } | null>(null);
  const [userTimezone, setUserTimezone] = useState<string>(() => {
    // Get default timezone from browser
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  });

  useEffect(() => {
    if (user?.id) {
      loadSessions();
      loadUserTimezone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // loadSessions is stable, no need to include it

  const loadUserTimezone = async () => {
    if (!user?.id) return;
    try {
      const result = await window.electronAPI.getSettings(user.id);
      if (result.success && result.data?.timezone) {
        setUserTimezone(result.data.timezone);
      } else {
        // Use browser's detected timezone if no setting found
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setUserTimezone(browserTz);
      }
    } catch (error) {
      console.warn('[SessionSidebar] Failed to load timezone setting:', error);
      // Use browser's detected timezone on error
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setUserTimezone(browserTz);
    }
  };

  const loadSessions = async () => {
    if (!user?.id) return;
    
    // Check if session methods are available
    if (!window.electronAPI.sessionGetAll) {
      console.warn('[SessionSidebar] Session methods not available yet. Please restart the app.');
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const result = await window.electronAPI.sessionGetAll(user.id, false);
      if (result.success && result.data) {
        setSessions(result.data);
      }
    } catch (error) {
      console.error('[SessionSidebar] Error loading sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async () => {
    if (!user?.id) return;

    // Check if session methods are available
    if (!window.electronAPI.sessionCreate) {
      console.warn('[SessionSidebar] Session methods not available yet. Please restart the app.');
      return;
    }

    try {
      const result = await window.electronAPI.sessionCreate(
        user.id,
        newSessionName || undefined,
        newSessionDescription || undefined
      );
      
      if (result.success && result.data) {
        await loadSessions();
        onSessionChange(result.data.id);
        setShowCreateModal(false);
        setNewSessionName('');
        setNewSessionDescription('');
        
        // Track session creation
        try {
          const { trackEvent } = await import('../utils/analytics');
          trackEvent('session_created', { session_id: result.data.id });
        } catch (analyticsError) {
          // Don't fail if analytics fails
        }
      }
    } catch (error) {
      console.error('[SessionSidebar] Error creating session:', error);
    }
  };

  const handleSessionClick = (sessionId: number) => {
    if (sessionId !== currentSessionId) {
      onSessionChange(sessionId);
    }
  };

  const handleArchiveSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isArchiving) return;

    setIsArchiving(true);
    try {
      const result = await window.electronAPI.sessionArchive(sessionId);
      if (result.success) {
        onSessionArchive?.();
        await loadSessions();
      } else {
        alert(`Failed to archive session: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to archive session:', error);
      alert('Failed to archive session');
    } finally {
      setIsArchiving(false);
      setShowSessionMenu(null);
    }
  };

  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;

    if (!confirm('Are you sure you want to delete this session? This will delete all captures and assets in this session. This action cannot be undone.')) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await window.electronAPI.sessionDelete(sessionId);
      if (result.success) {
        onSessionDelete?.();
        await loadSessions();
        // If we deleted the current session, switch to the first available session
        if (sessionId === currentSessionId) {
          const updatedSessions = await window.electronAPI.sessionGetAll(user?.id || 0, false);
          if (updatedSessions.success && updatedSessions.data && updatedSessions.data.length > 0) {
            onSessionChange(updatedSessions.data[0].id);
          }
        }
      } else {
        alert(`Failed to delete session: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('Failed to delete session');
    } finally {
      setIsDeleting(false);
      setShowSessionMenu(null);
    }
  };

  // Group sessions by their creation date only (using local calendar date)
  const groupSessionsByDate = (sessions: WorkSession[]) => {
    const groups: { [key: string]: WorkSession[] } = {};
    
    // Group each session by its local calendar date (YYYY-MM-DD)
    sessions.forEach(session => {
      if (!session.created_at) {
        console.warn('[SessionSidebar] Session missing created_at:', session);
        return;
      }
      
      const dateKey = getLocalDateKey(session.created_at);
      
      // Skip invalid dates
      if (dateKey === 'Invalid date') {
        console.warn('[SessionSidebar] Skipping session with invalid date:', session.id, session.created_at);
        return;
      }
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      
      // Add session to its creation date group
      groups[dateKey].push(session);
    });
    
    // Sort sessions within each group by created_at (newest first)
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    
    // Sort group keys by date (newest first) - dateKey is in YYYY-MM-DD format
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      // Compare YYYY-MM-DD strings directly (they sort chronologically)
      return b.localeCompare(a);
    });
    
    return { groups, sortedKeys };
  };

  // Toggle date group expansion
  const toggleDateGroup = (dateKey: string) => {
    setExpandedDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateKey)) {
        newSet.delete(dateKey);
      } else {
        newSet.add(dateKey);
      }
      return newSet;
    });
  };

  // Group sessions by date whenever sessions change
  useEffect(() => {
    if (sessions.length > 0) {
      const result = groupSessionsByDate(sessions);
      setGroupedData(result);
      // Initialize all date groups as expanded by default (only if not already initialized)
      // Use functional update to avoid stale closure issues
      setExpandedDates(prev => {
        if (prev.size === 0 && result.sortedKeys.length > 0) {
          return new Set(result.sortedKeys);
        }
        return prev;
      });
    } else {
      setGroupedData({ groups: {}, sortedKeys: [] });
    }
  }, [sessions]); // Only depend on sessions, not currentSessionId or expandedDates

  if (isCollapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-50 bg-[#1E293B] dark:bg-[#1E293B] bg-white border-r border-white/10 dark:border-white/10 border-gray-200 p-3 rounded-r-lg hover:bg-[#1E293B]/80 dark:hover:bg-[#1E293B]/80 hover:bg-gray-50 transition-colors shadow-lg"
        aria-label="Expand sessions"
      >
        <span className="material-symbols-outlined text-gray-900 dark:text-white text-base">chevron_right</span>
      </button>
    );
  }

  return (
    <>
      <div className="w-64 bg-white dark:bg-[#1E293B] flex flex-col h-screen relative overflow-hidden">
        {/* Top Section - Logo and Create Button */}
        <div className="p-4 border-b border-gray-200 dark:border-white/10">
          <div className="flex justify-center mb-0.5">
            <img src="./assets/logo.png" alt="FlowState Logo" className="w-24 h-24 object-contain" />
          </div>
          <div>
            <p className="text-xs text-gray-600 dark:text-slate-400 text-center mb-2">Create New Session</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="w-full h-12 rounded-lg bg-[#1E293B] dark:bg-[#0F172A] hover:bg-[#334155] dark:hover:bg-[#0F172A]/80 border border-gray-300 dark:border-white/10 flex items-center justify-center transition-colors shadow-lg"
              aria-label="Create new session"
            >
              <span className="text-xl text-white font-light">+</span>
            </button>
          </div>
        </div>

        {/* Middle Section - Sessions List */}
        <div className="flex-1 overflow-y-auto px-3 py-3" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          {!loading && sessions.length > 0 && (
            <h3 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider mb-3 px-2">Sessions</h3>
          )}
          {loading ? (
            <div className="text-center text-gray-600 dark:text-slate-500 text-xs py-8">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="text-center text-gray-600 dark:text-slate-500 text-xs py-8">
              No sessions yet
            </div>
          ) : (() => {
            if (!groupedData) {
              return <div className="text-center text-gray-600 dark:text-slate-500 text-xs py-8">Loading...</div>;
            }
            
            const { groups, sortedKeys } = groupedData;
            return (
              <div className="space-y-4">
                {sortedKeys.map((dateKey) => {
                  const isExpanded = expandedDates.has(dateKey);
                  return (
                    <div key={dateKey} className="space-y-2">
                      {/* Date Header with Expand/Collapse Arrow */}
                      <button
                        onClick={() => toggleDateGroup(dateKey)}
                        className="w-full px-2 py-1 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-white/5 rounded transition-colors group"
                      >
                        <h4 className="text-xs font-semibold text-gray-900 dark:text-slate-400 uppercase tracking-wider group-hover:text-gray-700 dark:group-hover:text-slate-300">
                          {formatDateKeyToDisplay(dateKey)}
                        </h4>
                        <span className={`text-gray-900 dark:text-slate-400 text-xs transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                          ▶
                        </span>
                      </button>
                      {/* Sessions for this date - Stacked */}
                      {isExpanded && (
                        <div className="space-y-0">
                          {groups[dateKey].map((session, index) => (
                            <div
                              key={session.id}
                              className="relative group"
                            >
                              <div
                                onClick={() => handleSessionClick(session.id)}
                                className={`
                                  w-full cursor-pointer transition-all p-3 relative
                                  ${
                                    index === 0 ? 'rounded-t-lg' : ''
                                  }
                                  ${
                                    index === groups[dateKey].length - 1 ? 'rounded-b-lg' : ''
                                  }
                                  ${
                                    index !== groups[dateKey].length - 1 ? 'border-b border-gray-300 dark:border-white/10' : ''
                                  }
                                  ${
                                    session.id === currentSessionId
                                      ? 'bg-accent/20 dark:bg-accent/20 bg-blue-50 border-l-2 border-accent border-b border-gray-300 dark:border-white/10 shadow-lg'
                                      : 'bg-gray-200 dark:bg-[#0F172A] border-l border-gray-300 dark:border-white/10 border-b border-gray-300 dark:border-white/10 hover:bg-gray-300 dark:hover:bg-[#0F172A]/80 hover:border-l-accent/30 dark:hover:border-l-accent/50'
                                  }
                                `}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1 line-clamp-2">
                                      {session.name}
                                    </h3>
                                    <p className="text-xs text-gray-600 dark:text-slate-400">
                                      {formatTimeOnly(session.created_at, userTimezone)}
                                    </p>
                                    {session.capture_count !== undefined && session.capture_count > 0 && (
                                      <p className="text-xs text-slate-500 mt-1">
                                        {session.capture_count} capture{session.capture_count !== 1 ? 's' : ''}
                                      </p>
                                    )}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowSessionMenu(showSessionMenu === session.id ? null : session.id);
                                    }}
                                    className="ml-2 p-1 rounded hover:bg-white/10 transition-colors"
                                    aria-label="More options"
                                  >
                                    <span className="material-symbols-outlined text-slate-400 text-xs">more_vert</span>
                                  </button>
                                </div>
                              </div>

                              {/* Dropdown Menu */}
                              {showSessionMenu === session.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowSessionMenu(null)}
                                  />
                                  <div className="absolute top-full left-0 right-0 z-20 bg-[#1E293B] dark:bg-[#1E293B] bg-white border border-white/10 dark:border-white/10 border-gray-200 rounded-lg shadow-xl overflow-hidden mt-1">
                                    <button
                                      onClick={(e) => handleArchiveSession(session.id, e)}
                                      disabled={isArchiving}
                                      className="w-full text-left px-4 py-2 text-sm text-white dark:text-white text-gray-900 hover:bg-white/10 dark:hover:bg-white/10 hover:bg-gray-100 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                      <span className="material-symbols-outlined text-sm">archive</span>
                                      {isArchiving ? 'Archiving...' : 'Archive Session'}
                                    </button>
                                    <button
                                      onClick={(e) => handleDeleteSession(session.id, e)}
                                      disabled={isDeleting}
                                      className="w-full text-left px-4 py-2 text-sm text-red-400 dark:text-red-400 text-red-600 hover:bg-red-500/10 dark:hover:bg-red-500/10 hover:bg-red-50 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                      <span className="material-symbols-outlined text-sm">delete</span>
                                      {isDeleting ? 'Deleting...' : 'Delete'}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Bottom Section - Archive Button and Collapse Button */}
        <div className="p-3 border-t border-gray-200 dark:border-white/10 space-y-2">
          <button
            onClick={() => navigate('/archive')}
            className={`w-full h-10 rounded-lg border flex items-center justify-center transition-colors ${
              isArchiveView
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-[#1E293B] dark:bg-[#0F172A] hover:bg-[#334155] dark:hover:bg-[#0F172A]/80 border-gray-300 dark:border-white/10 text-white'
            }`}
            aria-label="View archive"
          >
            <span className="text-sm font-medium">Archive</span>
          </button>
          <button
            onClick={onToggleCollapse}
            className="w-full h-10 rounded-lg bg-[#1E293B] dark:bg-[#0F172A] hover:bg-[#334155] dark:hover:bg-[#0F172A]/80 border border-gray-300 dark:border-white/10 flex items-center justify-center transition-colors"
            aria-label="Collapse sessions"
          >
            <span className="material-symbols-outlined text-white dark:text-white text-base">chevron_left</span>
          </button>
        </div>
      </div>

      {/* Create Session Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-[#1E293B] border border-gray-300 dark:border-accent/30 rounded-lg p-6 w-96 max-w-[90vw]">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Create New Session</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Session Name
                </label>
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="Leave empty for auto-generated name"
                  className="w-full px-3 py-2 bg-white dark:bg-[#0F172A] border border-gray-300 dark:border-accent/30 rounded-lg !text-gray-950 dark:!text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-accent"
                  autoFocus
                />
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                  Leave empty to auto-generate based on date
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                  Description (Optional)
                </label>
                <textarea
                  value={newSessionDescription}
                  onChange={(e) => setNewSessionDescription(e.target.value)}
                  placeholder="Add notes about this work period..."
                  rows={3}
                  className="w-full px-3 py-2 bg-white dark:bg-[#0F172A] border border-gray-300 dark:border-accent/30 rounded-lg !text-gray-950 dark:!text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-accent resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewSessionName('');
                  setNewSessionDescription('');
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-[#0F172A] hover:bg-gray-300 dark:hover:bg-[#1E293B] text-gray-900 dark:text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSession}
                className="px-4 py-2 bg-accent hover:bg-accent/90 text-white dark:text-[#0F172A] rounded-lg transition-colors font-medium"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Explicit default export
export default SessionSidebar;
export { SessionSidebar };

