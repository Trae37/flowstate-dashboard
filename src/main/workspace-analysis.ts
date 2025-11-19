/**
 * Workspace Analysis Module
 * Analyzes git changes, tracks AI vs manual edits, generates next steps
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

const execPromise = promisify(exec);

export interface WorkspaceAnalysis {
  filesEditedByAI: string[];
  filesEditedManually: string[];
  recentChanges: FileChange[];
  todoItems: TodoItem[];
  recommendations: string[];
  continuationPrompt: string;
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

    return {
      filesEditedByAI,
      filesEditedManually,
      recentChanges,
      todoItems,
      recommendations,
      continuationPrompt,
    };
  } catch (error) {
    console.error('[Workspace Analysis] Error:', error);
    return null;
  }
}

/**
 * Get files edited with AI assistance from Cursor database
 */
async function getAIEditedFiles(workspacePath: string, ideName: string): Promise<string[]> {
  if (ideName !== 'Cursor') return [];

  try {
    const dbPath = path.join(
      process.env.APPDATA || os.homedir(),
      'Cursor',
      'User',
      'globalStorage',
      'state.vscdb'
    );

    if (!fs.existsSync(dbPath)) return [];

    const db = new Database(dbPath, { readonly: true });
    const result = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('aiCodeTrackingLines') as { value: string } | undefined;
    db.close();

    if (!result) return [];

    const aiTracking = JSON.parse(result.value as string);
    const aiFiles = aiTracking
      .map((item: any) => item.metadata?.fileName)
      .filter(Boolean)
      .map((filePath: string) => {
        // Normalize path (remove file:// prefix, convert to relative)
        let normalized = filePath.replace(/^file:\/\/\//, '').replace(/^\/([a-z]):/i, '$1:');
        normalized = normalized.replace(/\//g, '\\');

        // Convert to relative path if it's under workspace
        if (normalized.toLowerCase().startsWith(workspacePath.toLowerCase())) {
          normalized = normalized.substring(workspacePath.length + 1);
        }
        return normalized;
      });

    return [...new Set(aiFiles)] as string[];
  } catch (error) {
    console.warn('[Workspace Analysis] Could not read AI tracking:', error);
    return [];
  }
}

/**
 * Get changed files from git
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
    return [...new Set([...uncommittedFiles, ...lastCommitFiles])];
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
 * Generate intelligent recommendations for next steps
 */
function generateRecommendations(
  aiFiles: string[],
  manualFiles: string[],
  changes: FileChange[],
  todos: TodoItem[]
): string[] {
  const recommendations: string[] = [];

  // Analyze recent work patterns
  if (aiFiles.length > 0) {
    recommendations.push(`Review ${aiFiles.length} AI-assisted file(s) for correctness`);
  }

  if (manualFiles.length > 0) {
    recommendations.push(`${manualFiles.length} file(s) edited manually - consider tests`);
  }

  // Check for new files
  const newFiles = changes.filter(c => c.changeType === 'added');
  if (newFiles.length > 0) {
    recommendations.push(`Add tests for ${newFiles.length} new file(s)`);
  }

  // High priority TODOs
  const highPriorityTodos = todos.filter(t => t.priority === 'high');
  if (highPriorityTodos.length > 0) {
    recommendations.push(`Address ${highPriorityTodos.length} high-priority TODO(s)`);
  }

  // Look for incomplete implementations
  const hasTestFiles = changes.some(c => c.file.includes('.test.') || c.file.includes('.spec.'));
  const hasSourceFiles = changes.some(
    c => !c.file.includes('.test.') && !c.file.includes('.spec.')
  );

  if (hasSourceFiles && !hasTestFiles) {
    recommendations.push('Consider adding tests for recent changes');
  }

  // Check for documentation
  const hasDocs = changes.some(c => c.file.endsWith('.md') || c.file.includes('README'));
  if (changes.length > 5 && !hasDocs) {
    recommendations.push('Update documentation to reflect recent changes');
  }

  return recommendations.slice(0, 5); // Top 5 recommendations
}

/**
 * Generate a continuation prompt similar to Claude Code
 */
function generateContinuationPrompt(
  aiFiles: string[],
  manualFiles: string[],
  changes: FileChange[],
  todos: TodoItem[]
): string {
  let prompt = '## 🚀 Continuation Prompt\n\n';

  // Summarize recent work
  prompt += '### What Was Done\n\n';

  if (aiFiles.length > 0) {
    prompt += `**AI-Assisted Changes** (${aiFiles.length} files):\n`;
    aiFiles.slice(0, 5).forEach(file => {
      const fileName = path.basename(file);
      prompt += `- ${fileName}\n`;
    });
    if (aiFiles.length > 5) {
      prompt += `- ... and ${aiFiles.length - 5} more\n`;
    }
    prompt += '\n';
  }

  if (manualFiles.length > 0) {
    prompt += `**Manual Changes** (${manualFiles.length} files):\n`;
    manualFiles.slice(0, 5).forEach(file => {
      const fileName = path.basename(file);
      prompt += `- ${fileName}\n`;
    });
    if (manualFiles.length > 5) {
      prompt += `- ... and ${manualFiles.length - 5} more\n`;
    }
    prompt += '\n';
  }

  // Summary of changes
  if (changes.length > 0) {
    prompt += '**Recent Activity**:\n';
    changes.slice(0, 3).forEach(change => {
      prompt += `- ${change.summary}\n`;
    });
    prompt += '\n';
  }

  // Next steps
  prompt += '### 📋 Recommended Next Steps\n\n';

  if (todos.length > 0) {
    const topTodos = todos.slice(0, 3);
    topTodos.forEach((todo, i) => {
      prompt += `${i + 1}. **${path.basename(todo.file)}:${todo.line}** - ${todo.text}\n`;
    });
  } else {
    prompt += '1. Review and test recent changes\n';
    prompt += '2. Update documentation if needed\n';
    prompt += '3. Consider edge cases and error handling\n';
  }

  prompt += '\n### 💡 Where to Continue\n\n';
  if (aiFiles.length > 0) {
    prompt += `Start by reviewing **${path.basename(aiFiles[0])}** - verify the AI changes work as expected.\n`;
  } else if (todos.length > 0) {
    prompt += `Address the TODO in **${path.basename(todos[0].file)}** at line ${todos[0].line}.\n`;
  } else if (manualFiles.length > 0) {
    prompt += `Continue working on **${path.basename(manualFiles[0])}**.\n`;
  } else {
    prompt += 'All caught up! Consider your next feature or improvement.\n';
  }

  return prompt;
}
