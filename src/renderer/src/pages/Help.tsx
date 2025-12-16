import { useState } from 'react';
import { Link } from 'react-router-dom';

interface HelpSection {
  id: string;
  title: string;
  icon: string;
  content: React.ReactNode;
}

const helpSections: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'rocket_launch',
    content: (
      <div className="space-y-4">
        <p>
          Welcome to FlowState Dashboard! This app helps you capture and restore your complete development workspace context - including browser tabs, terminal sessions, code files, and notes.
        </p>
        <h4 className="font-semibold text-white text-lg mt-6">First Time Setup</h4>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>Complete the onboarding wizard to set your preferences</li>
          <li>Take the feature tour to learn the interface</li>
          <li>Set up browser debugging to capture browser tabs (see Browser Setup section)</li>
          <li>Click the Capture button to save your first workspace!</li>
        </ol>
        <div className="mt-4 p-4 bg-accent/10 border border-accent/30 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-accent">lightbulb</span>
            <div>
              <p className="font-semibold text-white">Pro Tip</p>
              <p className="text-sm text-slate-300">Capture your workspace before switching tasks, taking breaks, or shutting down. You'll be able to restore everything exactly as you left it!</p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    icon: 'dashboard',
    content: (
      <div className="space-y-4">
        <p>
          The Dashboard is your home base. Here's what you'll find:
        </p>
        <div className="space-y-4 mt-4">
          <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-accent">radio_button_checked</span>
              <h4 className="font-semibold text-white">Capture Button</h4>
            </div>
            <p className="text-sm text-slate-300">The large button at the top captures your current workspace state. Click it to save all your open browser tabs, terminal sessions, code files, and notes.</p>
          </div>
          <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-accent">toggle_on</span>
              <h4 className="font-semibold text-white">Auto-Save Toggle</h4>
            </div>
            <p className="text-sm text-slate-300">Enable automatic captures at regular intervals. Configure the interval in Settings.</p>
          </div>
          <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-accent">folder</span>
              <h4 className="font-semibold text-white">Sessions Sidebar</h4>
            </div>
            <p className="text-sm text-slate-300">Sessions organize your captures by work period - like folders for your workspace states. Create new sessions for different projects or tasks.</p>
          </div>
          <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-accent">history</span>
              <h4 className="font-semibold text-white">Capture Cards</h4>
            </div>
            <p className="text-sm text-slate-300">Each card shows a saved workspace capture with preview counts of browser tabs, terminals, code files, and notes. Click to view details or restore.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'capturing',
    title: 'Capturing Your Workspace',
    icon: 'camera_alt',
    content: (
      <div className="space-y-4">
        <p>
          When you capture a workspace, FlowState saves:
        </p>
        <ul className="space-y-3 mt-4">
          <li className="flex items-start gap-3">
            <span className="material-symbols-outlined text-blue-400">language</span>
            <div>
              <span className="font-semibold text-white">Browser Tabs</span>
              <p className="text-sm text-slate-300">All open tab URLs and titles from Chrome, Brave, or Edge (requires browser debugging - see Browser Setup)</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="material-symbols-outlined text-green-400">terminal</span>
            <div>
              <span className="font-semibold text-white">Terminal Sessions</span>
              <p className="text-sm text-slate-300">Current directory, command history, running processes, and shell type (PowerShell, CMD, Git Bash, WSL)</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="material-symbols-outlined text-purple-400">code</span>
            <div>
              <span className="font-semibold text-white">Code Files</span>
              <p className="text-sm text-slate-300">Open files in VS Code or Cursor with their content preserved</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="material-symbols-outlined text-yellow-400">note</span>
            <div>
              <span className="font-semibold text-white">Notes</span>
              <p className="text-sm text-slate-300">Any notes or documentation you've added</p>
            </div>
          </li>
        </ul>
        <h4 className="font-semibold text-white text-lg mt-6">How to Capture</h4>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>Make sure your browsers are running with debugging enabled</li>
          <li>Click the <span className="text-accent font-semibold">Capture</span> button on the Dashboard</li>
          <li>Wait a few seconds for the capture to complete</li>
          <li>Your workspace is now saved!</li>
        </ol>
        <h4 className="font-semibold text-white text-lg mt-6">Automatic Captures</h4>
        <p>
          Enable the Auto-Save toggle on the Dashboard to automatically capture your workspace at regular intervals. Configure the interval (5 minutes to 2 hours) in Settings.
        </p>
      </div>
    ),
  },
  {
    id: 'restoring',
    title: 'Restoring Your Workspace',
    icon: 'restore',
    content: (
      <div className="space-y-4">
        <p>
          Restore a previous workspace to get back exactly where you left off.
        </p>
        <h4 className="font-semibold text-white text-lg mt-6">How to Restore</h4>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>Find the capture you want to restore on the Dashboard</li>
          <li>Click the capture card to open the detail view</li>
          <li>Click <span className="text-accent font-semibold">Restore All</span> to restore everything, or</li>
          <li>Click individual restore buttons to restore specific items</li>
        </ol>
        <h4 className="font-semibold text-white text-lg mt-6">What Happens When You Restore</h4>
        <div className="space-y-3 mt-4">
          <div className="flex items-start gap-3 p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-blue-400">language</span>
            <div>
              <span className="font-semibold text-white">Browser Tabs</span>
              <p className="text-sm text-slate-300">Opens all saved URLs in your default browser</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-green-400">terminal</span>
            <div>
              <span className="font-semibold text-white">Terminals</span>
              <p className="text-sm text-slate-300">Opens terminals in the original directory and restarts any captured processes (like dev servers)</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="material-symbols-outlined text-purple-400">code</span>
            <div>
              <span className="font-semibold text-white">Code Files</span>
              <p className="text-sm text-slate-300">Opens files in VS Code or Cursor (requires CLI to be installed)</p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'sessions',
    title: 'Using Sessions',
    icon: 'folder_open',
    content: (
      <div className="space-y-4">
        <p>
          Sessions help you organize captures by project, task, or time period. Think of them as folders for your workspace states.
        </p>
        <h4 className="font-semibold text-white text-lg mt-6">Why Use Sessions?</h4>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>Keep captures for different projects separate</li>
          <li>Organize by task or feature you're working on</li>
          <li>Easily switch between different work contexts</li>
          <li>Archive entire sessions when a project is complete</li>
        </ul>
        <h4 className="font-semibold text-white text-lg mt-6">Managing Sessions</h4>
        <div className="space-y-3 mt-4">
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Create a New Session</span>
            <p className="text-sm text-slate-300 mt-1">Click the + button in the Sessions sidebar to create a new session. Give it a descriptive name like "Feature X" or "Bug Fix #123".</p>
          </div>
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Switch Sessions</span>
            <p className="text-sm text-slate-300 mt-1">Click on any session in the sidebar to switch to it. The Dashboard will show captures from that session.</p>
          </div>
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Archive a Session</span>
            <p className="text-sm text-slate-300 mt-1">When you're done with a project, archive the session to keep it safe. Archived sessions won't be auto-deleted.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'archive',
    title: 'The Archive',
    icon: 'inventory_2',
    content: (
      <div className="space-y-4">
        <p>
          The Archive is where you store important captures for safekeeping. Archived items are protected from automatic cleanup.
        </p>
        <h4 className="font-semibold text-white text-lg mt-6">Why Archive?</h4>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li><span className="text-accent">Protected from cleanup</span> - Archived captures are never auto-deleted</li>
          <li><span className="text-accent">Long-term storage</span> - Keep important workspace states indefinitely</li>
          <li><span className="text-accent">Organized by date</span> - Easily find archived items by when they were archived</li>
        </ul>
        <h4 className="font-semibold text-white text-lg mt-6">How to Archive</h4>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>Find the capture or session you want to archive</li>
          <li>Click the archive button (box icon)</li>
          <li>The item moves to the Archive page</li>
        </ol>
        <h4 className="font-semibold text-white text-lg mt-6">Accessing the Archive</h4>
        <p>
          Click the Archive button in the sidebar or header to view all archived items. From there you can:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2 mt-2">
          <li>View archived captures and sessions</li>
          <li>Restore items back to active workspace</li>
          <li>Permanently delete archived items</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'browser-setup',
    title: 'Browser Setup',
    icon: 'public',
    content: (
      <div className="space-y-4">
        <p>
          To capture browser tabs, your browser must be running with remote debugging enabled. This is a Chrome DevTools Protocol requirement.
        </p>
        <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-yellow-400">warning</span>
            <div>
              <p className="font-semibold text-yellow-300">Important</p>
              <p className="text-sm text-yellow-200/80">If your browser is already running without debugging, FlowState cannot capture its tabs. You need to close and relaunch the browser with debugging enabled.</p>
            </div>
          </div>
        </div>
        <h4 className="font-semibold text-white text-lg mt-6">Easy Setup (Recommended)</h4>
        <p>
          Go to <Link to="/settings" className="text-accent hover:underline">Settings → Browser Debugging</Link> and click the "Enable Debugging" button for your browser. FlowState will:
        </p>
        <ol className="list-decimal list-inside space-y-1 ml-2 mt-2">
          <li>Automatically close the browser if it's running</li>
          <li>Relaunch it with debugging enabled</li>
          <li>Your tabs will now be capturable!</li>
        </ol>
        <h4 className="font-semibold text-white text-lg mt-6">Supported Browsers</h4>
        <div className="space-y-2 mt-4">
          <div className="flex items-center gap-3 p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white w-32">Google Chrome</span>
            <span className="text-sm text-slate-400">Port 9222</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white w-32">Brave Browser</span>
            <span className="text-sm text-slate-400">Port 9222</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white w-32">Microsoft Edge</span>
            <span className="text-sm text-slate-400">Port 9223</span>
          </div>
        </div>
        <h4 className="font-semibold text-white text-lg mt-6">Manual Setup</h4>
        <p>
          Alternatively, you can manually launch your browser with the debug flag:
        </p>
        <div className="mt-2 p-3 bg-[#0F172A] rounded-lg font-mono text-sm">
          <p className="text-green-400"># Chrome</p>
          <p className="text-slate-300">chrome.exe --remote-debugging-port=9222</p>
          <p className="text-green-400 mt-2"># Brave</p>
          <p className="text-slate-300">brave.exe --remote-debugging-port=9222</p>
          <p className="text-green-400 mt-2"># Edge</p>
          <p className="text-slate-300">msedge.exe --remote-debugging-port=9223</p>
        </div>
      </div>
    ),
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: 'settings',
    content: (
      <div className="space-y-4">
        <p>
          Configure FlowState to work the way you want. Access Settings from the gear icon in the header.
        </p>
        <h4 className="font-semibold text-white text-lg mt-6">Capture Settings</h4>
        <div className="space-y-3 mt-2">
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Smart Capture</span>
            <p className="text-sm text-slate-300 mt-1">Filters out idle terminals and empty sessions during capture. Recommended to keep captures clean.</p>
          </div>
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Automatic Workspace Capture</span>
            <p className="text-sm text-slate-300 mt-1">Enable to automatically capture at regular intervals (5 min to 2 hours).</p>
          </div>
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Battery Saver</span>
            <p className="text-sm text-slate-300 mt-1">Pauses automatic captures when on battery power to save energy.</p>
          </div>
        </div>
        <h4 className="font-semibold text-white text-lg mt-6">Preferences</h4>
        <div className="space-y-3 mt-2">
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Timezone</span>
            <p className="text-sm text-slate-300 mt-1">Set your timezone for accurate date/time display.</p>
          </div>
          <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
            <span className="font-semibold text-white">Maximum Saved Captures</span>
            <p className="text-sm text-slate-300 mt-1">Set how many captures to keep (10-500). Older non-archived captures are auto-deleted when limit is reached.</p>
          </div>
        </div>
        <h4 className="font-semibold text-white text-lg mt-6">Privacy</h4>
        <div className="p-3 bg-[#0F172A]/50 rounded-lg border border-white/5">
          <span className="font-semibold text-white">Usage Analytics</span>
          <p className="text-sm text-slate-300 mt-1">Optionally share anonymous usage data to help improve FlowState. No sensitive data (code, URLs, commands) is ever collected.</p>
        </div>
      </div>
    ),
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'build',
    content: (
      <div className="space-y-4">
        <h4 className="font-semibold text-white text-lg">Browser tabs not being captured?</h4>
        <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
          <ol className="list-decimal list-inside space-y-2">
            <li>Make sure your browser is launched with debugging enabled</li>
            <li>Go to Settings → Browser Debugging and click "Enable Debugging"</li>
            <li>If the browser was already running, it needs to be restarted</li>
            <li>Wait a few seconds after the browser opens before capturing</li>
          </ol>
        </div>

        <h4 className="font-semibold text-white text-lg mt-6">Terminals not restoring correctly?</h4>
        <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
          <ul className="list-disc list-inside space-y-2">
            <li>Make sure the terminal application is installed (Windows Terminal, PowerShell, etc.)</li>
            <li>Some processes may need manual restart if they require user input</li>
            <li>Check that the working directory still exists</li>
          </ul>
        </div>

        <h4 className="font-semibold text-white text-lg mt-6">VS Code or Cursor files not opening?</h4>
        <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
          <ul className="list-disc list-inside space-y-2">
            <li>Make sure the editor CLI is installed (run "code --version" or "cursor --version" in terminal)</li>
            <li><strong>VS Code:</strong> Open VS Code → Command Palette → "Shell Command: Install 'code' command in PATH"</li>
            <li><strong>Cursor:</strong> Open Cursor → Command Palette → "Shell Command: Install 'cursor' command in PATH"</li>
          </ul>
        </div>

        <h4 className="font-semibold text-white text-lg mt-6">App running slowly?</h4>
        <div className="p-4 bg-[#0F172A]/50 rounded-lg border border-white/5">
          <ul className="list-disc list-inside space-y-2">
            <li>Reduce the number of maximum saved captures in Settings</li>
            <li>Archive or delete old captures you no longer need</li>
            <li>Enable Battery Saver mode when on laptop battery</li>
          </ul>
        </div>

        <h4 className="font-semibold text-white text-lg mt-6">Need more help?</h4>
        <div className="p-4 bg-accent/10 border border-accent/30 rounded-lg">
          <p className="text-slate-300">
            If you're still having issues, send us an email at{' '}
            <a
              href="mailto:support@inflowstate.app?subject=FlowState Dashboard Support Request"
              className="text-accent hover:underline"
            >
              support@inflowstate.app
            </a>
            {' '}with details about your problem and we'll help you out.
          </p>
        </div>
      </div>
    ),
  },
];

function Help() {
  const [activeSection, setActiveSection] = useState('getting-started');

  const currentSection = helpSections.find(s => s.id === activeSection);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a1d35] via-[#1e2542] to-[#151829]">
      <div className="flex">
        {/* Sidebar Navigation */}
        <div className="w-64 min-h-screen bg-[#0F172A]/50 border-r border-white/5 p-4 flex flex-col">
          <div className="mb-6">
            <Link
              to="/"
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined">arrow_back</span>
              <span>Back to Dashboard</span>
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <span className="material-symbols-outlined text-accent">help</span>
            Help Center
          </h1>

          <nav className="space-y-1 flex-1">
            {helpSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
                  activeSection === section.id
                    ? 'bg-accent/20 text-accent'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-xl">{section.icon}</span>
                <span className="text-sm font-medium">{section.title}</span>
              </button>
            ))}
          </nav>

        </div>

        {/* Main Content */}
        <div className="flex-1 p-8 max-w-4xl">
          {currentSection && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-accent text-2xl">
                    {currentSection.icon}
                  </span>
                </div>
                <h2 className="text-3xl font-bold text-white">{currentSection.title}</h2>
              </div>
              <div className="text-slate-300 leading-relaxed">
                {currentSection.content}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Help;
