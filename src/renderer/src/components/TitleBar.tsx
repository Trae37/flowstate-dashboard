import { useState, useEffect } from 'react';

function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check if window is maximized on mount
    if (window.electronAPI?.windowIsMaximized) {
      window.electronAPI.windowIsMaximized().then(setIsMaximized);
    }
  }, []);

  const handleMinimize = () => {
    if (window.electronAPI?.windowMinimize) {
      window.electronAPI.windowMinimize();
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI?.windowMaximize) {
      window.electronAPI.windowMaximize().then(() => {
        // Toggle the state
        setIsMaximized(!isMaximized);
      });
    }
  };

  const handleClose = () => {
    if (window.electronAPI?.windowClose) {
      window.electronAPI.windowClose();
    }
  };

  return (
    <div className="flex items-center justify-between h-8 bg-[#0F172A] select-none">
      {/* Draggable area */}
      <div className="flex-1 h-full draggable-area"></div>

      {/* Window controls */}
      <div className="flex h-full no-drag-area">
        <button
          onClick={handleMinimize}
          className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors text-white/60 hover:text-white"
          aria-label="Minimize"
        >
          <span className="material-symbols-outlined text-sm">minimize</span>
        </button>
        <button
          onClick={handleMaximize}
          className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors text-white/60 hover:text-white"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          <span className="material-symbols-outlined text-sm">
            {isMaximized ? 'filter_none' : 'crop_square'}
          </span>
        </button>
        <button
          onClick={handleClose}
          className="w-12 h-full flex items-center justify-center hover:bg-red-600 transition-colors text-white/60 hover:text-white"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
