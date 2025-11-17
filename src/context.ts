import { readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface ProjectContext {
  currentTicket?: string;
  currentProject?: string;
  workspacePath?: string;
  ticketsPath?: string;
}

export class ContextManager {
  private context: ProjectContext = {};

  async detectContext(): Promise<ProjectContext> {
    const cwd = process.cwd();

    // Check if there's a .taskproject file that defines the project name
    const projectFilePath = join(cwd, '.taskproject');
    if (await this.exists(projectFilePath)) {
      const projectName = (await readFile(projectFilePath, 'utf-8')).trim();
      this.context.currentProject = projectName;
      this.context.workspacePath = cwd;
      this.context.ticketsPath = join(cwd, '.tickets');
    } else {
      // Try to detect from git repository name
      try {
        const result = await this.executeCommand('git rev-parse --show-toplevel');
        if (result) {
          const repoPath = result.trim();
          const repoName = repoPath.split('/').pop() || 'general';
          this.context.currentProject = repoName;
          this.context.workspacePath = repoPath;
          this.context.ticketsPath = join(repoPath, '.tickets');
        } else {
          // Fall back to current directory name
          const dirName = cwd.split('/').pop() || 'general';
          this.context.currentProject = dirName;
          this.context.workspacePath = cwd;
        }
      } catch {
        // If not in git repo, use directory name
        const dirName = cwd.split('/').pop() || 'general';
        this.context.currentProject = dirName;
        this.context.workspacePath = cwd;
      }
    }

    // Try to detect current ticket from common patterns
    try {
      // Check for .task-state.json in current workspace
      const taskStatePath = join(this.context.workspacePath || cwd, '.task-state.json');
      if (await this.exists(taskStatePath)) {
        const taskState = JSON.parse(await readFile(taskStatePath, 'utf-8'));
        if (taskState.currentFocus?.ticket) {
          this.context.currentTicket = taskState.currentFocus.ticket;
        }
      }
    } catch {
      // Ignore errors
    }

    // Try to get current git branch as potential ticket
    try {
      const branch = await this.executeCommand('git branch --show-current');
      if (branch && /^[A-Z]+-\d+/.test(branch)) {
        this.context.currentTicket = branch.trim();
      }
    } catch {
      // Ignore git errors
    }

    return this.context;
  }

  private async executeCommand(command: string): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(command);
      return stdout.trim();
    } catch {
      return '';
    }
  }

  async getTicketTasks(ticket: string): Promise<string[]> {
    if (!this.context.ticketsPath) return [];

    const ticketPath = join(this.context.ticketsPath, ticket);
    const tasks: string[] = [];

    // Check for mr-checklist.md
    const checklistPath = join(ticketPath, 'mr-checklist.md');
    if (await this.exists(checklistPath)) {
      const content = await readFile(checklistPath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.match(/^- \[ \] (.+)/);
        if (match) {
          tasks.push(match[1]);
        }
      }
    }

    // Check for context.md for additional tasks
    const contextPath = join(ticketPath, 'context.md');
    if (await this.exists(contextPath)) {
      const content = await readFile(contextPath, 'utf-8');
      // Extract TODO items
      const todoMatches = content.matchAll(/TODO[:\s]+(.+)/gi);
      for (const match of todoMatches) {
        tasks.push(match[1].trim());
      }
    }

    return tasks;
  }

  async listTickets(): Promise<string[]> {
    if (!this.context.ticketsPath) return [];

    try {
      const entries = await readdir(this.context.ticketsPath, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && e.name.startsWith('DRX-'))
        .map(e => e.name);
    } catch {
      return [];
    }
  }

  getContext(): ProjectContext {
    return this.context;
  }

  setCurrentTicket(ticket: string) {
    this.context.currentTicket = ticket;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  // Create Taskwarrior project/tag format
  formatTaskwarriorProject(): string {
    if (this.context.currentTicket) {
      return this.context.currentTicket;
    }
    if (this.context.currentProject) {
      return this.context.currentProject;
    }
    return 'general';
  }

  // Enhanced task description with context
  enhanceTaskDescription(description: string): string {
    const parts = [description];

    if (this.context.currentTicket) {
      // Add ticket as a tag if not already present
      if (!description.includes(this.context.currentTicket)) {
        parts.push(`+${this.context.currentTicket}`);
      }
    }

    if (this.context.currentProject && !description.includes('project:')) {
      parts.push(`project:${this.context.currentProject}`);
    }

    return parts.join(' ');
  }
}