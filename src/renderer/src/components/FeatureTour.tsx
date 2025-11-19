import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface TourStep {
  id: string;
  target?: string; // CSS selector or data attribute (optional for page-level descriptions)
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  action?: 'navigate' | 'click'; // Optional action to perform
  navigateTo?: string; // Route to navigate to
  noHighlight?: boolean; // If true, don't highlight an element, just show the card centered
}

// Tour steps are defined per route
const getDashboardTourSteps = (hasCaptures: boolean = true): TourStep[] => {
  const baseSteps: TourStep[] = [
  {
    id: 'capture-button',
    target: '[data-tour="capture-button"]',
    title: 'Capture Your Workspace',
    description: 'Click this button to save your current workspace state. It captures all open browser tabs, terminal sessions, code files, and notes in one click.',
    position: 'bottom',
  },
  {
    id: 'auto-save',
    target: '[data-tour="auto-save"]',
    title: 'Automatic Save',
    description: 'Enable this toggle to automatically capture your workspace at regular intervals. Great for ensuring you never lose your work.',
    position: 'bottom',
  },
  {
    id: 'current-workspace',
    title: 'Current Workspace',
    description: 'This shows your most recent capture with a preview of saved assets. You can see browser tabs, terminal history, code files, and notes.',
    position: 'center',
    noHighlight: true,
  },
  ];
  
  // Only add capture-related steps if there are captures
  // Dashboard tour should have exactly 5 steps total (3 base + 2 capture steps)
  if (hasCaptures) {
    baseSteps.push(
      {
        id: 'capture-cards',
        title: 'Workspace Captures',
        description: 'View all your saved workspace captures here. Each card represents a saved workspace state with all your browser tabs, terminal sessions, code files, and notes.',
        position: 'center',
        noHighlight: true,
      },
      {
        id: 'example-capture',
        target: '[data-tour="capture-card"]',
        title: 'Example Capture',
        description: 'This is an example capture showing what your saved workspaces look like. Click on any capture card to open the detailed view where you can see all assets and restore them individually or all at once.',
        position: 'center',
        action: 'click',
      }
    );
  }
  
  // Dashboard tour ends here (5 steps total: 3 base + 2 capture steps if hasCaptures)
  // Settings and user-menu are not part of the onboarding tour
  return baseSteps;
};

const getDetailTourSteps = (): TourStep[] => [
  {
    id: 'detail-view-intro',
    title: 'Capture Detail View',
    description: 'This is the detailed view of a capture. Here you can see all the assets that were saved - browser tabs, terminal sessions, code files, and notes. You can search, filter, and restore them.',
    position: 'center',
    noHighlight: true,
  },
  {
    id: 'restore-all-button',
    target: '[data-tour="restore-all-button"]',
    title: 'Restore All Assets',
    description: 'Click this button to restore all assets from this capture at once. This will reopen all browser tabs, terminal sessions, code files, and notes.',
    position: 'bottom',
  },
  {
    id: 'asset-card-restore',
    target: '[data-tour="asset-restore-button"]',
    title: 'Restore Individual Assets',
    description: 'Each asset card has its own restore button. Click it to restore just that specific browser tab, terminal session, code file, or note.',
    position: 'top',
  },
  {
    id: 'back-to-dashboard',
    target: '[data-tour="back-to-dashboard"]',
    title: 'Back to Dashboard',
    description: 'Click here to return to the main dashboard and view all your captures.',
    position: 'bottom',
  },
];

interface FeatureTourProps {
  onComplete: () => void;
  hasCaptures?: boolean; // Whether there are captures to show
}

