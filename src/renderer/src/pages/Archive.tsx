import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import FeatureTour from '../components/FeatureTour';
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
  const { user, completeFeatureTour } = useAuth();
  const navigate = useNavigate();
  const { date: dateParam } = useParams<{ date?: string }>();
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [showFeatureTour, setShowFeatureTour] = useState(false);
  const tourInitializedRef = useRef(false);

  // Menu and action states
  const [showSessionMenu, setShowSessionMenu] = useState<number | null>(null);
  const [showCaptureMenu, setShowCaptureMenu] = useState<number | null>(null);
  const [sessionActionLoading, setSessionActionLoading] = useState<number | null>(null);
  const [captureActionLoading, setCaptureActionLoading] = useState<number | null>(null);

  // Decode the date parameter if present
  const selectedDate = dateParam ? decodeURIComponent(dateParam) : null;

  // Check if feature tour should continue on archive page
  useEffect(() => {
    // Don't run if tour is already showing, already initialized, or marked as completed
    if (showFeatureTour ||
        tourInitializedRef.current ||
        sessionStorage.getItem('feature_tour_completed') === 'true') {
      return;
    }

    const featureTourCompleted = user?.feature_tour_completed === true || user?.feature_tour_completed === 1;

    // If already completed, mark in sessionStorage and return immediately
    if (featureTourCompleted) {
      sessionStorage.setItem('feature_tour_completed', 'true');
      return;
    }

    if (user && !featureTourCompleted && !loading) {
      // Check if we came from dashboard tour (archive phase)
      const tourInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
      const tourPhase = sessionStorage.getItem('feature_tour_phase');

      if (tourInProgress && !showFeatureTour) {
        console.log('[Archive] Tour in progress, phase:', tourPhase, '- showing archive tour');
        setTimeout(() => {
          // Final check before showing
          const stillInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
          const stillNotCompleted = !(user?.feature_tour_completed === true || user?.feature_tour_completed === 1);
          if (stillInProgress && stillNotCompleted) {
            tourInitializedRef.current = true;
            setShowFeatureTour(true);
          }
        }, 500);
      }
    } else {
      // Make sure tour is hidden if conditions aren't met
      if (featureTourCompleted) {
        setShowFeatureTour(false);
        sessionStorage.removeItem('feature_tour_in_progress');
      }
    }
  }, [user, loading, user?.feature_tour_completed, showFeatureTour]);

  const handleTourComplete = async () => {
    console.log('[Archive] Tour completed/skipped');
    tourInitializedRef.current = true;
    setShowFeatureTour(false);
    sessionStorage.removeItem('feature_tour_in_progress');
    sessionStorage.setItem('feature_tour_completed', 'true');
    if (user) {
      await completeFeatureTour();
    }
  };

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
          let archivedCaptures = capturesResult.data.filter((c: any) => c.archived);

          // Check if feature tour is in progress and no archived items exist
          const tourInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
          if (tourInProgress && archivedCaptures.length === 0 && window.electronAPI?.createDemoArchivedCaptures) {
            console.log('[Archive] Creating demo archived captures for tour...');
            const demoResult = await window.electronAPI.createDemoArchivedCaptures(user.id);
            if (demoResult.success && demoResult.data) {
              // Reload captures to include the new demo captures
              const reloadResult = await window.electronAPI.getCaptures({
                userId: user.id,
                includeArchived: true
              });
              if (reloadResult.success && reloadResult.data) {
                archivedCaptures = reloadResult.data.filter((c: any) => c.archived);
              }
            }
          }

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

  // Session handlers
  const handleUnarchiveSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id || sessionActionLoading) return;

    setSessionActionLoading(sessionId);
    try {
      const result = await window.electronAPI.sessionUnarchive(sessionId);
      if (result.success) {
        await loadArchivedData();
      } else {
        alert(`Failed to unarchive session: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to unarchive session:', error);
      alert('Failed to unarchive session');
    } finally {
      setSessionActionLoading(null);
      setShowSessionMenu(null);
    }
  };

  const handleDeleteSession = async (sessionId: number, sessionName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id || sessionActionLoading) return;

    if (!confirm(`Are you sure you want to delete the session "${sessionName}"? This will also delete all captures and assets in this session. This action cannot be undone.`)) {
      return;
    }

    setSessionActionLoading(sessionId);
    try {
      const result = await window.electronAPI.sessionDelete(sessionId);
      if (result.success) {
        await loadArchivedData();
      } else {
        alert(`Failed to delete session: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      alert('Failed to delete session');
    } finally {
      setSessionActionLoading(null);
      setShowSessionMenu(null);
    }
  };

  // Capture handlers
  const handleUnarchiveCapture = async (captureId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id || captureActionLoading) return;

    setCaptureActionLoading(captureId);
    try {
      const result = await window.electronAPI.unarchiveCapture({
        captureId,
        userId: user.id,
      });
      if (result.success) {
        await loadArchivedData();
      } else {
        alert(`Failed to unarchive capture: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to unarchive capture:', error);
      alert('Failed to unarchive capture');
    } finally {
      setCaptureActionLoading(null);
      setShowCaptureMenu(null);
    }
  };

  const handleDeleteCapture = async (captureId: number, captureName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.id || captureActionLoading) return;

    if (!confirm(`Are you sure you want to delete "${captureName}"? This action cannot be undone.`)) {
      return;
    }

    setCaptureActionLoading(captureId);
    try {
      const result = await window.electronAPI.deleteCapture(captureId, user.id);
      if (result.success) {
        await loadArchivedData();
      } else {
        alert(`Failed to delete capture: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to delete capture:', error);
      alert('Failed to delete capture');
    } finally {
      setCaptureActionLoading(null);
      setShowCaptureMenu(null);
    }
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
      {showFeatureTour && <FeatureTour onComplete={handleTourComplete} />}
      <div className="flex-1 flex flex-col">
        <Header
          onCapture={() => navigate('/')}
          isCapturing={false}
        />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <header className="mb-6" data-tour="archive-header">
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
                  data-tour="archive-back-button"
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
                          className="relative bg-gray-200 dark:bg-[#1E293B] border border-gray-300 dark:border-white/10 rounded-lg p-4"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
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

                            {/* Session Menu Button */}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowSessionMenu(showSessionMenu === session.id ? null : session.id);
                                }}
                                className="ml-2 p-1 rounded hover:bg-white/10 transition-colors"
                                aria-label="Session options"
                              >
                                <span className="material-symbols-outlined text-slate-400 text-sm">more_vert</span>
                              </button>

                              {/* Session Dropdown Menu */}
                              {showSessionMenu === session.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowSessionMenu(null)}
                                  />
                                  <div className="absolute top-8 right-0 z-20 bg-white dark:bg-[#1E293B] border border-gray-300 dark:border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[180px]">
                                    <button
                                      onClick={(e) => handleUnarchiveSession(session.id, e)}
                                      disabled={sessionActionLoading === session.id}
                                      className="w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                      <span className="material-symbols-outlined text-sm">unarchive</span>
                                      {sessionActionLoading === session.id ? 'Unarchiving...' : 'Unarchive Session'}
                                    </button>
                                    <button
                                      onClick={(e) => handleDeleteSession(session.id, session.name, e)}
                                      disabled={sessionActionLoading === session.id}
                                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex items-center gap-2 disabled:opacity-50"
                                    >
                                      <span className="material-symbols-outlined text-sm">delete</span>
                                      {sessionActionLoading === session.id ? 'Deleting...' : 'Delete Session'}
                                    </button>
                                  </div>
                                </>
                              )}
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
                                      className="relative group"
                                    >
                                      <div
                                        className="flex items-center justify-between text-sm text-white dark:text-slate-300 hover:text-white/80 dark:hover:text-white cursor-pointer p-2 rounded hover:bg-[#334155] dark:hover:bg-white/5"
                                        onClick={() => navigate(`/context/${capture.id}`)}
                                      >
                                        <span className="flex-1">
                                          {capture.name} - {formatFullDateTime(capture.created_at)}
                                        </span>

                                        {/* Capture Menu Button */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShowCaptureMenu(showCaptureMenu === capture.id ? null : capture.id);
                                          }}
                                          className="ml-2 p-1 rounded hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                                          aria-label="Capture options"
                                        >
                                          <span className="material-symbols-outlined text-slate-400 text-sm">more_vert</span>
                                        </button>
                                      </div>

                                      {/* Capture Dropdown Menu */}
                                      {showCaptureMenu === capture.id && (
                                        <>
                                          <div
                                            className="fixed inset-0 z-30"
                                            onClick={() => setShowCaptureMenu(null)}
                                          />
                                          <div className="absolute top-8 right-0 z-40 bg-white dark:bg-[#1E293B] border border-gray-300 dark:border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[180px]">
                                            <button
                                              onClick={(e) => handleUnarchiveCapture(capture.id, e)}
                                              disabled={captureActionLoading === capture.id}
                                              className="w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-50"
                                            >
                                              <span className="material-symbols-outlined text-sm">unarchive</span>
                                              {captureActionLoading === capture.id ? 'Unarchiving...' : 'Unarchive Capture'}
                                            </button>
                                            <button
                                              onClick={(e) => handleDeleteCapture(capture.id, capture.name, e)}
                                              disabled={captureActionLoading === capture.id}
                                              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex items-center gap-2 disabled:opacity-50"
                                            >
                                              <span className="material-symbols-outlined text-sm">delete</span>
                                              {captureActionLoading === capture.id ? 'Deleting...' : 'Delete Capture'}
                                            </button>
                                          </div>
                                        </>
                                      )}
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

