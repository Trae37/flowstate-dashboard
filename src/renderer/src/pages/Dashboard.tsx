import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import CaptureCard from '../components/CaptureCard';
import EmptyState from '../components/EmptyState';
import FeatureTour from '../components/FeatureTour';
import SessionSidebar from '../components/SessionSidebar';
import CaptureProgressModal from '../components/CaptureProgressModal';

interface Capture {
  id: number;
  name: string;
  created_at: string;
  context_description?: string;
}

interface Asset {
  id: number;
  asset_type: string;
  title: string;
  path?: string;
  content?: string;
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

interface CaptureProgress {
  step: number;
  totalSteps: number;
  currentStep: string;
  status: 'starting' | 'completed';
  assetsCount?: number;
}

function Dashboard() {
  const navigate = useNavigate();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentCapture, setCurrentCapture] = useState<Capture | null>(null);
  const [currentAssets, setCurrentAssets] = useState<Asset[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState<CaptureProgress | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showFeatureTour, setShowFeatureTour] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [autoSaveIntervalMinutes, setAutoSaveIntervalMinutes] = useState(15);
  const [batterySaverEnabled, setBatterySaverEnabled] = useState(false);
  const [powerStatus, setPowerStatus] = useState<'ac' | 'battery' | 'unknown'>('unknown');
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [currentSession, setCurrentSession] = useState<WorkSession | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showAssetMenu, setShowAssetMenu] = useState<number | null>(null);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveEnabledRef = useRef(false);
  const isCapturingRef = useRef(false);
  const tourInitializedRef = useRef(false);
  const { user, completeFeatureTour } = useAuth();

  // Check if feature tour should be shown
  useEffect(() => {
    // Don't run if tour is already showing, in progress, or marked as completed in sessionStorage
    if (showFeatureTour || 
        sessionStorage.getItem('feature_tour_in_progress') === 'true' || 
        sessionStorage.getItem('feature_tour_completed') === 'true') {
      return;
    }
    
    // Don't run if we've already initialized for this session
    if (tourInitializedRef.current) {
      return;
    }
    
    // Wait for user and loading to be ready
    if (!user || loading) {
      return;
    }
    
    const featureTourCompleted = user.feature_tour_completed === true || user.feature_tour_completed === 1;
    const onboardingCompleted = user.onboarding_completed === true || user.onboarding_completed === 1;
    const justCompletedOnboarding = sessionStorage.getItem('just_completed_onboarding') === 'true';
    
    console.log('[Dashboard] Feature tour check:', {
      hasUser: !!user,
      userId: user.id,
      feature_tour_completed: user.feature_tour_completed,
      featureTourCompleted,
      onboarding_completed: user.onboarding_completed,
      onboardingCompleted,
      justCompletedOnboarding,
      loading,
      tourInitialized: tourInitializedRef.current,
    });
    
    // If tour already completed, mark in sessionStorage and clear flag
    if (featureTourCompleted) {
      sessionStorage.setItem('feature_tour_completed', 'true');
      if (justCompletedOnboarding) {
        sessionStorage.removeItem('just_completed_onboarding');
      }
      return;
    }
    
    // Only show tour if user just completed onboarding AND onboarding is actually completed
    if (justCompletedOnboarding && onboardingCompleted) {
      console.log('[Dashboard] ✅ Conditions met - showing feature tour (first time after onboarding)...');
      
      // Mark as initialized immediately to prevent re-runs
      tourInitializedRef.current = true;
      
      // If no captures exist, create a demo capture for the tour
      const setupTour = async () => {
        try {
          // Wait a moment for everything to settle
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check again before proceeding
          if (sessionStorage.getItem('feature_tour_completed') === 'true') {
            sessionStorage.removeItem('just_completed_onboarding');
            return;
          }
          
          if (captures.length === 0) {
            console.log('[Dashboard] No captures found, creating demo capture for tour...');
            try {
              const result = await window.electronAPI.createDemoCapture(user.id);
              if (result.success && result.data) {
                console.log('[Dashboard] Demo capture created:', result.data);
                // Reload captures to include the demo one
                await loadCaptures(false);
                // Wait for currentCapture to be set and assets to load
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              console.error('[Dashboard] Failed to create demo capture:', error);
            }
          }
          
          // Final check before showing tour
          if (sessionStorage.getItem('feature_tour_completed') === 'true') {
            sessionStorage.removeItem('just_completed_onboarding');
            return;
          }
          
          // Wait a bit for the page to render and ensure elements are ready, then show tour
          setTimeout(() => {
            // Absolute final check before showing
            if (sessionStorage.getItem('feature_tour_completed') !== 'true' && 
                sessionStorage.getItem('feature_tour_in_progress') !== 'true') {
              console.log('[Dashboard] 🎯 Activating feature tour now!');
              
              // Clear the onboarding flag NOW, right before showing the tour
              // This ensures it won't show again on subsequent logins
              sessionStorage.removeItem('just_completed_onboarding');
              
              handleTourStart();
              setShowFeatureTour(true);
            } else {
              // If we can't show the tour, clear the flag anyway
              sessionStorage.removeItem('just_completed_onboarding');
            }
          }, 1500); // Wait for page to render
        } catch (error) {
          console.error('[Dashboard] Error setting up tour:', error);
          sessionStorage.removeItem('just_completed_onboarding');
        }
      };
      
      setupTour();
    } else if (justCompletedOnboarding && !onboardingCompleted) {
      // Flag is set but onboarding not completed yet - wait a bit and check again
      console.log('[Dashboard] Flag set but onboarding not completed yet, waiting...');
      const checkAgain = setTimeout(() => {
        // Re-check after a delay
        if (user.onboarding_completed === true || user.onboarding_completed === 1) {
          // Force re-run by clearing the ref
          tourInitializedRef.current = false;
        } else {
          // Still not completed, clear the flag
          sessionStorage.removeItem('just_completed_onboarding');
        }
      }, 1000);
      
      return () => clearTimeout(checkAgain);
    } else {
      // Conditions not met - clear flag if it exists
      if (justCompletedOnboarding) {
        console.log('[Dashboard] Feature tour NOT showing - clearing flag:', {
          noUser: !user,
          alreadyCompleted: featureTourCompleted,
          onboardingNotCompleted: !onboardingCompleted,
          justCompletedOnboarding,
        });
        sessionStorage.removeItem('just_completed_onboarding');
      }
      setShowFeatureTour(false);
    }
  }, [user, loading, user?.feature_tour_completed, user?.onboarding_completed, showFeatureTour]);

  // Load current session on mount
  useEffect(() => {
    if (user?.id) {
      loadCurrentSession();
    }
  }, [user?.id]);

  // Load captures when session changes
  useEffect(() => {
    if (user?.id) {
      // Load captures even if there's no current session yet
      // This ensures we show captures that might not have a session_id
      loadCaptures();
    }
  }, [user?.id, currentSession?.id]);

  const loadCurrentSession = async () => {
    if (!user?.id) return;
    
    // Check if session methods are available
    if (!window.electronAPI.sessionGetCurrent) {
      console.warn('[Dashboard] Session methods not available yet. Please restart the app.');
      return;
    }
    
    try {
      const result = await window.electronAPI.sessionGetCurrent(user.id);
      if (result.success && result.data) {
        setCurrentSession(result.data);
        console.log('[Dashboard] Loaded current session:', result.data);
      }
    } catch (error) {
      console.error('[Dashboard] Error loading current session:', error);
    }
  };

  const handleSessionChange = async (sessionId: number) => {
    if (!user?.id) return;
    
    try {
      // Get the session details
      const result = await window.electronAPI.sessionGetAll(user.id, false);
      if (result.success && result.data) {
        const session = result.data.find((s: WorkSession) => s.id === sessionId);
        if (session) {
          setCurrentSession(session);
          console.log('[Dashboard] Switched to session:', session);
        }
      }
    } catch (error) {
      console.error('[Dashboard] Error switching session:', error);
    }
  };

  // Keep refs in sync with state
  useEffect(() => {
    autoSaveEnabledRef.current = autoSaveEnabled;
  }, [autoSaveEnabled]);

  useEffect(() => {
    isCapturingRef.current = isCapturing;
  }, [isCapturing]);

  // Helper functions for data loading and capture
  const loadCaptures = async (preserveCurrent = false) => {
    if (!user?.id) {
      console.warn('[Dashboard] Skipping loadCaptures - no authenticated user');
      return;
    }
    try {
      console.log('[Dashboard] Loading captures...', preserveCurrent ? '(preserving current)' : '', `(session: ${currentSession?.id || 'none'})`);
      // Pass sessionId only if it exists, otherwise load all captures for the user
      const result = await window.electronAPI.getCaptures({
        userId: user.id,
        sessionId: currentSession?.id || undefined,
      });
      console.log('[Dashboard] getCaptures result:', {
        success: result.success,
        count: result.data?.length || 0,
        error: result.error,
      });

      if (result.success && result.data) {
        console.log(`[Dashboard] Loaded ${result.data.length} captures`);

        // Update captures list
        setCaptures(result.data);

        // Only update current capture if not preserving it
        if (!preserveCurrent) {
          // Update current capture to the newest one (first in list, since they're sorted DESC)
          if (result.data.length > 0) {
            const newestCapture = result.data[0];
            console.log(`[Dashboard] Setting current capture to:`, newestCapture.id, newestCapture.name);
            setCurrentCapture(newestCapture);
            await loadCurrentAssets(newestCapture.id);
          } else {
            setCurrentCapture(null);
            setCurrentAssets([]);
          }
        }
      } else {
        console.error('[Dashboard] Failed to load captures:', result.error);
      }
    } catch (error) {
      console.error('[Dashboard] Failed to load captures:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentAssets = async (captureId: number) => {
    if (!user?.id) {
      console.warn('[Dashboard] Skipping loadCurrentAssets - no authenticated user');
      return;
    }
    try {
      console.log(`[Dashboard] Loading assets for capture ${captureId}...`);
      const result = await window.electronAPI.getCaptureDetails(captureId, user.id);
      console.log(`[Dashboard] getCaptureDetails result for ${captureId}:`, {
        success: result.success,
        hasData: !!result.data,
        assetsCount: result.data?.assets?.length || 0,
        error: result.error,
      });

      if (result.success && result.data) {
        const assets = result.data.assets || [];
        console.log(`[Dashboard] Setting ${assets.length} assets for capture ${captureId}`);

        // Log sample assets for debugging
        if (assets.length > 0) {
          console.log(`[Dashboard] Sample assets:`, assets.slice(0, 3).map(a => ({
            id: a.id,
            type: a.asset_type,
            title: a.title,
          })));
        } else {
          console.warn(`[Dashboard] No assets found for capture ${captureId}`);
        }

        setCurrentAssets(assets);
      } else {
        console.error(`[Dashboard] Failed to load assets for ${captureId}:`, result.error);
        setCurrentAssets([]);
      }
    } catch (error) {
      console.error(`[Dashboard] Exception loading assets for ${captureId}:`, error);
      setCurrentAssets([]);
    }
  };

  const handleCapture = useCallback(async () => {
    if (isCapturing) {
      console.log('[Dashboard] Capture already in progress, skipping');
      return;
    }
    if (!user?.id) {
      console.warn('[Dashboard] Cannot capture workspace without authenticated user');
      return;
    }

    try {
      setIsCapturing(true);
      console.log('[Dashboard] Starting capture...', `(session: ${currentSession?.id || 'none'})`);

      // Track capture start
      try {
        const { trackEvent } = await import('../utils/analytics');
        trackEvent('capture_started', { session_id: currentSession?.id || null });
      } catch (analyticsError) {
        // Don't fail capture if analytics fails
      }

      const startTime = Date.now();
      const result = await window.electronAPI.captureWorkspace({
        userId: user.id,
        sessionId: currentSession?.id,
      });
      const duration = Date.now() - startTime;
      console.log('[Dashboard] Capture result:', result);

      if (result.success && result.data) {
        // Track successful capture
        try {
          const { trackEvent } = await import('../utils/analytics');
          trackEvent('capture_completed', {
            duration_ms: duration,
            session_id: currentSession?.id || null,
            capture_id: result.data.id,
          });
        } catch (analyticsError) {
          // Don't fail if analytics fails
        }
        const newCapture = result.data;
        console.log('[Dashboard] New capture created:', newCapture);

        // Force a React re-render by updating a key
        setRefreshKey(prev => prev + 1);

        // Immediately update captures list - use functional update to avoid stale closure
        setCaptures(prev => {
          const exists = prev.some(c => c.id === newCapture.id);
          if (exists) {
            // Update existing
            return prev.map(c => c.id === newCapture.id ? newCapture : c);
          }
          // Add new at the beginning with new array reference
          return [newCapture, ...prev];
        });

        // Immediately set as current capture with new object reference
        setCurrentCapture({ ...newCapture });

        // Clear assets initially, they'll load shortly
        setCurrentAssets([]);

        // Wait briefly for database save to complete (assets are saved synchronously)
        await new Promise(resolve => setTimeout(resolve, 300));

        // Load assets for the new capture - retry if needed
        let retries = 3;
        let assetsLoaded = false;
        while (retries > 0 && !assetsLoaded) {
          await loadCurrentAssets(newCapture.id);
          const assetsResult = await window.electronAPI.getCaptureDetails(newCapture.id, user.id);
          if (assetsResult.success && assetsResult.data?.assets?.length > 0) {
            console.log(`[Dashboard] Successfully loaded ${assetsResult.data.assets.length} assets for capture ${newCapture.id}`);
            assetsLoaded = true;
            setCurrentAssets(assetsResult.data.assets);
          } else {
            console.log(`[Dashboard] No assets yet for capture ${newCapture.id}, retrying... (${retries} retries left)`);
            retries--;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // Only reload captures if we didn't get assets (means capture might still be incomplete)
        if (!assetsLoaded) {
          console.log('[Dashboard] Assets not loaded, reloading all captures...');
          await loadCaptures();
        } else {
          // Just refresh the captures list without overwriting the current capture
          const refreshResult = await window.electronAPI.getCaptures({
            userId: user.id,
            sessionId: currentSession?.id,
          });
          if (refreshResult.success && refreshResult.data) {
            // Merge new captures without losing our current selection
            setCaptures(refreshResult.data);
            // Keep currentCapture as the new one we just created
            setCurrentCapture(newCapture);
          }
        }

        console.log('[Dashboard] UI updated with new capture');
      } else {
        console.error('[Dashboard] Capture failed:', result.error);

        // Track capture failure
        try {
          const { trackError } = await import('../utils/analytics');
          trackError('capture_failed', result.error || 'Unknown error', { session_id: currentSession?.id || null });
        } catch (analyticsError) {
          // Don't fail if analytics fails
        }

        alert(`Capture failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[Dashboard] Failed to capture workspace:', error);
      alert(`Failed to capture workspace: ${error}`);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, user?.id, currentSession?.id, setIsCapturing, setRefreshKey, setCaptures, setCurrentCapture, setCurrentAssets]);

  // Auto-save interval management
  useEffect(() => {
    const clearExistingInterval = () => {
      if (autoSaveIntervalRef.current) {
        clearInterval(autoSaveIntervalRef.current);
        autoSaveIntervalRef.current = null;
      }
    };

    clearExistingInterval();

    const shouldRunInterval =
      autoSaveEnabled &&
      !isCapturing &&
      (!batterySaverEnabled ||
        (powerStatus === 'ac' && isWindowFocused));

    if (shouldRunInterval) {
      console.log('[Dashboard] Auto-save enabled, setting up interval');
      autoSaveIntervalRef.current = setInterval(() => {
        const shouldCapture =
          autoSaveEnabledRef.current &&
          !isCapturingRef.current &&
          (!batterySaverEnabled ||
            (powerStatus === 'ac' && isWindowFocused));

        if (shouldCapture) {
          console.log('[Dashboard] Auto-capturing workspace...');
          handleCapture();
        } else {
          console.log('[Dashboard] Skipping auto-capture - conditions not met');
        }
      }, autoSaveIntervalMinutes * 60 * 1000);
    } else {
      console.log('[Dashboard] Auto-save disabled or paused due to saver rules');
    }

    return clearExistingInterval;
  }, [
    autoSaveEnabled,
    isCapturing,
    batterySaverEnabled,
    powerStatus,
    isWindowFocused,
    autoSaveIntervalMinutes,
    handleCapture,
  ]);

  const handleAutoSaveToggle = (enabled: boolean) => {
    setAutoSaveEnabled(enabled);
    if (user?.id) {
      window.electronAPI.saveSettings?.({ autoSaveEnabled: enabled }, user.id);
    }
  };

  // Load preferences and power status on mount
  useEffect(() => {
    const loadPreferences = async () => {
      if (!user?.id) {
        return;
      }
      try {
        const result = await window.electronAPI.getSettings(user.id);
        if (result.success && result.data) {
          const data = result.data;
          const parseBoolean = (value: any, fallback = false) =>
            value === true || value === 'true' || value === 1 || value === '1';
          const parseNumber = (value: any, fallback: number) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
          };

          if (data.autoSaveEnabled !== undefined) {
            setAutoSaveEnabled(parseBoolean(data.autoSaveEnabled));
          }
          if (data.autoSaveIntervalMinutes !== undefined) {
            setAutoSaveIntervalMinutes(parseNumber(data.autoSaveIntervalMinutes, 15));
          }
          if (data.batterySaverEnabled !== undefined) {
            setBatterySaverEnabled(parseBoolean(data.batterySaverEnabled, false));
          }
        }
      } catch (error) {
        console.warn('[Dashboard] Failed to load settings:', error);
      }
    };

    loadPreferences();

    const unsubscribe = window.electronAPI.onPowerStatusChange?.((status) => {
      setPowerStatus(status);
    });

    window.electronAPI
      .getPowerStatus?.()
      .then((status) => setPowerStatus(status))
      .catch(() => setPowerStatus('unknown'));

    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [user?.id]);

  // Listen for capture progress updates
  useEffect(() => {
    const unsubscribe = window.electronAPI.onCaptureProgress((progress) => {
      setCaptureProgress(progress);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Clear progress when capture finishes
  useEffect(() => {
    if (!isCapturing && captureProgress) {
      // Clear progress after a short delay to allow final animation
      const timer = setTimeout(() => {
        setCaptureProgress(null);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isCapturing, captureProgress]);

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins} minutes ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hours ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} days ago`;
    }
  };

  const getAssetIcon = (type: string) => {
    switch (type) {
      case 'code': return 'code';
      case 'terminal': return 'terminal';
      case 'browser': return 'public';
      case 'notes': return 'description';
      default: return 'folder';
    }
  };

  const getAssetColor = (type: string) => {
    switch (type) {
      case 'code': return 'text-green-400';
      case 'terminal': return 'text-accent';
      case 'browser': return 'text-blue-400';
      case 'notes': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-white dark:text-white text-gray-900">Loading...</div>
      </div>
    );
  }

  const handleTourComplete = async () => {
    console.log('[Dashboard] Tour completed, marking as done');
    // Immediately prevent any further tour initialization
    tourInitializedRef.current = true;
    setShowFeatureTour(false);
    sessionStorage.removeItem('feature_tour_in_progress');
    sessionStorage.setItem('feature_tour_completed', 'true');
    if (user) {
      await completeFeatureTour();
    }
  };

  const handleTourStart = () => {
    sessionStorage.setItem('feature_tour_in_progress', 'true');
  };

  // Get captures excluding the most recent one (for history)
  const historyCaptures = captures.length > 0 ? captures.slice(1) : [];

  if (captures.length === 0) {
    return (
      <div className="flex min-h-screen">
        <SessionSidebar
          currentSessionId={currentSession?.id || null}
          onSessionChange={handleSessionChange}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onSessionArchive={() => {
            loadCaptures();
            if (currentSession?.id) {
              loadCurrentSession();
            }
          }}
          onSessionDelete={() => {
            loadCaptures();
            loadCurrentSession();
          }}
        />
        <div className="flex-1 flex flex-col">
          {showFeatureTour && <FeatureTour onComplete={handleTourComplete} hasCaptures={false} />}
          <Header 
            onCapture={handleCapture} 
            isCapturing={isCapturing}
            autoSaveEnabled={autoSaveEnabled}
            onAutoSaveToggle={handleAutoSaveToggle}
          />
          <EmptyState onCapture={handleCapture} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <SessionSidebar
        currentSessionId={currentSession?.id || null}
        onSessionChange={handleSessionChange}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onSessionArchive={() => {
          loadCaptures();
          if (currentSession?.id) {
            loadCurrentSession();
          }
        }}
        onSessionDelete={() => {
          loadCaptures();
          loadCurrentSession();
        }}
      />
      <div className="flex-1 flex flex-col">
        {showFeatureTour && <FeatureTour onComplete={handleTourComplete} hasCaptures={captures.length > 0} />}
        <Header 
          onCapture={handleCapture} 
          isCapturing={isCapturing}
          autoSaveEnabled={autoSaveEnabled}
          onAutoSaveToggle={handleAutoSaveToggle}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          {/* Page Title */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wide">
              Dashboard
            </h2>
          </div>

          {currentCapture && (
            <div className="mb-8" data-tour="current-workspace">
              <header className="mb-6 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Current Workspace Capture</h1>
                    <span className="text-sm font-semibold px-3 py-1.5 bg-accent/10 text-accent rounded-lg">
                      Most Recent - #0
                    </span>
                  </div>
                  <p className="text-gray-600 dark:text-slate-400">
                    Last updated: {formatTimeAgo(currentCapture.created_at)} (Auto Refresh)
                  </p>
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowAssetMenu(showAssetMenu === -1 ? null : -1);
                    }}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    aria-label="More options"
                  >
                    <span className="material-symbols-outlined text-slate-400 text-sm">more_vert</span>
                  </button>
                  
                  {/* Dropdown Menu for Current Capture */}
                  {showAssetMenu === -1 && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowAssetMenu(null)}
                      />
                      <div className="absolute top-12 right-0 z-20 bg-[#1E293B] dark:bg-[#1E293B] bg-white border border-white/10 dark:border-white/10 border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[150px]">
                        <button
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!user?.id) return;
                            try {
                              const result = await window.electronAPI.archiveCapture({
                                captureId: currentCapture.id,
                                userId: user.id,
                              });
                              if (result.success) {
                                loadCaptures();
                                setShowAssetMenu(null);
                              } else {
                                alert(`Failed to archive: ${result.error}`);
                              }
                            } catch (error) {
                              console.error('Failed to archive capture:', error);
                              alert('Failed to archive capture');
                            }
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-white dark:text-white text-gray-900 hover:bg-white/10 dark:hover:bg-white/10 hover:bg-gray-100 transition-colors flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm">archive</span>
                          Archive
                        </button>
                        <button
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!user?.id) return;
                            if (!confirm(`Are you sure you want to delete "${currentCapture.name}"? This action cannot be undone.`)) {
                              return;
                            }
                            try {
                              const result = await window.electronAPI.deleteCapture(currentCapture.id, user.id);
                              if (result.success) {
                                loadCaptures();
                                setShowAssetMenu(null);
                              } else {
                                alert(`Failed to delete: ${result.error}`);
                              }
                            } catch (error) {
                              console.error('Failed to delete capture:', error);
                              alert('Failed to delete capture');
                            }
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-red-400 dark:text-red-400 text-red-600 hover:bg-red-500/10 dark:hover:bg-red-500/10 hover:bg-red-50 transition-colors flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </header>

              <div className="grid grid-cols-1 gap-4" key={`current-assets-${refreshKey}`}>
                {currentAssets.length === 0 ? (
                  <div className="rounded-xl p-1.5 bg-gray-200 dark:bg-transparent">
                    <div className="bg-[#1E293B] dark:bg-[#0F172A] rounded-lg p-4 border border-white/5 dark:border-white/5 text-center">
                      <p className="text-slate-400 dark:text-slate-400 text-white">
                        {isCapturing ? 'Capturing assets...' : 'No assets found for this capture'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-500 text-slate-400 mt-2">Check console for details</p>
                      <p className="text-xs text-red-400 dark:text-red-400 text-red-400 mt-1">Current capture ID: {currentCapture?.id}</p>
                    </div>
                  </div>
                ) : (
                  currentAssets.slice(0, 4).map((asset) => (
                    <div key={asset.id} className="relative group">
                      <div className="rounded-xl bg-gray-200 dark:bg-[#1E293B]/60 transition-all duration-300 hover:bg-gray-300 dark:hover:bg-[#334155] border border-gray-300 dark:border-white/10 shadow-lg">
                        <Link
                          to={`/context/${currentCapture.id}`}
                          className="block rounded-xl"
                        >
                          <div className="p-5">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-2 flex-1">
                                <span className={`material-symbols-outlined text-xl ${getAssetColor(asset.asset_type || 'other')}`}>
                                  {getAssetIcon(asset.asset_type || 'other')}
                                </span>
                                <span className="text-gray-900 dark:text-white font-medium">{asset.title || 'Untitled Asset'}</span>
                              </div>
                            </div>
                            {asset.content && (
                              <div className="bg-[#1E293B] dark:bg-[#0F172A] rounded-lg p-4">
                                <pre className="text-xs text-white font-mono leading-relaxed overflow-x-auto">
                                  {asset.content.substring(0, 200)}
                                  {asset.content.length > 200 && '...'}
                                </pre>
                              </div>
                            )}
                          </div>
                        </Link>
                      </div>
                      {/* Archive/Delete Menu Button */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowAssetMenu(showAssetMenu === asset.id ? null : asset.id);
                        }}
                        className="absolute top-4 right-4 p-1 rounded hover:bg-white/10 dark:hover:bg-white/10 hover:bg-gray-200 transition-colors"
                        aria-label="More options"
                      >
                        <span className="material-symbols-outlined text-slate-400 dark:text-slate-400 text-gray-600 text-sm">more_vert</span>
                      </button>
                      
                      {/* Dropdown Menu */}
                      {showAssetMenu === asset.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setShowAssetMenu(null)}
                          />
                          <div className="absolute top-12 right-4 z-20 bg-[#1E293B] dark:bg-[#1E293B] bg-white border border-white/10 dark:border-white/10 border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[150px]">
                            <button
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!user?.id) return;
                                try {
                                  const result = await window.electronAPI.archiveAsset({
                                    assetId: asset.id,
                                    userId: user.id,
                                  });
                                  if (result.success) {
                                    loadCaptures();
                                    setShowAssetMenu(null);
                                  } else {
                                    alert(`Failed to archive: ${result.error}`);
                                  }
                                } catch (error) {
                                  console.error('Failed to archive asset:', error);
                                  alert('Failed to archive asset');
                                }
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-white dark:text-white text-gray-900 hover:bg-white/10 dark:hover:bg-white/10 hover:bg-gray-100 transition-colors flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-sm">archive</span>
                              Archive
                            </button>
                            <button
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!user?.id) return;
                                if (!confirm(`Are you sure you want to delete "${asset.title}"? This action cannot be undone.`)) {
                                  return;
                                }
                                try {
                                  const result = await window.electronAPI.deleteAsset({
                                    assetId: asset.id,
                                    userId: user.id,
                                  });
                                  if (result.success) {
                                    loadCaptures();
                                    setShowAssetMenu(null);
                                  } else {
                                    alert(`Failed to delete: ${result.error}`);
                                  }
                                } catch (error) {
                                  console.error('Failed to delete asset:', error);
                                  alert('Failed to delete asset');
                                }
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-red-400 dark:text-red-400 text-red-600 hover:bg-red-500/10 dark:hover:bg-red-500/10 hover:bg-red-50 transition-colors flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* View Details Button for Current Capture */}
              <button
                onClick={() => navigate(`/context/${currentCapture.id}`)}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent/90 text-white dark:text-[#0F172A] font-semibold rounded-lg transition-colors"
              >
                <span>View Details</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
          )}

          <div className="mt-12" data-tour="capture-cards">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Recent Capture History</h2>
            {historyCaptures.length === 0 ? (
              <p className="text-slate-400 dark:text-slate-400 text-gray-600 text-center py-8">No previous captures in this session</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" key={`captures-${refreshKey}`}>
                {historyCaptures.slice(0, 4).map((capture, index) => (
                  <div key={`capture-${capture.id}-${capture.created_at}-${refreshKey}`} data-tour={index === 0 ? "capture-card" : undefined}>
                    <CaptureCard
                      capture={capture}
                      captureNumber={index + 1}
                      onArchive={() => loadCaptures()}
                      onDelete={() => loadCaptures()}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      </div>

      {/* Capture progress modal */}
      <CaptureProgressModal
        isOpen={isCapturing}
        progress={captureProgress}
        onClose={() => setIsCapturing(false)}
      />
    </div>
  );
}

export default Dashboard;
