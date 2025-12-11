import { useState, useEffect } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import { formatFullDateTime } from '../utils/dateUtils';

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

interface Capture {
  id: number;
  name: string;
  created_at: string;
  context_description?: string;
  session_id?: number;
}

interface Asset {
  id: number;
  capture_id: number;
  asset_type: string;
  title: string;
  path?: string;
  content?: string;
}

function Archive() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { date: dateParam } = useParams<{ date?: string }>();
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  
  // Decode the date parameter if present
  const selectedDate = dateParam ? decodeURIComponent(dateParam) : null;

  useEffect(() => {
    if (user?.id) {
      loadArchivedData();
    }
  }, [user?.id]);

  const loadArchivedData = async () => {
    if (!user?.id) return;

    try {
      setLoading(true);

      // Load archived sessions
      if (window.electronAPI?.sessionGetAll) {
        const sessionsResult = await window.electronAPI.sessionGetAll(user.id, true);
        if (sessionsResult.success && sessionsResult.data) {
          const archivedSessions = sessionsResult.data.filter(s => s.archived);
          setSessions(archivedSessions);
        }
      }

      // Load archived captures
      if (window.electronAPI?.getCaptures) {
        const capturesResult = await window.electronAPI.getCaptures({ 
          userId: user.id, 
          includeArchived: true 
        });
        if (capturesResult.success && capturesResult.data) {
          // Filter for archived captures only
          const archivedCaptures = capturesResult.data.filter((c: any) => c.archived);
          setCaptures(archivedCaptures);
        }
      }
    } catch (error) {
      console.error('[Archive] Error loading archived data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Group sessions by date
  const groupSessionsByDate = (sessions: WorkSession[]) => {
    const groups: { [key: string]: WorkSession[] } = {};

    sessions.forEach(session => {
      const date = new Date(session.archived_at || session.created_at);
      const dateKey = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(session);
    });

    // Sort sessions within each group by archived_at (newest first)
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => {
        const dateA = new Date(a.archived_at || a.created_at);
        const dateB = new Date(b.archived_at || b.created_at);
        return dateB.getTime() - dateA.getTime();
      });
    });

    // Sort group keys by date (newest first)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateB.getTime() - dateA.getTime();
    });

    return { groups, sortedKeys };
  };

  // Get captures for a specific session
  const getCapturesForSession = (sessionId: number) => {
    return captures.filter(c => c.session_id === sessionId);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-slate-400 dark:text-slate-400 text-gray-600">Loading archive...</div>
        </div>
      </div>
    );
  }

  const { groups, sortedKeys } = groupSessionsByDate(sessions);

  return (
    <div className="flex min-h-screen">
      <div className="flex-1 flex flex-col">
        <Header 
          onCapture={() => navigate('/')} 
          isCapturing={false}
        />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <header className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Archive</h1>
                  <p className="text-gray-600 dark:text-slate-400">
                    Archived sessions, captures, and components grouped by date
                  </p>
                </div>
                <Link
                  to="/"
                  className="flex items-center gap-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                  <span>Back to Dashboard</span>
                </Link>
              </div>
            </header>

            {sortedKeys.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-600 dark:text-slate-400 text-lg mb-2">No archived items yet</p>
                <p className="text-gray-500 dark:text-slate-500 text-sm">
                  Items you archive will appear here, organized by date
                </p>
              </div>
            ) : selectedDate && groups[selectedDate] ? (
              /* Viewing a specific date - show only that date's sessions */
              <div className="space-y-6">
                {/* Back button */}
                <Link
                  to="/archive"
                  className="flex items-center gap-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-4"
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                  <span>Back to Archive</span>
                </Link>

                {/* Selected Date Section */}
                <div className="space-y-3">
                  {/* Date Header */}
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-300 uppercase tracking-wider">
                    {selectedDate}
                  </h2>

                  {/* Sessions for this date */}
                  <div className="space-y-2">
                    {groups[selectedDate].map((session) => {
                      const sessionCaptures = getCapturesForSession(session.id);
                      return (
                        <div
                          key={session.id}
                          className="bg-gray-200 dark:bg-[#1E293B] border border-gray-300 dark:border-white/10 rounded-lg p-4"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="text-gray-900 dark:text-white font-medium mb-1">{session.name}</h3>
                              {session.description && (
                                <p className="text-sm text-gray-600 dark:text-slate-400 mb-2">{session.description}</p>
                              )}
                              <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-500">
                                <span>
                                  Created: {formatFullDateTime(session.created_at)}
                                </span>
                                {session.archived_at && (
                                  <span>
                                    Archived: {formatFullDateTime(session.archived_at)}
                                  </span>
                                )}
                                {session.auto_recovered && (
                                  <span className="text-yellow-400 dark:text-yellow-400 text-yellow-600">Auto-recovered</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {sessionCaptures.length > 0 && (
                            <div className="mt-3 pt-3">
                              <div className="bg-[#1E293B] rounded-lg p-4">
                                <p className="text-xs text-white dark:text-slate-400 mb-2">
                                  {sessionCaptures.length} archived capture{sessionCaptures.length !== 1 ? 's' : ''}
                                </p>
                                <div className="space-y-1">
                                  {sessionCaptures.map((capture) => (
                                    <div
                                      key={capture.id}
                                      className="text-sm text-white dark:text-slate-300 hover:text-white/80 dark:hover:text-white cursor-pointer p-2 rounded hover:bg-[#334155] dark:hover:bg-white/5"
                                      onClick={() => navigate(`/context/${capture.id}`)}
                                    >
                                      {capture.name} - {formatFullDateTime(capture.created_at)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : selectedDate ? (
              /* Invalid date parameter - redirect to archive */
              <div className="text-center py-12">
                <p className="text-gray-600 dark:text-slate-400 text-lg mb-4">
                  Date not found
                </p>
                <Link
                  to="/archive"
                  className="flex items-center gap-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors justify-center"
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                  <span>Back to Archive</span>
                </Link>
              </div>
            ) : (
              /* Viewing all folders - show folder grid */
              <>
                {/* Date Folder Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8 pt-4">
                  {sortedKeys.map((dateKey) => {
                    const dateSessions = groups[dateKey];
                    const totalCaptures = dateSessions.reduce((sum, session) => {
                      return sum + (getCapturesForSession(session.id).length);
                    }, 0);
                    const totalItems = dateSessions.length + totalCaptures;
                    
                    return (
                      <div
                        key={dateKey}
                        className="relative cursor-pointer transition-all duration-300 hover:opacity-90 group"
                        onClick={() => {
                          navigate(`/archive/${encodeURIComponent(dateKey)}`);
                        }}
                      >
                        {/* Folder Container with Integrated Tab */}
                        <div className="relative rounded-2xl overflow-visible border border-gray-300 dark:border-white/10 shadow-lg">
                          {/* Tab - Integrated into folder, filleted/rounded corners where it meets top */}
                          <div 
                            className="absolute -top-3 left-6 w-16 h-6 bg-gray-200 dark:bg-[#1E293B] z-30"
                            style={{
                              borderTopLeftRadius: '8px',
                              borderTopRightRadius: '8px',
                              borderBottomLeftRadius: '4px',
                              borderBottomRightRadius: '4px'
                            }}
                          ></div>
                          
                          {/* Folder Body with overflow-hidden for rounded corners */}
                          <div className="relative rounded-2xl overflow-hidden">
                          
                          {/* Upper Section - Folder Interior (40-50% of card) */}
                          <div className="relative h-[45%] bg-gray-100 dark:bg-black rounded-t-2xl">
                            {/* Sort/Filter Icon in Top-Left */}
                            <div className="absolute top-3 left-3">
                              <span className="material-symbols-outlined text-white text-base">
                                swap_vert
                              </span>
                            </div>
                          </div>
                          
                          {/* Lower Section - Front Cover (50-60% of card) */}
                          <div className="relative h-[55%] bg-gray-200 dark:bg-[#1E293B] rounded-b-2xl">
                            {/* Content on Front Cover */}
                            <div className="px-5 pb-5 pt-5">
                              {/* Folder Name - Large, Bold, White */}
                              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                                {dateKey}
                              </h2>
                              {/* Item Count - Smaller, White */}
                              <p className="text-sm text-gray-700 dark:text-white">
                                {totalItems === 0 ? 'No items' : `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`}
                              </p>
                            </div>
                          </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-center py-12">
                  <p className="text-gray-600 dark:text-slate-400 text-lg">
                    Click on a folder above to view sessions for that date
                  </p>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default Archive;

