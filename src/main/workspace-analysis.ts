/**
 * Workspace Analysis Module
 * Analyzes git changes, tracks AI vs manual edits, generates next steps
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { validateFilePathForCommand, sanitizeCommandArg } from './utils/command-security.js';

export interface WorkspaceAnalysis {
  filesEditedByAI: string[];
  filesEditedManually: string[];
  recentChanges: FileChange[];
  todoItems: TodoItem[];
  recommendations: string[];
  continuationPrompt: string;
  gitBranch?: string;
  gitStatus?: {
    modified: string[];
    untracked: string[];
  };
  mostRecentFile?: string;
  timeSinceLastWork?: string;
}

export interface FileChange {
  file: string;
  changeType: 'added' | 'modified' | 'deleted';
  linesAdded: number;
  linesRemoved: number;
  summary: string;
}

export interface TodoItem {
  file: string;
  line: number;
  text: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Analyze a workspace and generate intelligent recommendations
 */
export async function analyzeWorkspace(workspacePath: string, ideName: string): Promise<WorkspaceAnalysis | null> {
  try {
    console.log(`[Workspace Analysis] Analyzing: ${workspacePath}`);

    // Get AI-edited files from Cursor database
    const aiEditedFiles = await getAIEditedFiles(workspacePath, ideName);

    // Get all changed files from git
    const changedFiles = await getChangedFiles(workspacePath);

    // Categorize files
    const filesEditedByAI: string[] = [];
    const filesEditedManually: string[] = [];

    for (const file of changedFiles) {
      if (aiEditedFiles.includes(file)) {
        filesEditedByAI.push(file);
      } else {
        filesEditedManually.push(file);
      }
    }

    // Get detailed changes
    const recentChanges = await getRecentChanges(workspacePath, changedFiles);

    // Extract TODOs
    const todoItems = await extractTodos(workspacePath);

    // Generate recommendations
    const recommendations = generateRecommendations(
      filesEditedByAI,
      filesEditedManually,
      recentChanges,
      todoItems
    );

    // Generate continuation prompt
    const continuationPrompt = generateContinuationPrompt(
      filesEditedByAI,
      filesEditedManually,
      recentChanges,
      todoItems
    );

    // Get git branch and status
    const gitBranch = await getGitBranch(workspacePath);
    const gitStatus = await getGitStatus(workspacePath);

    // Determine most recently edited file
    const mostRecentFile = getMostRecentFile(recentChanges, filesEditedManually, filesEditedByAI);

    // Calculate time since last work (based on most recent file modification)
    const timeSinceLastWork = await getTimeSinceLastWork(workspacePath, recentChanges);

    return {
      filesEditedByAI,
      filesEditedManually,
      recentChanges,
      todoItems,
      recommendations,
      continuationPrompt,
      gitBranch,
      gitStatus,
      mostRecentFile,
      timeSinceLastWork,
    };
  } catch (error) {
    console.error('[Workspace Analysis] Error:', error);
    return null;
  }
}

/**
 * Get files edited with AI assistance from Cursor database
 * Uses a separate Node.js process to avoid Electron compatibility issues
 */
async function getAIEditedFiles(workspacePath: string, ideName: string): Promise<string[]> {
  if (ideName !== 'Cursor') return [];

  try {
    // Path to helper script (in src/helpers for dev, bundled location for prod)
    const helperPath = path.join(__dirname, '../helpers/read-cursor-db.js');

    // Fallback to src/helpers if not found (dev mode)
    const finalHelperPath = fs.existsSync(helperPath)
      ? helperPath
      : path.join(process.cwd(), 'src/helpers/read-cursor-db.js');

    if (!fs.existsSync(finalHelperPath)) {
      console.warn('[Workspace Analysis] Helper script not found:', finalHelperPath);
      return [];
    }

    // Run the helper script in a separate Node.js process
    // Note: better-sqlite3 requires native bindings that must be rebuilt for the Node.js version
    // This works in Electron context but may fail when testing standalone
    try {
      // Validate workspace path before using in command
      if (!validateFilePathForCommand(workspacePath)) {
        throw new Error(`Invalid workspace path: ${workspacePath}`);
      }
      const sanitizedWorkspacePath = sanitizeCommandArg(workspacePath);
      const sanitizedHelperPath = sanitizeCommandArg(finalHelperPath);
      
      const { stdout } = await execPromise(`node "${sanitizedHelperPath}" "${sanitizedWorkspacePath}"`, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      });
      
      const result = JSON.parse(stdout.trim());

      if (result.error) {
        console.warn('[Workspace Analysis] Helper script error:', result.error);
        return [];
      }

      return result.aiEditedFiles || [];
    } catch (execError: any) {
      // If the error is about native bindings, it's expected when testing standalone
      // In Electron context, this should work fine
      if (execError.stderr && execError.stderr.includes('bindings file')) {
        console.warn('[Workspace Analysis] Helper script requires native module bindings. This is expected when testing standalone. In Electron, this should work.');
      }
      // Re-throw to be caught by outer catch
      throw execError;
    }
  } catch (error) {
    console.warn('[Workspace Analysis] Could not read AI tracking:', error);
    return [];
  }
}

