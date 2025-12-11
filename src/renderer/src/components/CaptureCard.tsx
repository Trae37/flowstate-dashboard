import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { formatRelativeDate, isRecentDate } from '../utils/dateUtils';

interface Capture {
  id: number;
  name: string;
  created_at: string;
  context_description?: string;
  archived?: boolean;
}

interface CaptureCardProps {
  capture: Capture;
  onArchive?: () => void;
  onDelete?: () => void;
}

interface AssetCounts {
  code: number;
  terminal: number;
  browser: number;
  notes: number;
  total: number;
}

function CaptureCard({ capture, onArchive, onDelete }: CaptureCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assetCounts, setAssetCounts] = useState<AssetCounts | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch asset counts for this capture
  useEffect(() => {
    const fetchAssetCounts = async () => {
      if (!user?.id) return;
      
      try {
        const result = await window.electronAPI.getCaptureDetails(capture.id, user.id);
        if (result.success && result.data?.assets) {
          const assets = result.data.assets;
          const counts: AssetCounts = {
            code: assets.filter((a: any) => a.asset_type === 'code').length,
            terminal: assets.filter((a: any) => a.asset_type === 'terminal').length,
            browser: assets.filter((a: any) => a.asset_type === 'browser').length,
            notes: assets.filter((a: any) => a.asset_type === 'notes').length,
            total: assets.length,
          };
          setAssetCounts(counts);
        }
      } catch (error) {
        console.error('Failed to load asset counts:', error);
      }
    };

    fetchAssetCounts();
  }, [capture.id, user?.id]);

  const handleArchive = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user?.id || isArchiving) return;

    setIsArchiving(true);
    try {
      const result = await window.electronAPI.archiveCapture({
        captureId: capture.id,
        userId: user.id,
      });
      if (result.success) {
        onArchive?.();
      } else {
        alert(`Failed to archive: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to archive capture:', error);
      alert('Failed to archive capture');
    } finally {
      setIsArchiving(false);
      setShowMenu(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user?.id || isDeleting) return;

    if (!confirm(`Are you sure you want to delete "${capture.name}"? This action cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await window.electronAPI.deleteCapture(capture.id, user.id);
      if (result.success) {
        onDelete?.();
      } else {
        alert(`Failed to delete: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to delete capture:', error);
      alert('Failed to delete capture');
    } finally {
      setIsDeleting(false);
      setShowMenu(false);
    }
  };

  return (
    <div className="relative group">
      <Link
        to={`/context/${capture.id}`}
        className="block rounded-xl bg-gray-200 dark:bg-[#1E293B] transition-all duration-300 hover:bg-gray-300 dark:hover:bg-[#334155] border border-gray-300 dark:border-white/10 shadow-lg"
      >
        <div className="p-5">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-bold text-gray-900 dark:text-white text-lg flex-1">{capture.name}</h3>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="ml-2 p-1 rounded hover:bg-white/10 transition-colors"
              aria-label="More options"
            >
              <span className="material-symbols-outlined text-slate-400 text-sm">more_vert</span>
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">{formatRelativeDate(capture.created_at)}</p>
          {assetCounts ? (
            <div className="bg-[#0F172A] dark:bg-[#0F172A] rounded-lg p-4 min-h-[60px]">
              <div className="flex flex-wrap items-center gap-3 text-xs text-white">
                {assetCounts.code > 0 && (
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-sm text-green-400">code</span>
                    {assetCounts.code} {assetCounts.code === 1 ? 'file' : 'files'}
                  </span>
                )}
                {assetCounts.terminal > 0 && (
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-sm text-accent">terminal</span>
                    {assetCounts.terminal} {assetCounts.terminal === 1 ? 'terminal' : 'terminals'}
                  </span>
                )}
                {assetCounts.browser > 0 && (
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-sm text-blue-400">public</span>
                    {assetCounts.browser} {assetCounts.browser === 1 ? 'tab' : 'tabs'}
                  </span>
                )}
                {assetCounts.notes > 0 && (
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="material-symbols-outlined text-sm text-yellow-400">description</span>
                    {assetCounts.notes} {assetCounts.notes === 1 ? 'note' : 'notes'}
                  </span>
                )}
                  {assetCounts.total === 0 && (
                    <span className="text-slate-400">No assets</span>
                  )}
              </div>
            </div>
          ) : (
            <div className="bg-[#0F172A] dark:bg-[#0F172A] rounded-lg p-4 min-h-[60px]">
              <div className="flex items-center gap-4 text-xs text-white">
                <span>Loading...</span>
              </div>
            </div>
          )}
        </div>
      </Link>

      {/* Dropdown Menu */}
      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute top-12 right-0 z-20 bg-white dark:bg-[#1E293B] border border-gray-300 dark:border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[150px]">
            {!capture.archived ? (
              <button
                onClick={handleArchive}
                disabled={isArchiving}
                className="w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">archive</span>
                {isArchiving ? 'Archiving...' : 'Archive Capture'}
              </button>
            ) : (
              <button
                onClick={handleArchive}
                disabled={isArchiving}
                className="w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">unarchive</span>
                {isArchiving ? 'Unarchiving...' : 'Unarchive Capture'}
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors flex items-center gap-2 disabled:opacity-50"
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

export default CaptureCard;
