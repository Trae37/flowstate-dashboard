import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

// Listen for main process logs and display them in console
if (window.electronAPI && window.electronAPI.onMainProcessLog) {
  window.electronAPI.onMainProcessLog((message: string) => {
    console.log('[MAIN]', message);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