/**
 * Get changed files from git
 * Only includes files that are part of actual development work (source code, config, docs)
 * Excludes utility scripts, test files, and temporary files
 */
async function getChangedFiles(workspacePath: string): Promise<string[]> {
  try {
    // Get files changed since last commit
    const { stdout } = await execPromise('git diff --name-only HEAD', { cwd: workspacePath });
    const uncommittedFiles = stdout.trim().split('\n').filter(Boolean);

    // Also get files in last commit
    const { stdout: lastCommit } = await execPromise('git diff --name-only HEAD~1 HEAD', {
      cwd: workspacePath,
    }).catch(() => ({ stdout: '' }));
    const lastCommitFiles = lastCommit.trim().split('\n').filter(Boolean);

    // Combine and dedupe
    const allFiles = [...new Set([...uncommittedFiles, ...lastCommitFiles])];
    
    // Only include files that are part of actual development work
    // Include: source files, config files, documentation
    const developmentPatterns = [
      /^src\//,                    // All files in src/ directory
      /^package\.json$/,           // Package configuration
      /^package-lock\.json$/,       // Lock file
      /^tsconfig\.json$/,          // TypeScript config
      /^vite\.config\.ts$/,        // Vite config
      /^tailwind\.config\.js$/,    // Tailwind config
      /^postcss\.config\.js$/,     // PostCSS config
      /^README\.md$/,              // README
      /\.md$/,                     // Documentation files (but exclude in root that are utility docs)
    ];
    
    // Exclude utility scripts, test files, and temporary files
    const excludePatterns = [
      /^clear-.*\.js$/,            // clear-all-users.js, etc.
      /^force-.*\.js$/,            // force-delete-user.js, etc.
      /^reset-.*\.js$/,            // reset-user.js, etc.
      /^check-.*\.js$/,            // check-*.js utility scripts
      /^test-.*\.js$/,             // test-*.js files (standalone test scripts)
      /^create-.*\.js$/,           // create-*.js utility scripts
      /^what-.*\.ps1$/,            // PowerShell utility scripts
      /^launch-.*\.(bat|ps1)$/,    // Launch scripts
      /^start-.*\.(bat|ps1)$/,     // Start scripts
      /^final-.*\.ps1$/,           // Final check scripts
      /^debug-.*\.ps1$/,           // Debug scripts
      /^identify-.*\.ps1$/,        // Identify scripts
      /^check-.*\.ps1$/,           // Check scripts
      /\.log$/,                    // Log files
      /^nul$/,                     // nul file
      /^app-output\.log$/,         // App output logs
      /^electron-test\.log$/,      // Test logs
      /^localhost-.*\.log$/,       // Localhost logs
      /^FIX-.*\.md$/,              // Fix documentation (temporary)
      /^TEST-.*\.md$/,             // Test documentation (temporary)
      /^E2E-.*\.md$/,              // E2E test docs (temporary)
      /^TERMINAL-.*\.md$/,         // Terminal fix docs (temporary)
      /^IDE-.*\.md$/,              // IDE docs (temporary)
      /^SELF-.*\.md$/,             // Self capture docs (temporary)
      /^CONTEXT-.*\.md$/,          // Context docs (temporary)
      /^ELECTRON-.*\.md$/,         // Electron docs (temporary)
    ];
    
    const filteredFiles = allFiles.filter(file => {
      const fileName = path.basename(file);
      const filePath = file;
      
      // Exclude if it matches any exclude pattern
      if (excludePatterns.some(pattern => pattern.test(fileName) || pattern.test(filePath))) {
        return false;
      }
      
      // Include if it matches any development pattern
      if (developmentPatterns.some(pattern => pattern.test(filePath))) {
        return true;
      }
      
      // Exclude everything else (utility scripts, etc.)
      return false;
    });
    
    console.log(`[Workspace Analysis] Filtered ${allFiles.length} changed files down to ${filteredFiles.length} development files`);
    
    return filteredFiles;
  } catch (error) {
    console.warn('[Workspace Analysis] Not a git repo or no changes');
    return [];
  }
}

