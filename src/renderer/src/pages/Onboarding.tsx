import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getCurrentTimezone, getFormattedTimezone, getCommonTimezones } from '../utils/dateUtils';

const onboardingSteps = [
  {
    title: 'Welcome to FlowState Dashboard',
    description: 'Capture and restore your complete development workspace context in seconds.',
    icon: 'dashboard',
    content: (
      <div className="space-y-4 text-slate-300 dark:text-slate-300 text-gray-700">
        <p>FlowState Dashboard helps you:</p>
        <ul className="list-disc list-inside space-y-2 ml-4">
          <li>Capture your entire workspace state</li>
          <li>Save browser tabs, terminal sessions, and code files</li>
          <li>Restore everything exactly as you left it</li>
          <li>Never lose your flow state again</li>
        </ul>
      </div>
    ),
  },
  {
    title: 'Capture Your Workspace',
    description: 'Save everything with one click.',
    icon: 'radio_button_checked',
    content: (
      <div className="space-y-4 text-slate-300 dark:text-slate-300 text-gray-700">
        <p>When you capture a workspace, we save:</p>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="p-4 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-white/5 dark:border-white/5 border-gray-200">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">language</span>
            <div className="font-semibold text-white dark:text-white text-gray-900">Browser Tabs</div>
            <div className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">All open tabs and URLs</div>
          </div>
          <div className="p-4 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-white/5 dark:border-white/5 border-gray-200">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">terminal</span>
            <div className="font-semibold text-white dark:text-white text-gray-900">Terminal</div>
            <div className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">Command history</div>
          </div>
          <div className="p-4 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-white/5 dark:border-white/5 border-gray-200">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">code</span>
            <div className="font-semibold text-white dark:text-white text-gray-900">Code Files</div>
            <div className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">Open files and content</div>
          </div>
          <div className="p-4 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-white/5 dark:border-white/5 border-gray-200">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">note</span>
            <div className="font-semibold text-white dark:text-white text-gray-900">Notes</div>
            <div className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">Your thoughts and ideas</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: 'Restore Instantly',
    description: 'Get back to work exactly where you left off.',
    icon: 'restore',
    content: (
      <div className="space-y-4 text-slate-300 dark:text-slate-300 text-gray-700">
        <p>Restoring a workspace will:</p>
        <div className="space-y-3 mt-4">
          <div className="flex items-start gap-3 p-3 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-white/5 dark:border-white/5 border-gray-200">
            <span className="material-symbols-outlined text-accent">check_circle</span>
            <div>
              <div className="font-semibold text-white dark:text-white text-gray-900">Reopen browser tabs</div>
              <div className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">All your saved URLs open automatically</div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-white/5 dark:border-white/5 border-gray-200">
            <span className="material-symbols-outlined text-accent">check_circle</span>
            <div>
              <div className="font-semibold text-white dark:text-white text-gray-900">Restore terminal state</div>
              <div className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">Continue where you left off</div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-white/5 dark:border-white/5 border-gray-200">
            <span className="material-symbols-outlined text-accent">check_circle</span>
            <div>
              <div className="font-semibold text-white dark:text-white text-gray-900">Access your files</div>
              <div className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">View and restore saved code</div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: 'Configure Your Preferences',
    description: 'Set up your workspace capture preferences.',
    icon: 'settings',
    content: null, // Will be rendered dynamically
  },
  {
    title: "You're All Set!",
    description: 'Start capturing your workspace and never lose your flow state.',
    icon: 'check_circle',
    content: (
      <div className="space-y-4 text-slate-300 dark:text-slate-300 text-gray-700 text-center">
        <p className="text-lg">Ready to get started?</p>
        <div className="p-6 bg-[#1E293B]/50 dark:bg-[#1E293B]/50 bg-gray-50 rounded-lg border border-accent/30 dark:border-accent/30 border-accent/40">
          <span className="material-symbols-outlined text-accent text-2xl mb-2 block">lightbulb</span>
          <p className="text-white dark:text-white text-gray-900 font-semibold mb-2">Pro Tip</p>
          <p className="text-sm">Capture your workspace before switching tasks or closing your computer. You'll thank yourself later!</p>
        </div>
      </div>
    ),
  },
];

function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const { user, completeOnboarding, loading } = useAuth();
  const navigate = useNavigate();
  
  // Preferences state
  const [timezone, setTimezone] = useState(getCurrentTimezone());
  const [retentionLimit, setRetentionLimit] = useState(100);
  const [captureInterval, setCaptureInterval] = useState(15);
  
  useEffect(() => {
    // Auto-detect timezone on mount
    setTimezone(getCurrentTimezone());
  }, []);

  // Show loading if user data is not ready
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] dark:from-[#0F172A] dark:via-[#1E293B] dark:to-[#0F172A] bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50">
        <div className="text-white dark:text-white text-gray-900">Loading...</div>
      </div>
    );
  }

  const handleNext = () => {
    if (currentStep < onboardingSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    if (user) {
      console.log('[Onboarding] Completing onboarding for user:', user.id);
      
      // Save preferences before completing onboarding
      try {
        await window.electronAPI.saveSettings({
          timezone,
          retentionLimit,
          autoSaveIntervalMinutes: captureInterval,
        }, user.id);
        console.log('[Onboarding] Preferences saved:', { timezone, retentionLimit, captureInterval });
      } catch (error) {
        console.error('[Onboarding] Failed to save preferences:', error);
        // Continue with onboarding even if preferences save fails
      }
      
      await completeOnboarding();
      
      // Track onboarding completion
      try {
        const { trackEvent } = await import('../utils/analytics');
        trackEvent('onboarding_completed');
      } catch (analyticsError) {
        // Don't fail if analytics fails
      }
      
      // Small delay to ensure state is updated in database
      await new Promise(resolve => setTimeout(resolve, 300));
      // Mark that we just completed onboarding so the tour shows on first dashboard visit
      sessionStorage.setItem('just_completed_onboarding', 'true');
      console.log('[Onboarding] Set just_completed_onboarding flag:', sessionStorage.getItem('just_completed_onboarding'));
      console.log('[Onboarding] Navigating to dashboard...');
      navigate('/');
    }
  };

  const handleSkip = async () => {
    if (user) {
      console.log('[Onboarding] Skipping onboarding for user:', user.id);
      
      // Save default preferences when skipping
      try {
        await window.electronAPI.saveSettings({
          timezone: getCurrentTimezone(),
          retentionLimit: 100,
          autoSaveIntervalMinutes: 15,
        }, user.id);
        console.log('[Onboarding] Default preferences saved on skip');
      } catch (error) {
        console.error('[Onboarding] Failed to save default preferences on skip:', error);
        // Continue with onboarding even if preferences save fails
      }
      
      await completeOnboarding();
      
      // Track onboarding skipped
      try {
        const { trackEvent } = await import('../utils/analytics');
        trackEvent('onboarding_skipped');
      } catch (analyticsError) {
        // Don't fail if analytics fails
      }
      
      // Small delay to ensure state is updated in database
      await new Promise(resolve => setTimeout(resolve, 300));
      // Mark that we just completed onboarding so the tour shows on first dashboard visit
      sessionStorage.setItem('just_completed_onboarding', 'true');
      console.log('[Onboarding] Set just_completed_onboarding flag:', sessionStorage.getItem('just_completed_onboarding'));
      console.log('[Onboarding] Navigating to dashboard...');
      navigate('/');
    }
  };

  const step = onboardingSteps[currentStep];
  const isLastStep = currentStep === onboardingSteps.length - 1;

  if (!step) {
    console.error('[Onboarding] No step data available!');
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] dark:from-[#0F172A] dark:via-[#1E293B] dark:to-[#0F172A] bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50">
        <div className="text-white dark:text-white text-gray-900">Error: No step data available</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] dark:from-[#0F172A] dark:via-[#1E293B] dark:to-[#0F172A] bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 p-6">
      <div className="w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">Step {currentStep + 1} of {onboardingSteps.length}</span>
            <button
              onClick={handleSkip}
              className="text-sm text-slate-400 dark:text-slate-400 text-gray-600 hover:text-slate-300 dark:hover:text-slate-300 hover:text-gray-900 transition-colors"
            >
              Skip
            </button>
          </div>
          <div className="w-full h-2 bg-[#1E293B] dark:bg-[#1E293B] bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${((currentStep + 1) / onboardingSteps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Content Card */}
        <div className="bg-[#1E293B]/80 dark:bg-[#1E293B]/80 bg-white backdrop-blur-sm rounded-2xl p-8 md:p-12 border border-white/10 dark:border-white/10 border-gray-200 shadow-2xl">
          {/* Icon and Title */}
          <div className="text-center mb-8">
            <div className="mb-4 flex justify-center">
              <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
                <span className="material-symbols-outlined text-accent text-5xl">{step.icon}</span>
              </div>
            </div>
            <h1 className="text-4xl font-bold text-white mb-3">{step.title}</h1>
            <p className="text-slate-400 text-lg">{step.description}</p>
          </div>

          {/* Step Content */}
          <div className="min-h-[300px] mb-8">
            {currentStep === onboardingSteps.length - 2 ? (
              // Preferences step
              <div className="space-y-6 text-slate-300 dark:text-slate-300 text-gray-700">
                {/* Timezone */}
                <div>
                  <label className="block text-sm font-medium text-white dark:text-white text-gray-900 mb-2">
                    Timezone
                  </label>
                  <div className="space-y-2">
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-4 py-2 bg-[#0F172A] dark:bg-[#0F172A] bg-gray-50 border border-white/10 dark:border-white/10 border-gray-300 rounded-lg text-white dark:text-white text-gray-900 focus:outline-none focus:border-accent"
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
                    <p className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">
                      Current: {getFormattedTimezone(timezone)} {timezone === getCurrentTimezone() && '(Auto-detected)'}
                    </p>
                  </div>
                </div>

                {/* Retention Limit */}
                <div>
                  <label className="block text-sm font-medium text-white dark:text-white text-gray-900 mb-2">
                    Maximum Saved Captures
                  </label>
                  <div className="space-y-3">
                    <input
                      type="range"
                      min="10"
                      max="500"
                      step="10"
                      value={retentionLimit}
                      onChange={(e) => setRetentionLimit(Number(e.target.value))}
                      className="w-full h-2 bg-[#0F172A] dark:bg-[#0F172A] bg-gray-200 rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">10</span>
                      <span className="text-lg font-semibold text-white dark:text-white text-gray-900">
                        {retentionLimit} captures
                      </span>
                      <span className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">500</span>
                    </div>
                    <p className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">
                      When you exceed this limit, older non-archived captures will be automatically deleted. Archived captures are never deleted.
                    </p>
                  </div>
                </div>

                {/* Capture Interval */}
                <div>
                  <label className="block text-sm font-medium text-white dark:text-white text-gray-900 mb-2">
                    Automatic Capture Interval
                  </label>
                  <div className="space-y-3">
                    <select
                      value={captureInterval}
                      onChange={(e) => setCaptureInterval(Number(e.target.value))}
                      className="w-full px-4 py-2 bg-[#0F172A] dark:bg-[#0F172A] bg-gray-50 border border-white/10 dark:border-white/10 border-gray-300 rounded-lg text-white dark:text-white text-gray-900 focus:outline-none focus:border-accent"
                    >
                      <option value={5}>Every 5 minutes</option>
                      <option value={10}>Every 10 minutes</option>
                      <option value={15}>Every 15 minutes</option>
                      <option value={30}>Every 30 minutes</option>
                      <option value={60}>Every hour</option>
                      <option value={120}>Every 2 hours</option>
                    </select>
                    <p className="text-sm text-slate-400 dark:text-slate-400 text-gray-600">
                      How often FlowState will automatically capture your workspace when automatic capture is enabled.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              step.content
            )}
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={handleBack}
              disabled={currentStep === 0}
              className="px-6 py-3 bg-[#0F172A] hover:bg-[#1E293B] disabled:bg-[#0F172A]/50 disabled:cursor-not-allowed disabled:text-slate-600 text-white rounded-lg transition-colors font-medium border border-white/10 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">arrow_back</span>
              Back
            </button>

            <button
              onClick={handleNext}
              className="px-8 py-3 bg-accent hover:bg-accent/90 text-[#0F172A] rounded-lg transition-all font-medium shadow-lg shadow-accent/20 flex items-center gap-2 ml-auto"
            >
              {isLastStep ? (
                <>
                  Get Started
                  <span className="material-symbols-outlined text-sm">rocket_launch</span>
                </>
              ) : (
                <>
                  Next
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </>
              )}
            </button>
          </div>

          {/* Step Indicators */}
          <div className="flex items-center justify-center gap-2 mt-8">
            {onboardingSteps.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentStep(index)}
                className={`w-2 h-2 rounded-full transition-all ${
                  index === currentStep
                    ? 'w-8 bg-accent'
                    : index < currentStep
                    ? 'bg-accent/50'
                    : 'bg-slate-600'
                }`}
                aria-label={`Go to step ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Onboarding;

