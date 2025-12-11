import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/electron/renderer';
import App from './App';
import './styles/index.css';

// Initialize Sentry for renderer process (production only)
if (import.meta.env.PROD) {
  Sentry.init({
    // DSN is shared from main process initialization
    environment: 'production',
  });
  console.log('[Sentry] Renderer process initialized');
}

console.log('[main.tsx] Starting app initialization...');

// Add a visible fallback immediately so user sees something
document.body.style.backgroundColor = '#1A1A1D';
document.body.style.color = '#ffffff';
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.fontFamily = 'system-ui, -apple-system, sans-serif';

// Listen for main process logs and display them in console
if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onMainProcessLog) {
  window.electronAPI.onMainProcessLog((message: string) => {
    console.log('[MAIN]', message);
  });
} else {
  console.warn('[main.tsx] window.electronAPI not available yet');
}

// Ensure root element exists before rendering
const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[main.tsx] Root element not found!');
  document.body.innerHTML = '<div style="padding: 20px; color: white; background: #1A1A1D; min-height: 100vh; display: flex; align-items: center; justify-content: center;"><div style="text-align: center;"><h1 style="color: #ff6b6b;">Error: Root element not found</h1><p>Please check the HTML file.</p></div></div>';
} else {
  console.log('[main.tsx] Root element found, rendering React app...');
  
  // Add a visible loading indicator
  rootElement.innerHTML = '<div style="padding: 40px; text-align: center; color: white;"><div style="border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid white; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div><p>Loading React app...</p><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style></div>';
  
  try {
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      try {
        ReactDOM.createRoot(rootElement).render(
          <React.StrictMode>
            <App />
          </React.StrictMode>,
        );
        console.log('[main.tsx] React app rendered successfully');
      } catch (renderError) {
        console.error('[main.tsx] Error rendering React app:', renderError);
        rootElement.innerHTML = `<div style="padding: 20px; color: #ff6b6b; background: #1A1A1D; min-height: 100vh; font-family: system-ui;">
          <h1>Error Rendering App</h1>
          <p><strong>Error:</strong> ${renderError instanceof Error ? renderError.message : String(renderError)}</p>
          ${renderError instanceof Error && renderError.stack ? `<pre style="background: #2d2d3a; padding: 10px; overflow: auto; white-space: pre-wrap; color: #fff;">${renderError.stack}</pre>` : ''}
        </div>`;
      }
    }, 100);
  } catch (error) {
    console.error('[main.tsx] Error setting up React app:', error);
    rootElement.innerHTML = `<div style="padding: 20px; color: #ff6b6b; background: #1A1A1D; min-height: 100vh; font-family: system-ui;">
      <h1>Error Setting Up App</h1>
      <p><strong>Error:</strong> ${error instanceof Error ? error.message : String(error)}</p>
      ${error instanceof Error && error.stack ? `<pre style="background: #2d2d3a; padding: 10px; overflow: auto; white-space: pre-wrap; color: #fff;">${error.stack}</pre>` : ''}
    </div>`;
  }
}