/**
 * Get detailed information about recent changes
 */
async function getRecentChanges(workspacePath: string, files: string[]): Promise<FileChange[]> {
  const changes: FileChange[] = [];

  for (const file of files.slice(0, 20)) {
    // Limit to 20 files
    try {
      const { stdout } = await execPromise(`git diff HEAD -- "${file}"`, { cwd: workspacePath });

      const linesAdded = (stdout.match(/^\+[^+]/gm) || []).length;
      const linesRemoved = (stdout.match(/^-[^-]/gm) || []).length;

      // Determine change type
      let changeType: 'added' | 'modified' | 'deleted' = 'modified';
      if (linesRemoved === 0 && linesAdded > 0) changeType = 'added';
      if (linesAdded === 0 && linesRemoved > 0) changeType = 'deleted';

      // Generate summary
      const summary = generateChangeSummary(file, changeType, linesAdded, linesRemoved);

      changes.push({
        file,
        changeType,
        linesAdded,
        linesRemoved,
        summary,
      });
    } catch (error) {
      // File might be new/deleted, skip
    }
  }

  return changes;
}

/**
 * Generate a human-readable summary of changes
 */
function generateChangeSummary(
  file: string,
  changeType: string,
  linesAdded: number,
  linesRemoved: number
): string {
  const fileName = path.basename(file);

  if (changeType === 'added') {
    return `Created ${fileName} (+${linesAdded} lines)`;
  }
  if (changeType === 'deleted') {
    return `Deleted ${fileName} (-${linesRemoved} lines)`;
  }

  if (linesAdded > linesRemoved * 2) {
    return `Expanded ${fileName} (+${linesAdded}, -${linesRemoved})`;
  }
  if (linesRemoved > linesAdded * 2) {
    return `Simplified ${fileName} (+${linesAdded}, -${linesRemoved})`;
  }

  return `Modified ${fileName} (+${linesAdded}, -${linesRemoved})`;
}

/**
 * Extract TODO comments from workspace files
 */
