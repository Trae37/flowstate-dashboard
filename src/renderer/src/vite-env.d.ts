/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    captureWorkspace: (
      payload: { userId: number; name?: string }
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    restoreWorkspace: (
      captureId: number,
      userId: number
    ) => Promise<{ success: boolean; error?: string }>;
    restoreAsset: (
      assetId: number,
      userId: number
    ) => Promise<{ success: boolean; error?: string }>;
    getCaptures: (userId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
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
    // Auth methods
    authSignup: (email: string, password: string, username?: string) => Promise<{ success: boolean; user?: any; error?: string }>;
    authLogin: (email: string, password: string) => Promise<{ success: boolean; session?: any; user?: any; error?: string }>;
    authVerifySession: (sessionToken: string) => Promise<{ success: boolean; user?: any; error?: string }>;
    authLogout: (sessionToken: string) => Promise<{ success: boolean; error?: string }>;
    authCompleteOnboarding: (userId: number) => Promise<{ success: boolean; error?: string }>;
    authCompleteFeatureTour: (userId: number) => Promise<{ success: boolean; error?: string }>;
    authDeleteUser: (email: string) => Promise<{ success: boolean; error?: string }>;
    createDemoCapture: (userId: number) => Promise<{ success: boolean; data?: any; error?: string }>;
    onMainProcessLog: (callback: (message: string) => void) => void;
    getPowerStatus?: () => Promise<'ac' | 'battery' | 'unknown'>;
    onPowerStatusChange?: (callback: (status: 'ac' | 'battery' | 'unknown') => void) => () => void;
  };
}
