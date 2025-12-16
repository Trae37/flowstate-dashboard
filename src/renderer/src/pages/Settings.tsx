import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import FeatureTour from '../components/FeatureTour';
import { getCurrentTimezone, getFormattedTimezone, getCommonTimezones } from '../utils/dateUtils';

interface SettingsState {
  smartCapture: boolean;
  autoRestore: boolean;
  autoSaveEnabled: boolean;
  autoSaveIntervalMinutes: number;
  batterySaverEnabled: boolean;
  analyticsEnabled: boolean;
  timezone?: string;
  retentionLimit?: number;
}

function Settings() {
  const [settings, setSettings] = useState<SettingsState>({
    smartCapture: false,
    autoRestore: false,
    autoSaveEnabled: false,
    autoSaveIntervalMinutes: 15,
    batterySaverEnabled: false,
    analyticsEnabled: false, // Default to disabled for privacy
    timezone: getCurrentTimezone(),
    retentionLimit: 100,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [browserLaunching, setBrowserLaunching] = useState<Record<string, boolean>>({});
  const [browserMessages, setBrowserMessages] = useState<Record<string, string>>({});
  const [browsersWithoutDebug, setBrowsersWithoutDebug] = useState<string[]>([]);
  const { user, completeFeatureTour } = useAuth();
  const [showFeatureTour, setShowFeatureTour] = useState(false);
  const tourInitializedRef = useRef(false);

  useEffect(() => {
    if (user?.id) {
      loadSettings();
      checkBrowsersWithoutDebugging();
      // Check periodically for browsers without debugging
      const interval = setInterval(checkBrowsersWithoutDebugging, 5000);
      return () => clearInterval(interval);
    }
  }, [user?.id]);

  // Feature tour continuation
  useEffect(() => {
    if (showFeatureTour || tourInitializedRef.current ||
        sessionStorage.getItem('feature_tour_completed') === 'true') {
      return;
    }

    const tourInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
    const tourPhase = sessionStorage.getItem('feature_tour_phase');

    console.log('[Settings] Tour check:', { tourInProgress, tourPhase, loading, userTourCompleted: user?.feature_tour_completed });

    if (tourInProgress && tourPhase === 'settings' && !loading && user && !user.feature_tour_completed) {
      console.log('[Settings] Continuing tour on settings page');
      tourInitializedRef.current = true;
      // Small delay to let the page render
      setTimeout(() => {
        setShowFeatureTour(true);
      }, 500);
    }
  }, [user, loading, user?.feature_tour_completed, showFeatureTour]);

  const checkBrowsersWithoutDebugging = async () => {
    try {
      const result = await window.electronAPI.getBrowsersWithoutDebugging();
      if (result.success && result.data) {
        setBrowsersWithoutDebug(result.data);
      }
    } catch (error) {
      // Silently fail - this is just for UI display
    }
  };

  const loadSettings = async () => {
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

        setSettings({
          smartCapture: parseBoolean(data.smartCapture),
          autoRestore: parseBoolean(data.autoRestore),
          autoSaveEnabled: parseBoolean(data.autoSaveEnabled),
          autoSaveIntervalMinutes: parseNumber(data.autoSaveIntervalMinutes, 15),
          batterySaverEnabled: data.batterySaverEnabled === undefined
            ? false
            : parseBoolean(data.batterySaverEnabled, false),
          analyticsEnabled: data.analyticsEnabled === undefined
            ? false
            : parseBoolean(data.analyticsEnabled, false),
          timezone: data.timezone || getCurrentTimezone(),
          retentionLimit: parseNumber(data.retentionLimit, 100),
        });
      } else {
        setSettings((prev) => ({ ...prev }));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) {
      setSaveMessage('Please sign in again.');
      return;
    }
    setSaving(true);
    setSaveMessage('');
    
    try {
      const result = await window.electronAPI.saveSettings(settings, user.id);
      if (result.success) {
        setSaveMessage('Settings saved successfully!');
        setTimeout(() => setSaveMessage(''), 3000);
        
        // Update analytics if the setting changed
        try {
          const { analytics } = await import('../utils/analytics');
          await analytics.setEnabled(settings.analyticsEnabled);
          
          // Re-initialize analytics if enabled
          if (settings.analyticsEnabled) {
            const settingsResult = await window.electronAPI.getSettings(user.id);
            if (settingsResult.success && settingsResult.data) {
              await analytics.initialize(user.id, {
                enabled: settings.analyticsEnabled,
                posthogApiKey: settingsResult.data.posthogApiKey,
                posthogHost: settingsResult.data.posthogHost,
              });
              analytics.track('analytics_enabled');
            }
          } else {
            analytics.track('analytics_disabled');
          }
        } catch (analyticsError) {
          // Don't fail settings save if analytics update fails
          console.warn('Failed to update analytics:', analyticsError);
        }
      } else {
        setSaveMessage('Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const toggleSmartCapture = () => {
    setSettings(prev => ({ ...prev, smartCapture: !prev.smartCapture }));
  };

  const toggleAutoRestore = () => {
    setSettings(prev => ({ ...prev, autoRestore: !prev.autoRestore }));
  };

  const toggleAutoSave = () => {
    setSettings(prev => ({ ...prev, autoSaveEnabled: !prev.autoSaveEnabled }));
  };

  const handleIntervalChange = (minutes: number) => {
    setSettings(prev => ({ ...prev, autoSaveIntervalMinutes: minutes }));
  };

  const toggleBatterySaver = () => {
    setSettings(prev => ({ ...prev, batterySaverEnabled: !prev.batterySaverEnabled }));
  };

  const toggleAnalytics = () => {
    setSettings(prev => ({ ...prev, analyticsEnabled: !prev.analyticsEnabled }));
  };

  const handleLaunchBrowser = async (browserName: string) => {
    setBrowserLaunching(prev => ({ ...prev, [browserName]: true }));
    setBrowserMessages(prev => ({ ...prev, [browserName]: '' }));
    
    try {
      // Check if browser is already running without debugging
      const isRunningWithoutDebug = browsersWithoutDebug.includes(browserName);
      
      let result;
      if (isRunningWithoutDebug) {
        // Browser is running - prompt user to close and relaunch
        result = await window.electronAPI.promptCloseAndRelaunchBrowser(browserName);
        if (result.cancelled) {
          setBrowserMessages(prev => ({ 
            ...prev, 
            [browserName]: 'Cancelled' 
          }));
          return;
        }
      } else {
        // Browser not running or already has debugging - just launch
        result = await window.electronAPI.launchBrowserWithDebugging(browserName);
      }
      
      if (result.success) {
        setBrowserMessages(prev => ({ 
          ...prev, 
          [browserName]: `${browserName} ${isRunningWithoutDebug ? 'relaunched' : 'launched'} successfully! Wait a few seconds for it to fully start, then capture your workspace.` 
        }));
        // Refresh browser status
        await checkBrowsersWithoutDebugging();
        // Clear message after 5 seconds
        setTimeout(() => {
          setBrowserMessages(prev => {
            const newMessages = { ...prev };
            delete newMessages[browserName];
            return newMessages;
          });
        }, 5000);
      } else {
        setBrowserMessages(prev => ({ 
          ...prev, 
          [browserName]: result.error || `Failed to ${isRunningWithoutDebug ? 'relaunch' : 'launch'} ${browserName}` 
        }));
      }
    } catch (error) {
      setBrowserMessages(prev => ({ 
        ...prev, 
        [browserName]: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }));
    } finally {
      setBrowserLaunching(prev => ({ ...prev, [browserName]: false }));
    }
  };

  const handleTourComplete = async () => {
    console.log('[Settings] Tour completed');
    tourInitializedRef.current = true;
    setShowFeatureTour(false);
    sessionStorage.removeItem('feature_tour_in_progress');
    sessionStorage.removeItem('feature_tour_phase');
    sessionStorage.setItem('feature_tour_completed', 'true');
    if (user) {
      await completeFeatureTour();
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#1a1d35] via-[#1e2542] to-[#151829] dark:from-[#1a1d35] dark:via-[#1e2542] dark:to-[#151829] bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50">
        <div className="text-gray-900 dark:text-white">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 bg-gradient-to-br from-[#1a1d35] via-[#1e2542] to-[#151829] dark:from-[#1a1d35] dark:via-[#1e2542] dark:to-[#151829] bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between" data-tour="settings-header">
          <Link
            to="/"
            className="flex items-center gap-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            data-tour="settings-back-button"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            <span>Back to Dashboard</span>
          </Link>
        </div>

        <div className="mb-8">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-3">Settings</h1>
          <p className="text-gray-600 dark:text-slate-400 text-lg">
            Configure your Flow State Dashboard
          </p>
        </div>

        {/* Settings Cards */}
        <div className="space-y-6">
          {/* Capture Settings */}
          <div className="bg-gray-200 dark:bg-[#1E293B]/60 rounded-2xl p-6 border border-gray-300 dark:border-white/5" data-tour="settings-capture">
            <div className="flex items-center gap-3 mb-6">
              <span className="material-symbols-outlined text-accent text-2xl">
                camera_alt
              </span>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Capture Settings</h2>
            </div>

            {/* Smart Capture Toggle */}
            <div className="space-y-4">
              <div className="flex items-start justify-between p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-white dark:text-white">Smart Capture</h3>
                    <span className="px-2 py-1 text-xs font-medium bg-accent/20 dark:bg-accent/20 text-accent dark:text-accent rounded">
                      Recommended
                    </span>
                  </div>
                  <p className="text-white dark:text-slate-400 text-sm leading-relaxed">
                    Automatically filter out idle terminals and unnecessary sessions during capture. 
                    This keeps your captures clean by excluding:
                  </p>
                  <ul className="mt-2 ml-4 text-white dark:text-slate-400 text-sm space-y-1">
                    <li className="flex items-start gap-2">
                      <span className="text-accent">•</span>
                      <span>Empty terminals with no command history</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent">•</span>
                      <span>Terminals in default home directory with no activity</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent">•</span>
                      <span>System-spawned background processes</span>
                    </li>
                  </ul>
                </div>
                <button
                  onClick={toggleSmartCapture}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-[#0F172A] ${
                    settings.smartCapture ? 'bg-accent' : 'bg-white/20'
                  }`}
                  role="switch"
                  aria-checked={settings.smartCapture}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.smartCapture ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Auto Save Toggle */}
              <div className="flex items-start justify-between p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex-1 pr-4">
                  <h3 className="text-lg font-semibold text-white dark:text-white mb-2">Automatic Workspace Capture</h3>
                  <p className="text-white dark:text-slate-400 text-sm leading-relaxed">
                    Automatically capture your entire workspace at a fixed interval, even when the app is minimized.
                    Use this to keep a continuous history of your context without lifting a finger.
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <label className="text-sm text-white dark:text-slate-400">Interval</label>
                    <select
                      value={settings.autoSaveIntervalMinutes}
                      onChange={(e) => handleIntervalChange(Number(e.target.value))}
                      className="bg-[#0F172A] dark:bg-[#0F172A] border border-accent/30 rounded-lg text-white dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                      disabled={!settings.autoSaveEnabled}
                    >
                      {[5, 10, 15, 30, 60, 120].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          Every {minutes} {minutes === 1 ? 'minute' : minutes < 60 ? 'minutes' : minutes === 60 ? 'hour' : 'hours'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={toggleAutoSave}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-[#0F172A] ${
                    settings.autoSaveEnabled ? 'bg-accent' : 'bg-white/20'
                  }`}
                  role="switch"
                  aria-checked={settings.autoSaveEnabled}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.autoSaveEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Battery Saver */}
              <div className="flex items-start justify-between p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex-1 pr-4">
                  <h3 className="text-lg font-semibold text-white dark:text-white mb-2">Battery Saver</h3>
                  <p className="text-white dark:text-slate-400 text-sm leading-relaxed">
                    Pause automatic captures whenever your laptop is running on battery or when the dashboard window
                    is in the background. Keep it on to minimize system impact.
                  </p>
                </div>
                <button
                  onClick={toggleBatterySaver}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-[#0F172A] ${
                    settings.batterySaverEnabled ? 'bg-accent' : 'bg-white/20'
                  }`}
                  role="switch"
                  aria-checked={settings.batterySaverEnabled}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.batterySaverEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-gray-200 dark:bg-[#1E293B]/60 rounded-2xl p-6 border border-gray-300 dark:border-white/5">
            <div className="flex items-center gap-3 mb-6">
              <span className="material-symbols-outlined text-accent text-2xl">
                tune
              </span>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Preferences</h2>
            </div>

            <div className="space-y-4">
              {/* Timezone */}
              <div className="p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <h3 className="text-lg font-semibold text-white dark:text-white mb-2">Timezone</h3>
                <p className="text-white dark:text-slate-400 text-sm leading-relaxed mb-3">
                  Your timezone is used to display dates and times correctly. If auto-detection is incorrect, you can manually select your timezone.
                </p>
                <div className="space-y-2">
                  <select
                    value={settings.timezone || getCurrentTimezone()}
                    onChange={(e) => setSettings(prev => ({ ...prev, timezone: e.target.value }))}
                    className="w-full px-4 py-2 bg-[#0F172A] dark:bg-[#0F172A] bg-gray-50 border border-accent/30 dark:border-accent/30 border-gray-300 rounded-lg text-white dark:text-white text-gray-900 focus:outline-none focus:border-accent"
                  >
                    {getCommonTimezones().map((group) => (
                      <optgroup key={group.region} label={group.region}>
                        {group.timezones.map((tz) => (
                          <option key={tz.value} value={tz.value}>
                            {tz.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 dark:text-slate-400 text-gray-600">
                    Current: {getFormattedTimezone(settings.timezone || getCurrentTimezone())}
                    {(!settings.timezone || settings.timezone === getCurrentTimezone()) && ' (Auto-detected)'}
                  </p>
                </div>
              </div>

              {/* Retention Limit */}
              <div className="p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <h3 className="text-lg font-semibold text-white dark:text-white mb-2">Maximum Saved Captures</h3>
                <p className="text-white dark:text-slate-400 text-sm leading-relaxed mb-3">
                  When you exceed this limit, older non-archived captures will be automatically deleted. Archived captures are never deleted.
                </p>
                <div className="space-y-3">
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={settings.retentionLimit || 100}
                    onChange={(e) => setSettings(prev => ({ ...prev, retentionLimit: Number(e.target.value) }))}
                    className="w-full h-2 bg-[#0F172A] dark:bg-[#0F172A] bg-gray-200 rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">10</span>
                    <span className="text-lg font-semibold text-white dark:text-white text-gray-900">
                      {settings.retentionLimit || 100} captures
                    </span>
                    <span className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">500</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Privacy & Analytics Settings */}
          <div className="bg-gray-200 dark:bg-[#1E293B]/60 rounded-2xl p-6 border border-gray-300 dark:border-white/5">
            <div className="flex items-center gap-3 mb-6">
              <span className="material-symbols-outlined text-green-400 dark:text-green-400 text-green-600 text-2xl">
                privacy_tip
              </span>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Privacy & Analytics</h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-start justify-between p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-white dark:text-white">Usage Analytics</h3>
                  </div>
                  <p className="text-white dark:text-slate-400 text-sm leading-relaxed mb-2">
                    Help improve FlowState by sharing anonymous usage data. We track:
                  </p>
                  <ul className="ml-4 text-white dark:text-slate-400 text-sm space-y-1 mb-2">
                    <li className="flex items-start gap-2">
                      <span className="text-accent">•</span>
                      <span>Feature usage (which buttons you click, pages you visit)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent">•</span>
                      <span>Error events (to help fix bugs)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-accent">•</span>
                      <span>Performance metrics (capture duration, success rates)</span>
                    </li>
                  </ul>
                  <p className="text-white/80 dark:text-slate-500 text-xs italic">
                    We never track: code content, file paths, terminal commands, browser URLs, or any sensitive data.
                  </p>
                </div>
                <button
                  onClick={toggleAnalytics}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-[#0F172A] ${
                    settings.analyticsEnabled ? 'bg-accent' : 'bg-white/20'
                  }`}
                  role="switch"
                  aria-checked={settings.analyticsEnabled}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.analyticsEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Browser Debugging Settings */}
          <div className="bg-gray-200 dark:bg-[#1E293B]/60 rounded-2xl p-6 border border-gray-300 dark:border-white/5" data-tour="settings-browser">
            <div className="flex items-center gap-3 mb-6">
              <span className="material-symbols-outlined text-blue-400 dark:text-blue-400 text-blue-600 text-2xl">
                public
              </span>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Browser Debugging</h2>
            </div>

            <div className="mb-4 p-4 bg-[#1E293B] dark:bg-blue-500/10 rounded-lg">
              <p className="text-white dark:text-blue-300/80 text-sm leading-relaxed">
                To capture browser tabs, browsers must be launched with remote debugging enabled. 
                Click the buttons below to launch your browser with debugging enabled. 
                <strong className="text-white dark:text-blue-200"> If the browser is already running, it will be automatically closed and restarted</strong> with debugging enabled.
              </p>
            </div>

            <div className="space-y-3">
              {/* Chrome */}
              <div className="p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-white dark:text-white font-semibold">Google Chrome</span>
                    <span className="px-2 py-1 text-xs font-medium bg-white/10 dark:bg-white/10 text-white dark:text-slate-300 rounded">
                      Port 9222
                    </span>
                  </div>
                  <button
                    onClick={() => handleLaunchBrowser('Chrome')}
                    disabled={browserLaunching.Chrome}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 disabled:bg-accent/50 disabled:cursor-not-allowed text-[#0F172A] rounded-lg transition-colors font-medium text-sm flex items-center gap-2"
                  >
                    {browserLaunching.Chrome ? (
                      <>
                        <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                        Launching...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">launch</span>
                        Enable Debugging
                      </>
                    )}
                  </button>
                </div>
                {browserMessages.Chrome && (
                  <div className={`mt-2 p-2 rounded text-xs ${
                    browserMessages.Chrome.includes('successfully') 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {browserMessages.Chrome}
                  </div>
                )}
              </div>

              {/* Brave */}
              <div className="p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 flex items-center gap-3">
                    <span className="text-white dark:text-white font-semibold">Brave Browser</span>
                    <span className="px-2 py-1 text-xs font-medium bg-white/10 dark:bg-white/10 text-white dark:text-slate-300 rounded">
                      Port 9222
                    </span>
                    {browsersWithoutDebug.includes('Brave') && (
                      <span className="text-xs text-yellow-400 dark:text-yellow-300">
                        ⚠️ Running without debugging
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleLaunchBrowser('Brave')}
                    disabled={browserLaunching.Brave}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 disabled:bg-accent/50 disabled:cursor-not-allowed text-[#0F172A] rounded-lg transition-colors font-medium text-sm flex items-center gap-2"
                  >
                    {browserLaunching.Brave ? (
                      <>
                        <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                        Launching...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">launch</span>
                        Enable Debugging
                      </>
                    )}
                  </button>
                </div>
                {browserMessages.Brave && (
                  <div className={`mt-2 p-2 rounded text-xs ${
                    browserMessages.Brave.includes('successfully')
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {browserMessages.Brave}
                  </div>
                )}
              </div>

              {/* Edge */}
              <div className="p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1 flex items-center gap-3">
                    <span className="text-white dark:text-white font-semibold">Microsoft Edge</span>
                    <span className="px-2 py-1 text-xs font-medium bg-white/10 dark:bg-white/10 text-white dark:text-slate-300 rounded">
                      Port 9223
                    </span>
                    {browsersWithoutDebug.includes('Edge') && (
                      <span className="text-xs text-yellow-400 dark:text-yellow-300">
                        ⚠️ Running without debugging
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleLaunchBrowser('Edge')}
                    disabled={browserLaunching.Edge}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 disabled:bg-accent/50 disabled:cursor-not-allowed text-[#0F172A] rounded-lg transition-colors font-medium text-sm flex items-center gap-2"
                  >
                    {browserLaunching.Edge ? (
                      <>
                        <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                        Launching...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">launch</span>
                        Enable Debugging
                      </>
                    )}
                  </button>
                </div>
                {browserMessages.Edge && (
                  <div className={`mt-2 p-2 rounded text-xs ${
                    browserMessages.Edge.includes('successfully')
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {browserMessages.Edge}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Restore Settings */}
          <div className="bg-gray-200 dark:bg-[#1E293B]/60 rounded-2xl p-6 border border-gray-300 dark:border-white/5">
            <div className="flex items-center gap-3 mb-6">
              <span className="material-symbols-outlined text-green-400 dark:text-green-400 text-green-600 text-2xl">
                restore
              </span>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Restore Settings</h2>
            </div>

            {/* Auto Restore Toggle */}
            <div className="space-y-4">
              <div className="flex items-start justify-between p-4 bg-[#1E293B] dark:bg-[#0F172A]/50 rounded-lg">
                <div className="flex-1 pr-4">
                  <h3 className="text-lg font-semibold text-white dark:text-white mb-2">Auto Restore on Startup</h3>
                  <p className="text-white dark:text-slate-400 text-sm leading-relaxed">
                    Automatically restore the most recent capture when Flow State Dashboard launches.
                    This helps you get back to work faster after system restarts or crashes.
                  </p>
                </div>
                <button
                  onClick={toggleAutoRestore}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-[#0F172A] ${
                    settings.autoRestore ? 'bg-green-500' : 'bg-white/20'
                  }`}
                  role="switch"
                  aria-checked={settings.autoRestore}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.autoRestore ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-8 py-3 bg-accent hover:bg-accent/90 disabled:bg-accent/50 text-[#0F172A] rounded-lg transition-colors font-semibold text-lg flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined animate-spin">refresh</span>
                Saving...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">save</span>
                Save Settings
              </>
            )}
          </button>
          
          {saveMessage && (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
              saveMessage.includes('successfully') 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-red-500/20 text-red-400'
            }`}>
              <span className="material-symbols-outlined text-sm">
                {saveMessage.includes('successfully') ? 'check_circle' : 'error'}
              </span>
              <span className="text-sm font-medium">{saveMessage}</span>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="mt-8 p-4 bg-blue-500/10 dark:bg-blue-500/10 bg-blue-50 border border-blue-500/20 dark:border-blue-500/20 border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-blue-400 dark:text-blue-400 text-blue-600 text-xl">
              info
            </span>
            <div>
              <h4 className="text-blue-400 dark:text-blue-400 text-blue-800 font-semibold mb-1">About Settings</h4>
              <p className="text-blue-300/80 dark:text-blue-300/80 text-blue-700 text-sm">
                Settings are saved locally in your Flow State database. Changes take effect immediately after saving.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Tour */}
      {showFeatureTour && <FeatureTour onComplete={handleTourComplete} />}
    </div>
  );
}

export default Settings;
