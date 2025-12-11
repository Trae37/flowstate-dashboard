import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import FeatureTour from '../components/FeatureTour';
import AssetCard from '../components/AssetCard';
import { formatFullDateTime } from '../utils/dateUtils';

interface Capture {
  id: number;
  name: string;
  created_at: string;
  context_description?: string;
}

interface Asset {
  id: number;
  capture_id: number;
  asset_type: string;
  title: string;
  path?: string;
  content?: string;
  metadata?: string;
}

type AssetType = 'all' | 'terminal' | 'browser' | 'code' | 'notes';
type SortOption = 'date-desc' | 'date-asc' | 'type' | 'name';

function ContextDetail() {
  const { id } = useParams<{ id: string }>();
  const [capture, setCapture] = useState<Capture | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<AssetType>('all');
  const [sortBy, setSortBy] = useState<SortOption>('type');
  const [groupByType, setGroupByType] = useState(true);
  const [showFeatureTour, setShowFeatureTour] = useState(false);
  const tourInitializedRef = useRef(false);
  const { user, completeFeatureTour } = useAuth();

  // Check if feature tour should continue on detail page
  useEffect(() => {
    // Don't run if tour is already showing, already initialized, or marked as completed
    if (showFeatureTour || 
        tourInitializedRef.current ||
        sessionStorage.getItem('feature_tour_completed') === 'true') {
      return;
    }
    
    const featureTourCompleted = user?.feature_tour_completed === true || user?.feature_tour_completed === 1;
    
    // If already completed, mark in sessionStorage and return immediately
    if (featureTourCompleted) {
      sessionStorage.setItem('feature_tour_completed', 'true');
      return;
    }
    
    if (user && !featureTourCompleted && !loading && capture) {
      // Check if we came from dashboard tour
      const tourInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
      if (tourInProgress && !showFeatureTour) {
        setTimeout(() => {
          // Final check before showing
          const stillInProgress = sessionStorage.getItem('feature_tour_in_progress') === 'true';
          const stillNotCompleted = !(user?.feature_tour_completed === true || user?.feature_tour_completed === 1);
          if (stillInProgress && stillNotCompleted) {
            tourInitializedRef.current = true;
            setShowFeatureTour(true);
          }
        }, 500);
      }
    } else {
      // Make sure tour is hidden if conditions aren't met
      if (featureTourCompleted) {
        setShowFeatureTour(false);
        sessionStorage.removeItem('feature_tour_in_progress');
      }
    }
  }, [user, loading, capture, user?.feature_tour_completed, showFeatureTour]);

  useEffect(() => {
    if (id && user?.id) {
      loadCaptureDetails();
    }
  }, [id, user?.id]);

  const loadCaptureDetails = async () => {
    if (!id || !user?.id) {
      console.warn('[ContextDetail] Cannot load capture without id/user');
      return;
    }
    try {
      const result = await window.electronAPI.getCaptureDetails(Number(id), user.id);
      console.log(`[ContextDetail] Loaded ${result.data?.assets?.length || 0} assets for capture ${id}`);
      
      if (result.success && result.data) {
        const assets = result.data.assets || [];
        console.log(`[ContextDetail] Setting ${assets.length} assets for capture ${id}`);
        console.log(`[ContextDetail] Assets sample:`, assets.slice(0, 3).map(a => ({
          id: a.id,
          asset_type: a.asset_type,
          title: a.title,
        })));
        
        setCapture(result.data.capture);
        setAssets(assets);
        
        // Force re-render check
        setTimeout(() => {
          console.log(`[ContextDetail] After state update - assets count:`, assets.length);
        }, 100);
      } else {
        console.error(`[ContextDetail] Failed to load capture details for ${id}:`, result.error);
        setAssets([]);
      }
    } catch (error) {
      console.error(`[ContextDetail] Exception loading capture details for ${id}:`, error);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  };

  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string>('');

  // Listen for restore progress updates
  useEffect(() => {
    if (!isRestoring) return;
    
    const cleanup = window.electronAPI.onRestoreProgress?.((message: string) => {
      setRestoreProgress(message);
    });

    return () => {
      cleanup?.();
    };
  }, [isRestoring]);

  const handleRestore = async () => {
    if (!id) return;
    if (!user?.id) {
      alert('Please sign in again to restore this workspace.');
      return;
    }

    setIsRestoring(true);
    setRestoreProgress('Starting restoration...');

    try {
      const result = await window.electronAPI.restoreWorkspace(Number(id), user.id);
      setIsRestoring(false);
      setRestoreProgress('');
      
      if (result.success) {
        alert('Workspace restored successfully!');
      } else if (result.cancelled) {
        alert('Restoration was cancelled.');
      } else {
        alert(`Failed to restore workspace: ${result.error}`);
      }
    } catch (error) {
      setIsRestoring(false);
      setRestoreProgress('');
      console.error('Failed to restore workspace:', error);
      alert('Failed to restore workspace');
    }
  };

  const handleCancelRestore = async () => {
    try {
      await window.electronAPI.cancelRestoration();
      setRestoreProgress('Cancelling restoration...');
    } catch (error) {
      console.error('Failed to cancel restoration:', error);
    }
  };

  // Filter and sort assets
  const filteredAssets = assets
    .filter((asset) => {
      // Filter by type
      if (selectedType !== 'all' && asset.asset_type !== selectedType) {
        return false;
      }

      // Filter by search query
      if (!searchQuery || searchQuery.trim() === '') {
        return true;
      }
      
      const query = searchQuery.toLowerCase();

      // Basic filters
      const basicMatch =
        (asset.title && asset.title.toLowerCase().includes(query)) ||
        (asset.asset_type && asset.asset_type.toLowerCase().includes(query)) ||
        (asset.path && asset.path.toLowerCase().includes(query)) ||
        (asset.content && asset.content.toLowerCase().includes(query));

      // Check for Claude Code in metadata (for terminal assets)
      let claudeMatch = false;
      if (asset.metadata && asset.asset_type === 'terminal') {
        try {
          const metadata = JSON.parse(asset.metadata);
          if ((query.includes('claude') || query === 'claude code') && metadata.claudeCodeContext) {
            claudeMatch = true;
          }
          if (metadata.claudeCodeContext) {
            const context = metadata.claudeCodeContext;
            claudeMatch = claudeMatch ||
              (context.workingDirectory && context.workingDirectory.toLowerCase().includes(query)) ||
              (context.gitStatus?.branch && context.gitStatus.branch.toLowerCase().includes(query)) ||
              (context.recentlyModifiedFiles?.some((file: string) => file.toLowerCase().includes(query))) ||
              (context.contextHint && context.contextHint.toLowerCase().includes(query));
          }
        } catch (err) {
          // Ignore parsing errors
        }
      }

      return basicMatch || claudeMatch;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return (b.id || 0) - (a.id || 0); // Newer first
        case 'date-asc':
          return (a.id || 0) - (b.id || 0); // Older first
        case 'type':
          return a.asset_type.localeCompare(b.asset_type);
        case 'name':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

  // Group assets by type
  const groupedAssets = groupByType
    ? filteredAssets.reduce((groups, asset) => {
        const type = asset.asset_type;
        if (!groups[type]) {
          groups[type] = [];
        }
        groups[type].push(asset);
        return groups;
      }, {} as Record<string, Asset[]>)
    : {};

  // Get asset type counts
  const typeCounts = assets.reduce((counts, asset) => {
    counts[asset.asset_type] = (counts[asset.asset_type] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'terminal': return 'terminal';
      case 'browser': return 'public';
      case 'code': return 'code';
      case 'notes': return 'description';
      default: return 'folder';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'terminal': return 'text-green-400';
      case 'browser': return 'text-blue-400';
      case 'code': return 'text-primary';
      case 'notes': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const getTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-900 dark:text-white">Loading...</div>
      </div>
    );
  }

  if (!capture) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <p className="text-gray-900 dark:text-white mb-4">Capture not found</p>
        <Link to="/" className="text-primary hover:underline">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const handleTourComplete = async () => {
    // Immediately prevent any further tour initialization
    tourInitializedRef.current = true;
    setShowFeatureTour(false);
    sessionStorage.removeItem('feature_tour_in_progress');
    sessionStorage.setItem('feature_tour_completed', 'true');
    if (user) {
      await completeFeatureTour();
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 bg-gradient-to-br from-gray-50 via-gray-100 to-gray-50 dark:from-[#0F172A] dark:via-[#1E293B] dark:to-[#0F172A] noise-bg">
      {showFeatureTour && <FeatureTour onComplete={handleTourComplete} />}
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <Link
            data-tour="back-to-dashboard"
            to="/"
            className="flex items-center gap-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined">arrow_back</span>
            <span>All Contexts</span>
          </Link>

          <div className="flex items-center gap-3">
            {isRestoring ? (
              <>
                <button
                  onClick={handleCancelRestore}
                  className="flex items-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-semibold"
                >
                  <span className="material-symbols-outlined">stop_circle</span>
                  Cancel Restoration
                </button>
                {restoreProgress && (
                  <span className="text-sm text-gray-600 dark:text-slate-400">{restoreProgress}</span>
                )}
              </>
            ) : (
              <button
                data-tour="restore-all-button"
                onClick={handleRestore}
                className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent/90 text-[#0F172A] dark:text-[#0F172A] text-white rounded-lg transition-colors font-semibold"
              >
                <span className="material-symbols-outlined">play_circle</span>
                Reopen All Assets
              </button>
            )}
          </div>
        </div>

        <div className="mb-8" data-tour="detail-view-header">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-3">{capture.name}</h1>
          <p className="text-gray-600 dark:text-slate-400 text-lg">
            Captured on {formatFullDateTime(capture.created_at)}
          </p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, type, path, or 'claude' for Claude Code sessions..."
              className="w-full pl-12 pr-4 py-3 bg-gray-100 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Filters and Controls */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          {/* Type Filters */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedType('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                selectedType === 'all'
                  ? 'bg-accent text-[#0F172A] dark:text-[#0F172A] text-white'
                  : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-white/10'
              }`}
            >
              All ({assets.length})
            </button>
            {Object.keys(typeCounts).sort().map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type as AssetType)}
                className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  selectedType === type
                    ? 'bg-accent text-[#0F172A] dark:text-[#0F172A] text-white'
                    : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-white/10'
                }`}
              >
                <span className={`material-symbols-outlined text-sm ${selectedType === type ? 'text-[#0F172A] dark:text-[#0F172A] text-white' : getTypeColor(type)}`}>
                  {getTypeIcon(type)}
                </span>
                {getTypeLabel(type)} ({typeCounts[type]})
              </button>
            ))}
          </div>

          {/* Sort and View Options */}
          <div className="flex gap-2">
            <button
              onClick={() => setGroupByType(!groupByType)}
              className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-white/10 transition-all flex items-center gap-2"
              title={groupByType ? "Switch to list view" : "Switch to grouped view"}
            >
              <span className="material-symbols-outlined text-sm">
                {groupByType ? 'view_list' : 'view_module'}
              </span>
              {groupByType ? 'Grouped' : 'List'}
            </button>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-white border border-gray-300 dark:border-white/10 focus:outline-none focus:ring-2 focus:ring-accent hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white transition-all"
            >
              <option value="type" className="bg-gray-100 dark:bg-[#1E293B] text-gray-700 dark:text-white">Sort by Type</option>
              <option value="name" className="bg-gray-100 dark:bg-[#1E293B] text-gray-700 dark:text-white">Sort by Name</option>
              <option value="date-desc" className="bg-gray-100 dark:bg-[#1E293B] text-gray-700 dark:text-white">Newest First</option>
              <option value="date-asc" className="bg-gray-100 dark:bg-[#1E293B] text-gray-700 dark:text-white">Oldest First</option>
            </select>
          </div>
        </div>

        {/* Results Info */}
        {(searchQuery || selectedType !== 'all') && (
          <p className="mb-4 text-sm text-slate-400 dark:text-slate-400 text-gray-600">
            Found {filteredAssets.length} {filteredAssets.length === 1 ? 'asset' : 'assets'}
          </p>
        )}
        
        {/* Assets Display */}
        {filteredAssets.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-white/60 text-lg">
              {searchQuery || selectedType !== 'all' ? 'No assets match your filters' : 'No assets captured'}
            </p>
          </div>
        ) : groupByType ? (
          /* Grouped by Type View */
          <div className="space-y-8">
            {Object.keys(groupedAssets).sort().map((type) => (
              <div key={type}>
                <div className="flex items-center gap-3 mb-4">
                  <span className={`material-symbols-outlined text-2xl ${getTypeColor(type)}`}>
                    {getTypeIcon(type)}
                  </span>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {getTypeLabel(type)}
                  </h2>
                  <span className="text-gray-600 dark:text-slate-400 text-sm">
                    ({groupedAssets[type].length})
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {groupedAssets[type].map((asset) => (
                    <AssetCard 
                      key={asset.id} 
                      asset={asset}
                      onArchive={() => loadCaptureDetails()}
                      onDelete={() => loadCaptureDetails()}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAssets.map((asset) => (
              <AssetCard 
                key={asset.id} 
                asset={asset}
                onArchive={() => loadCaptureDetails()}
                onDelete={() => loadCaptureDetails()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ContextDetail;
