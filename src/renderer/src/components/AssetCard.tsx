import { useAuth } from '../contexts/AuthContext';

interface Asset {
  id: number;
  capture_id: number;
  asset_type: string;
  title: string;
  path?: string;
  content?: string;
  metadata?: string;
}

interface AssetCardProps {
  asset: Asset;
}

function AssetCard({ asset }: AssetCardProps) {
  const { user } = useAuth();

  const handleReopen = async () => {
    console.log(`[AssetCard] Restore button clicked for asset ${asset.id} (${asset.asset_type})`);
    try {
      if (!user?.id) {
        alert('Please sign in again to restore this asset.');
        return;
      }
      console.log(`[AssetCard] Calling restoreAsset(${asset.id})...`);
      const result = await window.electronAPI.restoreAsset(asset.id, user.id);
      console.log(`[AssetCard] restoreAsset result:`, result);
      if (!result.success) {
        console.error('[AssetCard] Failed to restore asset:', result.error);
        const errorMsg = result.error || 'Unknown error';
        alert(`❌ Failed to restore terminal\n\nError: ${errorMsg}\n\nCheck the DevTools console (F12) for detailed logs starting with [TERMINAL RESTORE].`);
      } else {
        console.log('[AssetCard] Asset restored successfully');
        // Note: We don't show a success alert because the terminal should open
        // If it doesn't open, the user will notice and can check console
      }
    } catch (error) {
      console.error('[AssetCard] Exception restoring asset:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      alert(`❌ Failed to restore terminal\n\nException: ${errorMsg}\n\nCheck the DevTools console (F12) for detailed logs.`);
    }
  };

  const getAssetIcon = () => {
    switch (asset.asset_type) {
      case 'code':
        return 'code';
      case 'terminal':
        return 'terminal';
      case 'browser':
        return 'public';
      case 'notes':
        return 'description';
      default:
        return 'folder';
    }
  };

  const getAssetColor = () => {
    switch (asset.asset_type) {
      case 'code':
        return 'text-primary';
      case 'terminal':
        return 'text-green-400';
      case 'browser':
        return 'text-blue-400';
      case 'notes':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="bg-[#1E293B]/80 backdrop-blur-sm rounded-2xl overflow-hidden transition-all duration-300 hover:border-white/10 border border-white/5">
      <div className="flex items-start gap-3 p-5 border-b border-white/5">
        <div className="w-12 h-12 rounded-xl bg-[#0F172A]/50 flex items-center justify-center flex-shrink-0">
          <span className={`material-symbols-outlined text-2xl ${getAssetColor()}`}>
            {getAssetIcon()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold truncate mb-1">{asset.title}</p>
          {asset.path && (
            <p className="text-xs text-slate-500 font-mono truncate">{asset.path}</p>
          )}
        </div>
      </div>

      <div className="p-5 bg-[#0F172A]/30 min-h-[220px] flex flex-col">
        {asset.content ? (
          <pre className="text-xs text-slate-300 font-mono bg-[#0F172A]/80 p-4 rounded-lg overflow-auto flex-1 max-h-[150px] leading-relaxed border border-white/5">
            {asset.content.substring(0, 300)}
            {asset.content.length > 300 && '...'}
          </pre>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
            No preview available for this asset type.
          </div>
        )}

        <button
          data-tour="asset-restore-button"
          onClick={handleReopen}
          className="mt-4 w-full py-3 px-4 bg-[#1E293B] text-white hover:bg-[#334155] rounded-xl transition-colors text-sm font-medium flex items-center justify-center gap-2 border border-white/10"
        >
          <span className="material-symbols-outlined text-base">
            {getAssetIcon()}
          </span>
          <span>
            {asset.asset_type === 'code' && 'Reopen IDE'}
            {asset.asset_type === 'terminal' && 'Restore Session'}
            {asset.asset_type === 'browser' && 'Restore Tab'}
            {asset.asset_type === 'notes' && 'Reopen Note'}
            {!['code', 'terminal', 'browser', 'notes'].includes(asset.asset_type) && 'View Document'}
          </span>
        </button>
      </div>
    </div>
  );
}

export default AssetCard;