async function extractTodos(workspacePath: string): Promise<TodoItem[]> {
  const todos: TodoItem[] = [];

  try {
    // Search for TODO/FIXME comments in recent files
    const { stdout } = await execPromise(
      `git grep -n -i -E "TODO|FIXME|HACK|XXX|BUG" -- "*.ts" "*.tsx" "*.js" "*.jsx"`,
      { cwd: workspacePath }
    ).catch(() => ({ stdout: '' }));

    const lines = stdout.split('\n').filter(Boolean);

    for (const line of lines.slice(0, 10)) {
      // Limit to 10 TODOs
      const match = line.match(/^([^:]+):(\d+):(.+)$/);
      if (match) {
        const [, file, lineNum, text] = match;
        const cleanText = text.trim().replace(/^[/*#\s]+/, '');

        let priority: 'high' | 'medium' | 'low' = 'medium';
        if (/FIXME|BUG|CRITICAL/i.test(cleanText)) priority = 'high';
        if (/TODO|HACK/i.test(cleanText)) priority = 'medium';
        if (/XXX|NOTE/i.test(cleanText)) priority = 'low';

        todos.push({
          file,
          line: parseInt(lineNum),
          text: cleanText,
          priority,
        });
      }
    }
  } catch (error) {
    // No todos or not a git repo
  }

  return todos;
}

/**
 * Get current git branch
 */
async function getGitBranch(workspacePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execPromise('git branch --show-current', {
      cwd: workspacePath,
    });
    return stdout.trim() || undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * Get git status (modified and untracked files)
 */
async function getGitStatus(workspacePath: string): Promise<{ modified: string[]; untracked: string[] } | undefined> {
  try {
    const { stdout } = await execPromise('git status --short', {
      cwd: workspacePath,
    });
    
    const modified: string[] = [];
    const untracked: string[] = [];
    
    if (stdout) {
      stdout.split('\n').forEach(line => {
        line = line.trim();
        if (!line) return;
        
        if (line.startsWith('M ') || line.startsWith(' M') || line.startsWith('MM')) {
          modified.push(line.substring(2).trim());
        } else if (line.startsWith('??')) {
          untracked.push(line.substring(2).trim());
        }
      });
    }
    
    return { modified, untracked };
  } catch (error) {
    return undefined;
  }
}

/**
 * Determine the most recently edited file
 */
function getMostRecentFile(
  recentChanges: FileChange[],
  manualFiles: string[],
  aiFiles: string[]
): string | undefined {
  // Prioritize files with actual changes over just being in the list
  if (recentChanges.length > 0) {
    // Sort by lines changed (most significant changes first)
    const sorted = [...recentChanges].sort((a, b) => {
      const aTotal = a.linesAdded + a.linesRemoved;
      const bTotal = b.linesAdded + b.linesRemoved;
      return bTotal - aTotal;
    });
    return sorted[0].file;
  }
  
  // Fallback to first manual file, then AI file
  if (manualFiles.length > 0) {
    return manualFiles[0];
  }
  
  if (aiFiles.length > 0) {
    return aiFiles[0];
  }
  
  return undefined;
}

/**
 * Calculate time since last work
 */
async function getTimeSinceLastWork(
  workspacePath: string,
  recentChanges: FileChange[]
): Promise<string | undefined> {
  try {
    if (recentChanges.length === 0) {
      return undefined;
    }

    // Get modification times for changed files
    const fileTimes: number[] = [];
    
    for (const change of recentChanges.slice(0, 5)) {
      try {
        const filePath = path.join(workspacePath, change.file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          fileTimes.push(stats.mtime.getTime());
        }
      } catch {
        // Skip if file doesn't exist or can't be accessed
      }
    }

    if (fileTimes.length === 0) {
      return undefined;
    }

    const mostRecent = Math.max(...fileTimes);
    const now = Date.now();
    const diffMs = now - mostRecent;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 5) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
  } catch (error) {
    return undefined;
  }
}

/**
 * Generate intelligent recommendations for next steps
 * Returns detailed, actionable prompts suitable for AI assistance
 */
function generateRecommendations(
  aiFiles: string[],
  manualFiles: string[],
  changes: FileChange[],
  todos: TodoItem[]
): string[] {
  const recommendations: string[] = [];

  // Analyze recent work patterns and create detailed recommendations
  if (aiFiles.length > 0) {
    const fileList = aiFiles.slice(0, 3).map(f => path.basename(f)).join(', ');
    const more = aiFiles.length > 3 ? ` and ${aiFiles.length - 3} more` : '';
    recommendations.push(
      `Review and verify the AI-assisted changes in ${fileList}${more} to ensure they work correctly and handle edge cases properly.`
    );
  }

  if (manualFiles.length > 0) {
    const fileList = manualFiles.slice(0, 3).map(f => path.basename(f)).join(', ');
    const more = manualFiles.length > 3 ? ` and ${manualFiles.length - 3} more` : '';
    recommendations.push(
      `Add unit tests for the manually edited files (${fileList}${more}) to ensure the changes are working as expected and prevent regressions.`
    );
  }

  // Check for new files
  const newFiles = changes.filter(c => c.changeType === 'added');
  if (newFiles.length > 0) {
    const fileList = newFiles.slice(0, 3).map(c => path.basename(c.file)).join(', ');
    const more = newFiles.length > 3 ? ` and ${newFiles.length - 3} more` : '';
    recommendations.push(
      `Implement comprehensive tests for the newly created files (${fileList}${more}) to ensure they meet the requirements and handle error cases.`
    );
  }

  // High priority TODOs
  const highPriorityTodos = todos.filter(t => t.priority === 'high');
  if (highPriorityTodos.length > 0) {
    const todo = highPriorityTodos[0];
    recommendations.push(
      `Address the high-priority TODO in ${path.basename(todo.file)} at line ${todo.line}: ${todo.text}`
    );
  }

  // Look for incomplete implementations
  const hasTestFiles = changes.some(c => c.file.includes('.test.') || c.file.includes('.spec.'));
  const hasSourceFiles = changes.some(
    c => !c.file.includes('.test.') && !c.file.includes('.spec.')
  );

  if (hasSourceFiles && !hasTestFiles) {
    const sourceFiles = changes
      .filter(c => !c.file.includes('.test.') && !c.file.includes('.spec.'))
      .slice(0, 2)
      .map(c => path.basename(c.file))
      .join(' and ');
    recommendations.push(
      `Create test files for ${sourceFiles} to verify the functionality and ensure code quality.`
    );
  }

  // Check for documentation
  const hasDocs = changes.some(c => c.file.endsWith('.md') || c.file.includes('README'));
  if (changes.length > 5 && !hasDocs) {
    recommendations.push(
      `Update the project documentation to reflect the recent changes, including any new features, API changes, or configuration updates.`
    );
  }

  // If we have significant changes but no specific recommendations, suggest review
  if (recommendations.length === 0 && changes.length > 0) {
    const mainChange = changes[0];
    recommendations.push(
      `Review and test the changes in ${path.basename(mainChange.file)} (${mainChange.summary}) to ensure everything works as expected.`
    );
  }

  return recommendations.slice(0, 5); // Top 5 recommendations
}

/**
 * Generate a continuation prompt that can be copy-pasted into AI chat
 * This is a complete, ready-to-use prompt for continuing work
 */
function generateContinuationPrompt(
  aiFiles: string[],
  manualFiles: string[],
  changes: FileChange[],
  todos: TodoItem[]
): string {
  let prompt = '## 🚀 Continuation Prompt\n\n';
  prompt += 'Copy and paste this prompt into your AI assistant to continue where you left off:\n\n';
  prompt += '```\n';

  // Build a natural language summary of what was done
  const workSummary: string[] = [];
  
  if (changes.length > 0) {
    const significantChanges = changes.slice(0, 3);
    const changeDescriptions = significantChanges.map(c => {
      if (c.changeType === 'added') {
        return `created ${path.basename(c.file)}`;
      } else if (c.changeType === 'deleted') {
        return `deleted ${path.basename(c.file)}`;
      } else {
        return `modified ${path.basename(c.file)} (${c.linesAdded} additions, ${c.linesRemoved} deletions)`;
      }
    });
    
    if (changeDescriptions.length === 1) {
      workSummary.push(`I just ${changeDescriptions[0]}.`);
    } else if (changeDescriptions.length === 2) {
      workSummary.push(`I just ${changeDescriptions[0]} and ${changeDescriptions[1]}.`);
    } else {
      workSummary.push(`I just ${changeDescriptions[0]}, ${changeDescriptions[1]}, and ${changeDescriptions[2]}.`);
      if (changes.length > 3) {
        workSummary.push(`I also made ${changes.length - 3} other change(s).`);
      }
    }
  }

  if (aiFiles.length > 0) {
    const fileList = aiFiles.slice(0, 3).map(f => path.basename(f)).join(', ');
    const more = aiFiles.length > 3 ? ` and ${aiFiles.length - 3} more files` : '';
    workSummary.push(`Some of these changes were made with AI assistance (${fileList}${more}).`);
  }

  // Build the actual prompt
  if (workSummary.length > 0) {
    prompt += workSummary.join(' ') + '\n\n';
  }

  // Add context about what to do next
  if (todos.length > 0) {
    const topTodo = todos[0];
    prompt += `I need to address a TODO in ${path.basename(topTodo.file)} at line ${topTodo.line}: ${topTodo.text}\n\n`;
    prompt += `Please help me implement this TODO and ensure it integrates well with the existing codebase.\n`;
  } else if (changes.length > 0) {
    const mainChange = changes[0];
    if (mainChange.changeType === 'added') {
      prompt += `I've created ${path.basename(mainChange.file)}. Please help me complete the implementation, add proper error handling, and ensure it follows the project's coding standards.\n`;
    } else if (mainChange.changeType === 'modified') {
      prompt += `I've been working on ${path.basename(mainChange.file)}. Please help me review the changes, add any missing functionality, and ensure everything is working correctly.\n`;
    } else {
      prompt += `I've made changes to the codebase. Please help me continue the work, review what's been done, and suggest next steps.\n`;
    }
  } else {
    prompt += `I'm ready to continue working on this project. Please help me identify the next logical step and implement it.\n`;
  }

  // Add specific guidance
  if (manualFiles.length > 0 && !todos.length) {
    const fileList = manualFiles.slice(0, 2).map(f => path.basename(f)).join(' and ');
    prompt += `\nFocus on ${fileList} as these were recently modified manually and may need additional work or testing.\n`;
  }

  prompt += '```\n';

  return prompt;
}