function FeatureTour({ onComplete, hasCaptures = true }: FeatureTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get tour steps based on current route - memoized to prevent unnecessary recalculations
  const tourSteps = useMemo(() => {
    if (location.pathname.startsWith('/context/')) {
      return getDetailTourSteps();
    }
    return getDashboardTourSteps(hasCaptures);
  }, [location.pathname, hasCaptures]);
  
  // Reset step to 0 when route changes during tour (dashboard -> detail view)
  useEffect(() => {
    const tourInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
    if (tourInProgress) {
      // If we're on detail page and step is still pointing to dashboard steps, reset
      if (location.pathname.startsWith('/context/') && currentStep >= getDashboardTourSteps(hasCaptures).length) {
        setCurrentStep(0);
      }
    }
  }, [location.pathname, currentStep, hasCaptures]);

  const updateTooltipPosition = (element: HTMLElement, position: string) => {
    const rect = element.getBoundingClientRect();
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = rect.top + scrollY - 10;
        left = rect.left + scrollX + rect.width / 2;
        break;
      case 'bottom':
        top = rect.bottom + scrollY + 10;
        left = rect.left + scrollX + rect.width / 2;
        break;
      case 'left':
        top = rect.top + scrollY + rect.height / 2;
        left = rect.left + scrollX - 10;
        break;
      case 'right':
        top = rect.top + scrollY + rect.height / 2;
        left = rect.right + scrollX + 10;
        break;
      case 'center':
        top = rect.top + scrollY + rect.height / 2;
        left = rect.left + scrollX + rect.width / 2;
        break;
    }

    setTooltipPosition({ top, left });
  };

  // Note: Route change handling is now done in the main useEffect via location.pathname dependency

  useEffect(() => {
    if (currentStep < tourSteps.length) {
      const step = tourSteps[currentStep];
      
      // If this is a page-level description (noHighlight), don't try to find an element
      if (step.noHighlight || !step.target) {
        // Just center the tooltip, no element highlighting needed
        setTargetElement(null);
        // Set tooltip to center of screen
        setTooltipPosition({ 
          top: window.innerHeight / 2, 
          left: window.innerWidth / 2 
        });
        return;
      }
      
      // Find and setup element immediately (no delay for instant transitions)
      const findAndSetupElement = (): HTMLElement | null => {
        try {
          const element = document.querySelector(step.target!) as HTMLElement;
          
          if (element) {
            console.log(`[FeatureTour] Element found: ${step.target} for step ${currentStep + 1} (${step.title})`);
            setTargetElement(element);
            updateTooltipPosition(element, step.position);
            
            // Scroll element into view instantly (no smooth animation)
            try {
              element.scrollIntoView({ behavior: 'instant', block: 'center' });
            } catch (scrollError) {
              // Fallback for browsers that don't support 'instant'
              element.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
            
            // Highlight element immediately (no transition delay)
            element.style.transition = 'none';
            element.style.zIndex = '1000';
            element.style.position = 'relative';

            // Update position on scroll/resize
            const handleUpdate = () => {
              try {
                if (element && element.isConnected) {
                  updateTooltipPosition(element, step.position);
                }
              } catch (err) {
                console.warn('[FeatureTour] Error updating tooltip position:', err);
              }
            };

            window.addEventListener('scroll', handleUpdate, true);
            window.addEventListener('resize', handleUpdate);

            return element;
          } else {
            // Element not found - log for debugging
            console.log(`[FeatureTour] Element not found: ${step.target} (step ${currentStep + 1}/${tourSteps.length} - ${step.title})`);
            console.log(`[FeatureTour] Available elements with data-tour:`, 
              Array.from(document.querySelectorAll('[data-tour]')).map(el => el.getAttribute('data-tour'))
            );
            return null;
          }
        } catch (error) {
          console.error(`[FeatureTour] Error in findAndSetupElement for step ${currentStep + 1}:`, error);
          return null;
        }
      };

      // Try to find element immediately
      let foundElement: HTMLElement | null = null;
      let cleanup: (() => void) | null = null;
      
      try {
        foundElement = findAndSetupElement();
        if (foundElement) {
          // Store the event handlers for proper cleanup
          const handleUpdate = () => {
            try {
              if (foundElement && foundElement.isConnected) {
                updateTooltipPosition(foundElement, step.position);
              }
            } catch (err) {
              console.warn('[FeatureTour] Error updating tooltip position:', err);
            }
          };
          
          // Set up cleanup function with proper handler references
          cleanup = () => {
            try {
              window.removeEventListener('scroll', handleUpdate, true);
              window.removeEventListener('resize', handleUpdate);
              // Clean up element styles
              if (foundElement && foundElement.isConnected) {
                foundElement.style.zIndex = '';
                foundElement.style.position = '';
                foundElement.style.transition = '';
              }
            } catch (err) {
              console.warn('[FeatureTour] Error cleaning up:', err);
            }
          };
        }
      } catch (error) {
        console.error(`[FeatureTour] Error setting up step ${currentStep + 1}:`, error);
      }
      
      // If not found, retry with a short delay (for all steps, not just step 0)
      if (!foundElement) {
        const retryTimer = setTimeout(() => {
          try {
            const retryElement = document.querySelector(step.target) as HTMLElement;
            if (retryElement) {
              console.log(`[FeatureTour] Element found on retry: ${step.target}`);
              setTargetElement(retryElement);
              updateTooltipPosition(retryElement, step.position);
              try {
                retryElement.scrollIntoView({ behavior: 'instant', block: 'center' });
              } catch {
                retryElement.scrollIntoView({ behavior: 'auto', block: 'center' });
              }
              retryElement.style.transition = 'none';
              retryElement.style.zIndex = '1000';
              retryElement.style.position = 'relative';
              
              // Set up event listeners for retry element
              const handleUpdate = () => {
                try {
                  if (retryElement && retryElement.isConnected) {
                    updateTooltipPosition(retryElement, step.position);
                  }
                } catch (err) {
                  console.warn('[FeatureTour] Error updating tooltip position:', err);
                }
              };
              window.addEventListener('scroll', handleUpdate, true);
              window.addEventListener('resize', handleUpdate);
            } else {
              console.warn(`[FeatureTour] Element still not found after retry: ${step.target}`);
            }
          } catch (error) {
            console.error(`[FeatureTour] Error in retry:`, error);
          }
        }, 200); // Short delay for retry
        
        return () => {
          if (retryTimer) clearTimeout(retryTimer);
          if (cleanup) cleanup();
        };
      }
      
      return cleanup || undefined;
    }
  }, [currentStep, tourSteps, location.pathname]);

  const handleNext = () => {
    try {
      // Clean up previous element styles but DON'T set targetElement to null yet
      // This prevents the tooltip from disappearing during transition
      const previousElement = targetElement;
      if (previousElement) {
        try {
          if (previousElement.isConnected) {
            previousElement.style.zIndex = '';
            previousElement.style.position = '';
            previousElement.style.transition = '';
          }
        } catch (err) {
          console.warn('[FeatureTour] Error cleaning up target element:', err);
        }
      }
      
      const step = tourSteps[currentStep];
      
      // Handle click actions (like clicking a capture card to navigate)
      if (step.action === 'click') {
        try {
          // If noHighlight, try to find the element by target selector
          let clickable: HTMLElement | null = null;
          if (step.noHighlight && step.target) {
            const element = document.querySelector(step.target) as HTMLElement;
            clickable = element?.closest('a, button') || element?.querySelector('a, button') || element;
          } else if (targetElement) {
            clickable = targetElement.closest('a, button') || targetElement.closest('[data-tour="capture-card"]')?.querySelector('a');
          }
          
          if (clickable) {
            (clickable as HTMLElement).click();
            // Navigation will happen, and the useEffect will detect the route change
            // Reset step to 0 for the detail view tour steps
            // Use a longer timeout to ensure navigation completes
            setTimeout(() => {
              // Reset to first step of detail tour
              setCurrentStep(0);
            }, 800);
            return;
          }
        } catch (error) {
          console.error('[FeatureTour] Error handling click action:', error);
        }
      }
      
      // Handle navigation actions
      if (step.action === 'navigate' && step.navigateTo) {
        try {
          navigate(step.navigateTo);
          // Wait for navigation, then continue
          setTimeout(() => {
            try {
              const newSteps = getTourSteps();
              // Find the step index in the new route's steps
              const nextStepIndex = newSteps.findIndex(s => s.id === step.id) + 1;
              if (nextStepIndex > 0 && nextStepIndex < newSteps.length) {
                setCurrentStep(nextStepIndex);
              } else {
                setCurrentStep(0);
              }
            } catch (error) {
              console.error('[FeatureTour] Error navigating:', error);
              onComplete();
            }
          }, 200);
          return;
        } catch (error) {
          console.error('[FeatureTour] Error in navigation action:', error);
        }
      }
      
      // Normal next step - advance immediately
      // Clear targetElement first so tooltip can reposition, then useEffect will find new element
      setTargetElement(null);
      
      if (currentStep < tourSteps.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        onComplete();
      }
    } catch (error) {
      console.error('[FeatureTour] Error in handleNext:', error);
      // Try to recover by advancing to next step
      if (currentStep < tourSteps.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        onComplete();
      }
    }
  };

  const handleSkip = () => {
    try {
      if (targetElement) {
        try {
          if (targetElement.isConnected) {
            targetElement.style.zIndex = '';
            targetElement.style.position = '';
            targetElement.style.transition = '';
          }
        } catch (err) {
          console.warn('[FeatureTour] Error cleaning up on skip:', err);
        }
        setTargetElement(null);
      }
      onComplete();
    } catch (error) {
      console.error('[FeatureTour] Error in handleSkip:', error);
      onComplete();
    }
  };

  if (currentStep >= tourSteps.length) {
    return null;
  }

  const step = tourSteps[currentStep];
  
  // Always show tooltip for current step, even if element isn't found yet
  // This prevents the wizard from disappearing between steps

  return (
    <>
      {/* Overlay with hole for highlighted element (only if we have a target element) */}
      <div
        ref={overlayRef}
        className="fixed inset-0 bg-black/40 z-[9998] transition-opacity"
        onClick={handleNext}
      >
        {targetElement && !step.noHighlight && (
          <div
            className="absolute border-4 border-accent rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.4)] pointer-events-none"
            style={{
              top: targetElement.getBoundingClientRect().top - 8,
              left: targetElement.getBoundingClientRect().left - 8,
              width: targetElement.getBoundingClientRect().width + 16,
              height: targetElement.getBoundingClientRect().height + 16,
            }}
          />
        )}
      </div>

      {/* Tooltip - always show for current step, position based on targetElement if available */}
      {step && (
        <div
          className="fixed z-[9999] w-80 max-w-[calc(100vw-2rem)] bg-[#1E293B] border border-accent/30 rounded-lg shadow-2xl p-6"
          style={{
            top: targetElement 
              ? (step.position === 'top' || step.position === 'center'
                  ? `${tooltipPosition.top}px`
                  : step.position === 'bottom'
                  ? `${tooltipPosition.top}px`
                  : `${tooltipPosition.top}px`)
              : '50%',
            left: targetElement
              ? (step.position === 'left' || step.position === 'right' || step.position === 'center'
                  ? `${tooltipPosition.left}px`
                  : `${tooltipPosition.left}px`)
              : '50%',
            transform: targetElement
              ? (step.position === 'center' 
                  ? 'translate(-50%, -50%)' 
                  : step.position === 'top' 
                  ? 'translate(-50%, -100%)' 
                  : step.position === 'bottom'
                  ? 'translate(-50%, 0)'
                  : step.position === 'left'
                  ? 'translate(-100%, -50%)'
                  : 'translate(0, -50%)')
              : 'translate(-50%, -50%)', // Center if no element found
            marginTop: step.position === 'top' ? '-10px' : '0',
            marginLeft: step.position === 'left' ? '-10px' : '0',
          }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h3 className="text-xl font-bold text-white mb-2">{step.title}</h3>
              <p className="text-slate-300 text-sm leading-relaxed">{step.description}</p>
            </div>
            <button
              onClick={handleSkip}
              className="text-slate-400 hover:text-white transition-colors ml-2"
              aria-label="Close tour"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
            <div className="text-xs text-slate-400">
              Step {currentStep + 1} of {tourSteps.length}
            </div>
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={() => {
                    if (targetElement) {
                      targetElement.style.zIndex = '';
                      targetElement.style.position = '';
                    }
                    setCurrentStep(currentStep - 1);
                  }}
                  className="px-4 py-2 bg-[#0F172A] hover:bg-[#1E293B] text-white rounded-lg transition-colors text-sm"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-4 py-2 bg-accent hover:bg-accent/90 text-[#0F172A] rounded-lg transition-colors font-medium text-sm"
              >
                {currentStep === tourSteps.length - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>

          {/* Progress indicators */}
          <div className="flex items-center justify-center gap-2 mt-4">
            {tourSteps.map((_, index) => (
              <div
                key={index}
                className={`h-1 rounded-full transition-all ${
                  index === currentStep
                    ? 'w-8 bg-accent'
                    : index < currentStep
                    ? 'w-2 bg-accent/50'
                    : 'w-2 bg-slate-600'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default FeatureTour;

