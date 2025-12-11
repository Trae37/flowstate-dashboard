import { useEffect } from 'react';

interface CaptureProgressProps {
  step: number;
  totalSteps: number;
  currentStep: string;
  status: 'starting' | 'completed';
  assetsCount?: number;
}

interface CaptureProgressModalProps {
  isOpen: boolean;
  progress: CaptureProgressProps | null;
  onClose?: () => void;
}

function CaptureProgressModal({ isOpen, progress, onClose }: CaptureProgressModalProps) {
  // Handle ESC key press
  useEffect(() => {
    if (!isOpen || !onClose) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !progress) return null;

  const percentage = Math.round((progress.step / progress.totalSteps) * 100);
  const isCompleted = progress.status === 'completed';

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-[#1E293B] border border-white/10 rounded-xl shadow-2xl p-6 min-w-[400px] max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <div className="animate-spin">
            <span className="material-symbols-outlined text-accent text-2xl">autorenew</span>
          </div>
          <h2 className="text-xl font-bold text-white">Capturing Workspace</h2>
        </div>

        <div className="space-y-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">
                Step {progress.step} of {progress.totalSteps}
              </span>
              <span className="text-accent font-semibold">{percentage}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-accent h-full transition-all duration-300 ease-out"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          {/* Current step */}
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              {isCompleted ? (
                <span className="material-symbols-outlined text-green-400 text-sm">check_circle</span>
              ) : (
                <span className="material-symbols-outlined text-accent text-sm animate-pulse">
                  radio_button_checked
                </span>
              )}
              <span className="text-white font-medium">{progress.currentStep}</span>
            </div>
            {isCompleted && progress.assetsCount !== undefined && (
              <p className="text-sm text-slate-400 ml-6">
                Captured {progress.assetsCount} {progress.assetsCount === 1 ? 'asset' : 'assets'}
              </p>
            )}
          </div>

          {/* Info message */}
          <p className="text-xs text-slate-500 text-center">
            Please wait while we capture your workspace...
          </p>
        </div>
      </div>
    </div>
  );
}

export default CaptureProgressModal;
