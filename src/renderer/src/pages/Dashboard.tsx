import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import CaptureCard from '../components/CaptureCard';
import EmptyState from '../components/EmptyState';
import FeatureTour from '../components/FeatureTour';

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

function Dashboard() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentCapture, setCurrentCapture] = useState<Capture | null>(null);
  const [currentAssets, setCurrentAssets] = useState<Asset[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showFeatureTour, setShowFeatureTour] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [autoSaveIntervalMinutes, setAutoSaveIntervalMinutes] = useState(15);
  const [batterySaverEnabled, setBatterySaverEnabled] = useState(false);
  const [powerStatus, setPowerStatus] = useState<'ac' | 'battery' | 'unknown'>('unknown');
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const autoSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveEnabledRef = useRef(false);
  const isCapturingRef = useRef(false);
  const tourInitializedRef = useRef(false);
  const { user, completeFeatureTour } = useAuth();

  // Check if feature tour should be shown
  useEffect(() => {
    // Don't run if tour is already showing, in progress, already initialized, or marked as completed in sessionStorage
    if (showFeatureTour || 
        sessionStorage.getItem('feature_tour_in_progress') === 'true' || 
        sessionStorage.getItem('feature_tour_completed') === 'true' ||
        tourInitializedRef.current) {
      return;
    }
    
    const featureTourCompleted = user?.feature_tour_completed === true || user?.feature_tour_completed === 1;
    
    // If already completed, mark in sessionStorage and return immediately
    if (featureTourCompleted) {
      sessionStorage.setItem('feature_tour_completed', 'true');
      return;
    }
    const onboardingCompleted = user?.onboarding_completed === true || user?.onboarding_completed === 1;
    
    console.log('[Dashboard] Feature tour check:', {
      hasUser: !!user,
      feature_tour_completed: user?.feature_tour_completed,
      featureTourCompleted,
      onboarding_completed: user?.onboarding_completed,
      onboardingCompleted,
      loading,
      hasCaptures: captures.length > 0,
      tourAlreadyShowing: showFeatureTour,
    });
    
    if (user && !featureTourCompleted && onboardingCompleted && !loading) {
      // Final check - if sessionStorage says completed, don't proceed
      if (sessionStorage.getItem('feature_tour_completed') === 'true') {
        return;
      }
      
      console.log('[Dashboard] Conditions met - showing feature tour...');
      
      // Mark as initialized immediately to prevent re-runs
      tourInitializedRef.current = true;
      
      // If no captures exist, create a demo capture for the tour
      const setupTour = async () => {
        // Wait for initial captures to load
        if (loading) {
          return;
        }
        
        // Check again before proceeding
        if (sessionStorage.getItem('feature_tour_completed') === 'true') {
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
              
              // Ensure currentCapture is set (it should be set by loadCaptures)
              if (!currentCapture) {
                console.log('[Dashboard] Waiting for currentCapture to be set...');
                // Wait a bit more
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
          } catch (error) {
            console.error('[Dashboard] Failed to create demo capture:', error);
          }
        }
        
        // Final check before showing tour
        if (sessionStorage.getItem('feature_tour_completed') === 'true') {
          return;
        }
        
        // Wait a bit for the page to render and ensure elements are ready, then show tour
        setTimeout(() => {
          // Absolute final check before showing
          if (sessionStorage.getItem('feature_tour_completed') !== 'true' && 
              sessionStorage.getItem('feature_tour_in_progress') !== 'true') {
            console.log('[Dashboard] Activating feature tour now');
            console.log('[Dashboard] Current capture:', currentCapture);
            console.log('[Dashboard] Current assets:', currentAssets.length);
            handleTourStart();
            setShowFeatureTour(true);
          }
        }, 2000); // Increased delay to ensure everything is rendered
      };
      
      setupTour();
    } else {
      console.log('[Dashboard] Feature tour NOT showing because:', {
        noUser: !user,
        alreadyCompleted: featureTourCompleted,
        onboardingNotCompleted: !onboardingCompleted,
        stillLoading: loading,
      });
      // Make sure tour is hidden if conditions aren't met
      if (featureTourCompleted || !onboardingCompleted) {
        setShowFeatureTour(false);
      }
    }
  }, [user, loading, user?.feature_tour_completed, user?.onboarding_completed, showFeatureTour]);

  useEffect(() => {
    if (user?.id) {
      loadCaptures();
    }
  }, [user?.id]);

  // Keep refs in sync with state
  useEffect(() => {
    autoSaveEnabledRef.current = autoSaveEnabled;
  }, [autoSaveEnabled]);

  useEffect(() => {
    isCapturingRef.current = isCapturing;
  }, [isCapturing]);

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

  const loadCaptures = async (preserveCurrent = false) => {
    if (!user?.id) {
      console.warn('[Dashboard] Skipping loadCaptures - no authenticated user');
      return;
    }
    try {
      console.log('[Dashboard] Loading captures...', preserveCurrent ? '(preserving current)' : '');
      const result = await window.electronAPI.getCaptures(user.id);
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

  const handleCapture = async () => {
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
      console.log('[Dashboard] Starting capture...');
      const result = await window.electronAPI.captureWorkspace({ userId: user.id });
      console.log('[Dashboard] Capture result:', result);
      
      if (result.success && result.data) {
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
          const refreshResult = await window.electronAPI.getCaptures(user.id);
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
        alert(`Capture failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[Dashboard] Failed to capture workspace:', error);
      alert(`Failed to capture workspace: ${error}`);
    } finally {
      setIsCapturing(false);
    }
  };

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
        <div className="text-white">Loading...</div>
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

  if (captures.length === 0) {
    return (
      <>
        {showFeatureTour && <FeatureTour onComplete={handleTourComplete} hasCaptures={false} />}
        <Header 
          onCapture={handleCapture} 
          isCapturing={isCapturing}
          autoSaveEnabled={autoSaveEnabled}
          onAutoSaveToggle={handleAutoSaveToggle}
        />
        <EmptyState onCapture={handleCapture} />
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {showFeatureTour && <FeatureTour onComplete={handleTourComplete} hasCaptures={captures.length > 0} />}
      <Header 
        onCapture={handleCapture} 
        isCapturing={isCapturing}
        autoSaveEnabled={autoSaveEnabled}
        onAutoSaveToggle={handleAutoSaveToggle}
      />

      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl">
          {currentCapture && (
            <div className="mb-8" data-tour="current-workspace">
              <header className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-2">Current Workspace Capture</h1>
                <p className="text-slate-400">
                  Last updated: {formatTimeAgo(currentCapture.created_at)} (Auto Refresh)
                </p>
              </header>

              <div className="grid grid-cols-1 gap-4" key={`current-assets-${refreshKey}`}>
                {currentAssets.length === 0 ? (
                  <div className="bg-[#1E293B]/60 rounded-xl p-4 border border-white/5 text-center">
                    <p className="text-slate-400">
                      {isCapturing ? 'Capturing assets...' : 'No assets found for this capture'}
                    </p>
                    <p className="text-xs text-slate-500 mt-2">Check console for details</p>
                    <p className="text-xs text-red-400 mt-1">Current capture ID: {currentCapture?.id}</p>
                  </div>
                ) : (
                  currentAssets.slice(0, 4).map((asset) => (
                    <Link
                      key={asset.id}
                      to={`/context/${currentCapture.id}`}
                      className="bg-[#1E293B]/60 rounded-xl p-4 border border-white/5 hover:border-white/10 transition-colors group"
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-1">
                          <span className={`material-symbols-outlined text-xl ${getAssetColor(asset.asset_type || 'other')}`}>
                            {getAssetIcon(asset.asset_type || 'other')}
                          </span>
                          <span className="text-white font-medium">{asset.title || 'Untitled Asset'}</span>
                        </div>
                      </div>

                      {asset.content && (
                        <div className="bg-[#0F172A]/80 rounded-lg p-4 border border-white/5">
                          <pre className="text-xs text-slate-300 font-mono leading-relaxed overflow-x-auto">
                            {asset.content.substring(0, 200)}
                            {asset.content.length > 200 && '...'}
                          </pre>
                        </div>
                      )}
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="mt-12" data-tour="capture-cards">
            <h2 className="text-2xl font-bold text-white mb-6">Recent Capture History</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" key={`captures-${refreshKey}`}>
              {captures.length === 0 ? (
                <p className="text-slate-400 col-span-full">No captures yet</p>
              ) : (
                captures.slice(0, 4).map((capture, index) => (
                  <div key={`capture-${capture.id}-${capture.created_at}-${refreshKey}`} data-tour={index === 0 ? "capture-card" : undefined}>
                    <CaptureCard capture={capture} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
