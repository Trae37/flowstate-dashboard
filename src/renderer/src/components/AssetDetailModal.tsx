import { useEffect } from 'react';

interface Asset {
  id: number;
  asset_type: string;
  title: string;
  path?: string;
  content?: string;
  metadata?: string;
}

interface AssetDetailModalProps {
  asset: Asset | null;
  onClose: () => void;
  onReopen: () => void;
}

function AssetDetailModal({ asset, onClose, onReopen }: AssetDetailModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (asset) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [asset, onClose]);

  if (!asset) return null;

  const formatTimeAgo = () => {
    // Mock data - would come from actual asset metadata
    return '2 minutes ago';
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-[#1a2332] via-[#1e2945] to-[#1a2332] rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            <span>Back to Workspace</span>
          </button>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-8 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-white mb-2">{asset.title}</h1>
            {asset.path && (
              <p className="text-sm text-slate-400 font-mono">{asset.path}</p>
            )}
            <p className="text-sm text-slate-500 mt-2">Last saved: {formatTimeAgo()}</p>
          </div>

          {asset.content && (
            <div className="bg-[#0F172A]/80 rounded-xl p-6 border border-white/5 mb-6">
              <pre className="text-sm text-slate-300 font-mono leading-relaxed overflow-x-auto">
                {asset.content}
              </pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-white/10 p-6 bg-[#0F172A]/30">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={onReopen}
              className="px-8 py-3 bg-[#6366F1] hover:bg-[#5558E3] text-white rounded-xl transition-colors font-semibold flex items-center gap-2"
            >
              <span className="material-symbols-outlined">open_in_new</span>
              Reopen in VS Code
            </button>

            <button
              onClick={onReopen}
              className="px-6 py-3 bg-[#1E293B] hover:bg-[#334155] text-white rounded-xl transition-colors font-medium flex items-center gap-2 border border-white/10"
            >
              <span className="material-symbols-outlined">add</span>
              Open Alongside Existing IDEs
            </button>

            <button
              onClick={onReopen}
              className="px-6 py-3 bg-[#1E293B] hover:bg-[#334155] text-white rounded-xl transition-colors font-medium flex items-center gap-2 border border-white/10"
            >
              <span className="material-symbols-outlined">sync</span>
              Replace Current IDE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AssetDetailModal;
