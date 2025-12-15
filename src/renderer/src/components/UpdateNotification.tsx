import { useState, useEffect } from 'react';

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}

function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Listen for update available
    const removeUpdateAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      setUpdateAvailable(info);
      setDismissed(false);
    });

    // Listen for download progress
    const removeDownloadProgress = window.electronAPI.onUpdateDownloadProgress?.((progress) => {
      setDownloadProgress(progress);
    });

    // Listen for update downloaded
    const removeUpdateDownloaded = window.electronAPI.onUpdateDownloaded?.((info) => {
      setUpdateDownloaded(true);
      setDownloading(false);
      setUpdateAvailable(info);
    });

    return () => {
      removeUpdateAvailable?.();
      removeDownloadProgress?.();
      removeUpdateDownloaded?.();
    };
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const result = await window.electronAPI.updateDownload?.();
      if (!result?.success) {
        alert(`Failed to download update: ${result?.error}`);
        setDownloading(false);
      }
    } catch (error) {
      console.error('Failed to download update:', error);
      alert('Failed to download update');
      setDownloading(false);
    }
  };

  const handleInstall = async () => {
    try {
      await window.electronAPI.updateInstall?.();
      // App will quit and install, so this code won't run
    } catch (error) {
      console.error('Failed to install update:', error);
      alert('Failed to install update');
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  // Don't show if dismissed or no update available
  if (dismissed || !updateAvailable) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <div className="bg-white dark:bg-[#1E293B] border border-gray-300 dark:border-white/10 rounded-lg shadow-2xl overflow-hidden">
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-accent text-2xl">system_update</span>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {updateDownloaded ? 'Update Ready' : 'Update Available'}
              </h3>
            </div>
            <button
              onClick={handleDismiss}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Dismiss"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>

          <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
            {updateDownloaded
              ? `Version ${updateAvailable.version} has been downloaded and is ready to install.`
              : `Version ${updateAvailable.version} is now available.`}
          </p>

          {downloading && downloadProgress && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-slate-400 mb-1">
                <span>Downloading...</span>
                <span>{downloadProgress.percent.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent h-full transition-all duration-300"
                  style={{ width: `${downloadProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {updateDownloaded ? (
              <>
                <button
                  onClick={handleInstall}
                  className="flex-1 px-4 py-2 bg-accent hover:bg-accent/90 text-white dark:text-[#0F172A] font-semibold rounded-lg transition-colors"
                >
                  Restart & Install
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-900 dark:text-white font-semibold rounded-lg transition-colors"
                >
                  Later
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex-1 px-4 py-2 bg-accent hover:bg-accent/90 text-white dark:text-[#0F172A] font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {downloading ? 'Downloading...' : 'Download Update'}
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-900 dark:text-white font-semibold rounded-lg transition-colors"
                >
                  Later
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default UpdateNotification;
