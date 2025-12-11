import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface Asset {
  id: number;
  capture_id: number;
  asset_type: string;
  title: string;
  path?: string;
  content?: string;
  metadata?: string;
  archived?: boolean;
}

interface AssetCardProps {
  asset: Asset;
  onArchive?: () => void;
  onDelete?: () => void;
}

function AssetCard({ asset, onArchive, onDelete }: AssetCardProps) {
  const { user } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleArchive = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user?.id || isArchiving) return;

    setIsArchiving(true);
    try {
      const result = asset.archived
        ? await window.electronAPI.unarchiveAsset({
            assetId: asset.id,
            userId: user.id,
          })
        : await window.electronAPI.archiveAsset({
            assetId: asset.id,
            userId: user.id,
          });
      if (result.success) {
        onArchive?.();
      } else {
        alert(`Failed to ${asset.archived ? 'unarchive' : 'archive'}: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to archive asset:', error);
      alert(`Failed to ${asset.archived ? 'unarchive' : 'archive'} asset`);
    } finally {
      setIsArchiving(false);
      setShowMenu(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user?.id || isDeleting) return;

    if (!confirm(`Are you sure you want to delete "${asset.title}"? This action cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await window.electronAPI.deleteAsset({
        assetId: asset.id,
        userId: user.id,
      });
      if (result.success) {
        onDelete?.();
      } else {
        alert(`Failed to delete: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to delete asset:', error);
      alert('Failed to delete asset');
    } finally {
      setIsDeleting(false);
      setShowMenu(false);
    }
  };

  return (
    <div className="relative group bg-gray-200 dark:bg-[#1E293B]/80 backdrop-blur-sm rounded-2xl overflow-hidden transition-all duration-300 hover:bg-gray-300 dark:hover:bg-[#334155] border border-gray-300 dark:border-white/10 shadow-lg">
      <div className="flex items-start gap-3 p-5 border-b border-gray-300 dark:border-white/5">
        <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-[#0F172A]/50 flex items-center justify-center flex-shrink-0">
          <span className={`material-symbols-outlined text-2xl ${getAssetColor()}`}>
            {getAssetIcon()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-gray-900 dark:text-white font-semibold truncate mb-1">{asset.title}</p>
          {asset.path && (
            <p className="text-xs text-gray-600 dark:text-slate-500 font-mono truncate">{asset.path}</p>
          )}
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="p-1 rounded hover:bg-gray-300 dark:hover:bg-white/10 transition-colors"
          aria-label="More options"
        >
          <span className="material-symbols-outlined text-gray-600 dark:text-slate-400 text-sm">more_vert</span>
        </button>
      </div>

      <div className="p-5 bg-gray-200 dark:bg-[#0F172A]/30 min-h-[220px] flex flex-col">
        {asset.content ? (
          <div className="bg-[#1E293B] dark:bg-[#0F172A]/80 rounded-lg p-4">
            <pre className="text-xs text-white dark:text-slate-300 font-mono leading-relaxed overflow-x-auto">
              {asset.content.substring(0, 300)}
              {asset.content.length > 300 && '...'}
            </pre>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-600 dark:text-slate-500 text-sm">
            No preview available for this asset type.
          </div>
        )}

        <button
          data-tour="asset-restore-button"
          onClick={handleReopen}
          className="mt-4 w-full py-3 px-4 bg-[#1E293B] dark:bg-[#1E293B] bg-gray-800 text-white dark:text-white text-white hover:bg-[#334155] dark:hover:bg-[#334155] hover:bg-gray-700 rounded-xl transition-colors text-sm font-medium flex items-center justify-center gap-2 border border-white/10 dark:border-white/10 border-gray-300"
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

      {/* Dropdown Menu */}
      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute top-12 right-5 z-20 bg-[#1E293B] dark:bg-[#1E293B] bg-white border border-white/10 dark:border-white/10 border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[150px]">
            {!asset.archived ? (
              <button
                onClick={handleArchive}
                disabled={isArchiving}
                className="w-full text-left px-4 py-2 text-sm text-white dark:text-white text-gray-900 hover:bg-white/10 dark:hover:bg-white/10 hover:bg-gray-100 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">archive</span>
                {isArchiving ? 'Archiving...' : 'Archive component'}
              </button>
            ) : (
              <button
                onClick={handleArchive}
                disabled={isArchiving}
                className="w-full text-left px-4 py-2 text-sm text-white dark:text-white text-gray-900 hover:bg-white/10 dark:hover:bg-white/10 hover:bg-gray-100 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">unarchive</span>
                {isArchiving ? 'Unarchiving...' : 'Unarchive component'}
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-full text-left px-4 py-2 text-sm text-red-400 dark:text-red-400 text-red-600 hover:bg-red-500/10 dark:hover:bg-red-500/10 hover:bg-red-50 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default AssetCard;
