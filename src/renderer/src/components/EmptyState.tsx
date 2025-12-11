interface EmptyStateProps {
  onCapture: () => void;
}

function EmptyState({ onCapture }: EmptyStateProps) {
  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="bg-gray-200 dark:bg-[#1E293B]/40 backdrop-blur-sm rounded-2xl p-12 min-h-[60vh] flex flex-col items-center justify-center border-2 border-gray-400 dark:border-white/20 shadow-xl">
          <button
            onClick={onCapture}
            className="mb-8 inline-flex items-center gap-2 px-6 py-3 bg-[#1E293B] dark:bg-[#0F172A] text-white hover:bg-[#334155] dark:hover:bg-[#0F172A]/80 rounded-xl transition-colors"
          >
            <span className="material-symbols-outlined text-sm">add_circle_outline</span>
            <span>Capture your first workspace context</span>
          </button>

          <div className="text-center max-w-2xl">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Your Dashboard is Ready</h1>

            <p className="text-lg text-gray-800 dark:text-slate-300">
              No contexts have been captured yet. Click the <span className="text-gray-900 dark:text-white font-semibold">'Capture Now'</span> button
              above to save your current workspace, or enable Automatic Save to capture changes in the background.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default EmptyState;
