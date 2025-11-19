interface EmptyStateProps {
  onCapture: () => void;
}

function EmptyState({ onCapture }: EmptyStateProps) {
  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="bg-[#1E293B]/40 backdrop-blur-sm rounded-2xl p-12 min-h-[60vh] flex flex-col items-center justify-center border border-white/5">
          <button
            onClick={onCapture}
            className="mb-8 inline-flex items-center gap-2 px-6 py-3 bg-[#1E293B] text-slate-300 hover:bg-[#334155] rounded-xl transition-colors border border-white/10"
          >
            <span className="material-symbols-outlined text-sm text-slate-400">add_circle_outline</span>
            <span>Capture your first workspace context</span>
          </button>

          <div className="text-center max-w-2xl">
            <h1 className="text-4xl font-bold text-white mb-4">Your Dashboard is Ready</h1>

            <p className="text-lg text-slate-400">
              No contexts have been captured yet. Click the <span className="text-white font-semibold">'Capture Now'</span> button
              above to save your current workspace, or enable Automatic Save to capture changes in the background.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default EmptyState;
