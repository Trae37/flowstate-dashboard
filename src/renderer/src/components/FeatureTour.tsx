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
    id: 'sessions-sidebar',
    target: '[data-tour="sessions-sidebar"]',
    title: 'Sessions Sidebar',
    description: 'Sessions organize your captures by work period. Each session groups related captures together - like a project folder for your workspace states. Create new sessions for different projects or tasks.',
    position: 'right',
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
        id: 'view-details',
        target: '[data-tour="capture-card"]',
        title: 'View Capture Details',
        description: 'Click this button to open the detailed view where you can see all captured assets and restore them individually or all at once.',
        position: 'top',
        action: 'click',
      }
    );
  }

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
    description: 'Click here to return to the dashboard. Next, we\'ll show you the Archive where you can store important captures.',
    position: 'bottom',
    action: 'click',
  },
];

// Dashboard steps shown after returning from detail page (shows archive button)
const getDashboardAfterDetailTourSteps = (): TourStep[] => [
  {
    id: 'archive-button',
    target: '[data-tour="archive-button"]',
    title: 'Archive Button',
    description: 'The Archive is where you can store important captures for safekeeping. Archived items are protected from automatic cleanup. Click to explore the Archive.',
    position: 'right',
    action: 'click',
  },
];

const getArchiveTourSteps = (): TourStep[] => [
  {
    id: 'archive-intro',
    title: 'Archive Page',
    description: 'The Archive is where your archived sessions and captures are stored. Items here are protected from automatic cleanup and organized by date.',
    position: 'center',
    noHighlight: true,
  },
  {
    id: 'archive-folders',
    title: 'Date Folders',
    description: 'Archived items are organized into folders by date. Click any folder to view the sessions and captures archived on that day.',
    position: 'center',
    noHighlight: true,
  },
  {
    id: 'archive-actions',
    title: 'Archive Actions',
    description: 'You can unarchive items to bring them back to your active workspace, or permanently delete them. Archived captures are never automatically deleted.',
    position: 'center',
    noHighlight: true,
  },
  {
    id: 'navigate-to-settings',
    title: 'Next: Settings Page',
    description: 'Finally, let\'s explore the Settings page where you can customize FlowState to work the way you want.',
    position: 'center',
    noHighlight: true,
    action: 'navigate',
    navigateTo: '/settings',
  },
];

