/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    captureWorkspace: (
      payload: { userId: number; name?: string; sessionId?: number }
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    restoreWorkspace: (
      captureId: number,
      userId: number
    ) => Promise<{ success: boolean; error?: string; cancelled?: boolean }>;
    restoreAsset: (
      assetId: number,
      userId: number
    ) => Promise<{ success: boolean; error?: string }>;
    cancelRestoration: () => Promise<{ success: boolean; error?: string }>;
    getCaptures: (payload: { userId: number; sessionId?: number; includeArchived?: boolean }) => Promise<{ success: boolean; data?: any; error?: string }>;
    getCaptureDetails: (
      captureId: number,
      userId: number
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    deleteCapture: (
      captureId: number,
      userId: number
    ) => Promise<{ success: boolean; error?: string }>;
    getSettings: (userId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
    saveSettings: (
      settings: Record<string, any>,
      userId: number
    ) => Promise<{ success: boolean; error?: string }>;
    launchBrowserWithDebugging: (browserName: string) => Promise<{ success: boolean; error?: string }>;
    promptCloseAndRelaunchBrowser: (browserName: string) => Promise<{ success: boolean; error?: string; cancelled?: boolean }>;
    getBrowsersWithoutDebugging: () => Promise<{ success: boolean; data?: string[]; error?: string }>;
    // Auth methods
    authSignup: (email: string, password: string, username?: string) => Promise<{ success: boolean; user?: any; error?: string }>;
    authLogin: (email: string, password: string) => Promise<{ success: boolean; session?: any; user?: any; error?: string }>;
    authVerifySession: (sessionToken: string) => Promise<{ success: boolean; user?: any; error?: string }>;
    authLogout: (sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    authCompleteOnboarding: (userId: number) => Promise<{ success: boolean; error?: string }>;
    authCompleteFeatureTour: (userId: number) => Promise<{ success: boolean; error?: string }>;
    authDeleteUser: (email: string) => Promise<{ success: boolean; error?: string }>;
    createDemoCapture: (userId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
    // Session management
    sessionGetCurrent: (userId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
    sessionGetAll: (userId: number, includeArchived?: boolean) => Promise<{ success: boolean; data?: any; error?: string }>;
    sessionCreate: (userId: number, name?: string, description?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    sessionUpdate: (sessionId: number, name?: string, description?: string) => Promise<{ success: boolean; error?: string }>;
    sessionArchive: (sessionId: number) => Promise<{ success: boolean; error?: string }>;
    sessionUnarchive: (sessionId: number) => Promise<{ success: boolean; error?: string }>;
    sessionDelete: (sessionId: number) => Promise<{ success: boolean; error?: string }>;
    sessionGetAutoRecovered: (userId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
    // Archive management
    archiveCapture: (payload: { captureId: number; userId: number }) => Promise<{ success: boolean; error?: string }>;
    unarchiveCapture: (payload: { captureId: number; userId: number }) => Promise<{ success: boolean; error?: string }>;
    archiveAsset: (payload: { assetId: number; userId: number }) => Promise<{ success: boolean; error?: string }>;
    unarchiveAsset: (payload: { assetId: number; userId: number }) => Promise<{ success: boolean; error?: string }>;
    deleteAsset: (payload: { assetId: number; userId: number }) => Promise<{ success: boolean; error?: string }>;
    onMainProcessLog: (callback: (message: string) => void) => void;
    onCaptureProgress: (callback: (progress: {
      step: number;
      totalSteps: number;
      currentStep: string;
      status: 'starting' | 'completed';
      assetsCount?: number;
    }) => void) => () => void;
    getPowerStatus?: () => Promise<'ac' | 'battery' | 'unknown'>;
    onPowerStatusChange?: (callback: (status: 'ac' | 'battery' | 'unknown') => void) => () => void;
    onRestoreProgress?: (callback: (message: string) => void) => () => void;
    onCommunicationNotification?: (callback: (notification: {
      appName: string;
      title?: string;
      body?: string;
      timestamp: string;
    }) => void) => () => void;
    // Auto-updater methods
    updateDownload?: () => Promise<{ success: boolean; error?: string }>;
    updateInstall?: () => Promise<{ success: boolean; error?: string }>;
    onUpdateAvailable?: (callback: (info: {
      version: string;
      releaseNotes?: string;
      releaseDate?: string;
    }) => void) => () => void;
    onUpdateDownloadProgress?: (callback: (progress: {
      percent: number;
      transferred: number;
      total: number;
    }) => void) => () => void;
    onUpdateDownloaded?: (callback: (info: {
      version: string;
    }) => void) => () => void;
  };
}
