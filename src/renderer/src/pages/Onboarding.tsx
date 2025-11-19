import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const onboardingSteps = [
  {
    title: 'Welcome to FlowState Dashboard',
    description: 'Capture and restore your complete development workspace context in seconds.',
    icon: 'dashboard',
    content: (
      <div className="space-y-4 text-slate-300">
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
      <div className="space-y-4 text-slate-300">
        <p>When you capture a workspace, we save:</p>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="p-4 bg-[#1E293B]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">language</span>
            <div className="font-semibold text-white">Browser Tabs</div>
            <div className="text-sm text-slate-400">All open tabs and URLs</div>
          </div>
          <div className="p-4 bg-[#1E293B]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">terminal</span>
            <div className="font-semibold text-white">Terminal</div>
            <div className="text-sm text-slate-400">Command history</div>
          </div>
          <div className="p-4 bg-[#1E293B]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">code</span>
            <div className="font-semibold text-white">Code Files</div>
            <div className="text-sm text-slate-400">Open files and content</div>
          </div>
          <div className="p-4 bg-[#1E293B]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-accent text-3xl mb-2 block">note</span>
            <div className="font-semibold text-white">Notes</div>
            <div className="text-sm text-slate-400">Your thoughts and ideas</div>
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
      <div className="space-y-4 text-slate-300">
        <p>Restoring a workspace will:</p>
        <div className="space-y-3 mt-4">
          <div className="flex items-start gap-3 p-3 bg-[#1E293B]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-accent">check_circle</span>
            <div>
              <div className="font-semibold text-white">Reopen browser tabs</div>
              <div className="text-sm text-slate-400">All your saved URLs open automatically</div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-[#1E293B]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-accent">check_circle</span>
            <div>
              <div className="font-semibold text-white">Restore terminal state</div>
              <div className="text-sm text-slate-400">Continue where you left off</div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-[#1E293B]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-accent">check_circle</span>
            <div>
              <div className="font-semibold text-white">Access your files</div>
              <div className="text-sm text-slate-400">View and restore saved code</div>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "You're All Set!",
    description: 'Start capturing your workspace and never lose your flow state.',
    icon: 'check_circle',
    content: (
      <div className="space-y-4 text-slate-300 text-center">
        <p className="text-lg">Ready to get started?</p>
        <div className="p-6 bg-[#1E293B]/50 rounded-lg border border-accent/30">
          <span className="material-symbols-outlined text-accent text-2xl mb-2 block">lightbulb</span>
          <p className="text-white font-semibold mb-2">Pro Tip</p>
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

  // Show loading if user data is not ready
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A]">
        <div className="text-white">Loading...</div>
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
      await completeOnboarding();
      // Small delay to ensure state is updated
      await new Promise(resolve => setTimeout(resolve, 100));
      navigate('/');
    }
  };

  const handleSkip = async () => {
    if (user) {
      await completeOnboarding();
      navigate('/');
    }
  };

  const step = onboardingSteps[currentStep];
  const isLastStep = currentStep === onboardingSteps.length - 1;

  if (!step) {
    console.error('[Onboarding] No step data available!');
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A]">
        <div className="text-white">Error: No step data available</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#1E293B] to-[#0F172A] p-6">
      <div className="w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Step {currentStep + 1} of {onboardingSteps.length}</span>
            <button
              onClick={handleSkip}
              className="text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              Skip
            </button>
          </div>
          <div className="w-full h-2 bg-[#1E293B] rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${((currentStep + 1) / onboardingSteps.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Content Card */}
        <div className="bg-[#1E293B]/80 backdrop-blur-sm rounded-2xl p-8 md:p-12 border border-white/10 shadow-2xl">
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
            {step.content}
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