const getSettingsTourSteps = (): TourStep[] => [
  {
    id: 'settings-intro',
    title: 'Settings Page',
    description: 'Here you can configure FlowState Dashboard to match your workflow. Let\'s go through the key settings.',
    position: 'center',
    noHighlight: true,
  },
  {
    id: 'settings-capture-section',
    target: '[data-tour="settings-capture"]',
    title: 'Capture Settings',
    description: 'Configure how captures work: enable Smart Capture to filter out idle terminals, set up automatic workspace captures, and enable Battery Saver mode.',
    position: 'right',
  },
  {
    id: 'settings-browser-section',
    target: '[data-tour="settings-browser"]',
    title: 'Browser Debugging',
    description: 'Important! To capture browser tabs, you need to launch your browser with debugging enabled. Use these buttons to launch Chrome, Brave, or Edge with the right settings.',
    position: 'right',
  },
  {
    id: 'tour-complete',
    title: 'Tour Complete!',
    description: 'You\'re all set! Start capturing your workspace to preserve your development context. Click Finish to return to the Dashboard.',
    position: 'center',
    noHighlight: true,
    action: 'navigate',
    navigateTo: '/',
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
  const [adjustedPosition, setAdjustedPosition] = useState<{ top: number; left: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Track tour phase using sessionStorage
  const [tourPhase, setTourPhase] = useState<string>(() => {
    return sessionStorage.getItem('feature_tour_phase') || 'dashboard';
  });

  // Get tour steps based on current route and phase
  const tourSteps = useMemo(() => {
    if (location.pathname.startsWith('/context/')) {
      return getDetailTourSteps();
    }
    if (location.pathname === '/archive' || location.pathname.startsWith('/archive/')) {
      return getArchiveTourSteps();
    }
    if (location.pathname === '/settings') {
      return getSettingsTourSteps();
    }
    // Dashboard: check if we're returning from detail page
    if (tourPhase === 'after-detail') {
      return getDashboardAfterDetailTourSteps();
    }
    return getDashboardTourSteps(hasCaptures);
  }, [location.pathname, hasCaptures, tourPhase]);
  
  // Reset step to 0 when route changes during tour
  useEffect(() => {
    const tourInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
    if (tourInProgress) {
      // When route changes, the tourSteps will update via useMemo
      // We just need to ensure currentStep doesn't exceed the new route's step count
      const maxSteps = tourSteps.length;
      if (currentStep >= maxSteps) {
        setCurrentStep(0);
      }
    }
  }, [location.pathname, currentStep, tourSteps.length]);

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
        // Position tooltip higher on screen (25% from top) so text is more visible
        setTooltipPosition({
          top: window.innerHeight * 0.25,
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

  // Adjust tooltip position to stay within viewport bounds
  useEffect(() => {
    if (!tooltipRef.current) {
      setAdjustedPosition(null);
      return;
    }

    // Wait a frame for the tooltip to render with initial position
    requestAnimationFrame(() => {
      if (!tooltipRef.current) return;

      const tooltip = tooltipRef.current;
      const rect = tooltip.getBoundingClientRect();
      const padding = 16; // Minimum padding from viewport edges

      let newTop = tooltipPosition.top;
      let newLeft = tooltipPosition.left;
      let needsAdjustment = false;

      // Check if tooltip goes off the bottom of the viewport
      if (rect.bottom > window.innerHeight - padding) {
        // Move it up so it's fully visible
        const overflow = rect.bottom - (window.innerHeight - padding);
        newTop = tooltipPosition.top - overflow;
        needsAdjustment = true;
      }

      // Check if tooltip goes off the top of the viewport
      if (rect.top < padding) {
        newTop = padding + rect.height / 2; // Account for transform
        needsAdjustment = true;
      }

      // Check if tooltip goes off the right of the viewport
      if (rect.right > window.innerWidth - padding) {
        const overflow = rect.right - (window.innerWidth - padding);
        newLeft = tooltipPosition.left - overflow;
        needsAdjustment = true;
      }

      // Check if tooltip goes off the left of the viewport
      if (rect.left < padding) {
        newLeft = padding + rect.width / 2; // Account for transform
        needsAdjustment = true;
      }

      if (needsAdjustment) {
        setAdjustedPosition({ top: newTop, left: newLeft });
      } else {
        setAdjustedPosition(null);
      }
    });
  }, [tooltipPosition, currentStep, targetElement]);

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
          // Always try to find the element by selector first for click actions
          let clickable: HTMLElement | null = null;

          if (step.target) {
            // Find element by selector
            const element = document.querySelector(step.target) as HTMLElement;
            if (element) {
              // For buttons/links, use them directly; for other elements, find clickable child/parent
              if (element.tagName === 'BUTTON' || element.tagName === 'A') {
                clickable = element;
              } else {
                clickable = element.closest('a, button') || element.querySelector('a, button') || element;
              }
            }
          }

          // Fallback to targetElement if selector didn't find anything
          if (!clickable && targetElement) {
            clickable = targetElement.closest('a, button') || targetElement.closest('[data-tour="capture-card"]')?.querySelector('a');
          }

          console.log(`[FeatureTour] Click action for step "${step.id}": clickable =`, clickable);

          if (clickable) {
            // Set tour phase based on which step we're clicking
            if (step.id === 'back-to-dashboard') {
              // Returning from detail page to dashboard - show archive button next
              sessionStorage.setItem('feature_tour_phase', 'after-detail');
              setTourPhase('after-detail');
            } else if (step.id === 'archive-button') {
              // Going to archive page - set archive phase
              sessionStorage.setItem('feature_tour_phase', 'archive');
              setTourPhase('archive');
            }

            console.log(`[FeatureTour] Clicking element for step "${step.id}"`);
            (clickable as HTMLElement).click();
            // Navigation will happen, and the useEffect will detect the route change
            // Reset step to 0 for the new page's tour steps
            setTimeout(() => {
              setCurrentStep(0);
            }, 800);
            return;
          } else {
            console.warn(`[FeatureTour] No clickable element found for step "${step.id}" with target "${step.target}"`);
          }
        } catch (error) {
          console.error('[FeatureTour] Error handling click action:', error);
        }
      }
      
      // Handle navigation actions
      if (step.action === 'navigate' && step.navigateTo) {
        try {
          // Check if this is the final step (tour complete)
          const isLastStep = currentStep === tourSteps.length - 1;

          // Set tour phase based on destination
          if (step.navigateTo === '/settings') {
            sessionStorage.setItem('feature_tour_phase', 'settings');
            setTourPhase('settings');
          }

          navigate(step.navigateTo);
          // Wait for navigation, then reset to step 0 for new page's tour steps
          setTimeout(() => {
            try {
              if (isLastStep && step.navigateTo === '/') {
                // Tour is complete, navigating back to dashboard
                sessionStorage.removeItem('feature_tour_phase');
                onComplete();
              } else {
                // Reset to first step of new page's tour
                setCurrentStep(0);
              }
            } catch (error) {
              console.error('[FeatureTour] Error after navigation:', error);
              sessionStorage.removeItem('feature_tour_phase');
              onComplete();
            }
          }, 300);
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
      // Clear tour phase on skip
      sessionStorage.removeItem('feature_tour_phase');
      onComplete();
    } catch (error) {
      console.error('[FeatureTour] Error in handleSkip:', error);
      sessionStorage.removeItem('feature_tour_phase');
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
        onClick={handleNext} // Click anywhere to advance to next step
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
          ref={tooltipRef}
          className="fixed z-[9999] w-80 max-w-[calc(100vw-2rem)] bg-[#1E293B] border border-accent/30 rounded-lg shadow-2xl p-6"
          onClick={(e) => e.stopPropagation()} // Prevent clicks on card from advancing
          style={{
            top: `${adjustedPosition?.top ?? tooltipPosition.top}px`,
            left: `${adjustedPosition?.left ?? tooltipPosition.left}px`,
            transform: adjustedPosition
              ? 'translate(-50%, -50%)' // Use centered transform when adjusted
              : targetElement
              ? (step.position === 'center'
                  ? 'translate(-50%, -50%)'
                  : step.position === 'top'
                  ? 'translate(-50%, -100%)'
                  : step.position === 'bottom'
                  ? 'translate(-50%, 0)'
                  : step.position === 'left'
                  ? 'translate(-100%, -50%)'
                  : 'translate(0, -50%)')
              : 'translate(-50%, -50%)', // Center horizontally, center vertically on calculated position
            marginTop: !adjustedPosition && step.position === 'top' ? '-10px' : '0',
            marginLeft: !adjustedPosition && step.position === 'left' ? '-10px' : '0',
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

