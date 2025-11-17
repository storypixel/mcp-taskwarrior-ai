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
    // Check common workspace locations
    const possibleWorkspaces = [
      join(homedir(), 'Work'),
      join(homedir(), 'Projects'),
      process.cwd(),
    ];

    for (const workspace of possibleWorkspaces) {
      // Check for pharmacy-workspace
      const pharmacyWorkspace = join(workspace, 'pharmacy-workspace');
      if (await this.exists(pharmacyWorkspace)) {
        this.context.workspacePath = pharmacyWorkspace;
        this.context.ticketsPath = join(pharmacyWorkspace, '.tickets');

        // Try to detect current ticket from task state
        const taskStatePath = join(pharmacyWorkspace, '.task-state.json');
        if (await this.exists(taskStatePath)) {
          try {
            const taskState = JSON.parse(await readFile(taskStatePath, 'utf-8'));
            if (taskState.currentFocus?.ticket) {
              this.context.currentTicket = taskState.currentFocus.ticket;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }

        // Check for myheb-android
        const androidPath = join(workspace, 'myheb-android');
        if (await this.exists(androidPath)) {
          // Try to get current branch as potential ticket
          try {
            const headPath = join(androidPath, '.git', 'HEAD');
            const head = await readFile(headPath, 'utf-8');
            const match = head.match(/ref: refs\/heads\/(.+)/);
            if (match && match[1].startsWith('DRX-')) {
              this.context.currentTicket = match[1].trim();
            }
          } catch (e) {
            // Ignore git errors
          }
        }

        break;
      }
    }

    // Detect project from current directory
    const cwd = process.cwd();
    if (cwd.includes('myheb-android')) {
      this.context.currentProject = 'myheb-android';
    } else if (cwd.includes('pharmacy-workspace')) {
      this.context.currentProject = 'pharmacy-workspace';
    } else if (cwd.includes('heb-graphql')) {
      this.context.currentProject = 'heb-graphql';
    } else if (cwd.includes('mcp-taskwarrior')) {
      this.context.currentProject = 'mcp-taskwarrior-ai';
    }

    return this.context;
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