#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  PromptMessage,
  TextContent,
  Tool,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { ContextManager } from './context.js';

const execAsync = promisify(exec);

// Natural language patterns for task operations
const TASK_PATTERNS = {
  add: /^(add|create|new|make|todo|task)/i,
  list: /^(list|show|what|tasks|todos)/i,
  complete: /^(done|complete|finish|mark|check)/i,
  modify: /^(modify|change|update|edit)/i,
  delete: /^(delete|remove|rm)/i,
  prioritize: /^(prioritize|priority|urgent|important)/i,
  context: /^(where|context|project|current)/i,
  next: /^(next|now|focus|immediate)/i,
};

class TaskwarriorBridge {
  private currentContext: string = '';
  private contextManager: ContextManager;

  constructor(contextManager: ContextManager) {
    this.contextManager = contextManager;
  }

  async execute(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(`task ${command}`);
      if (stderr && !stderr.includes('Configuration override')) {
        console.error('Taskwarrior stderr:', stderr);
      }
      return stdout;
    } catch (error: any) {
      throw new Error(`Taskwarrior error: ${error.message}`);
    }
  }

  async parseNaturalLanguage(input: string): Promise<{ action: string; args: string }> {
    // Detect action from natural language
    let action = 'list';
    let args = input;

    for (const [key, pattern] of Object.entries(TASK_PATTERNS)) {
      if (pattern.test(input)) {
        action = key;
        args = input.replace(pattern, '').trim();
        break;
      }
    }

    // Get current context to filter tasks
    const context = await this.contextManager.detectContext();
    const projectFilter = context.currentProject ? `project:${context.currentProject}` : '';

    // Convert natural language to Taskwarrior commands
    switch (action) {
      case 'add':
        return { action: 'add', args };
      case 'list':
        let listArgs = '';
        if (args.includes('today') || args.includes('now')) {
          listArgs = `due:today ${projectFilter}`.trim();
        } else if (args.includes('urgent') || args.includes('high')) {
          listArgs = `priority:H ${projectFilter}`.trim();
        } else if (args.includes('project')) {
          const projectMatch = args.match(/project[: ](\S+)/i);
          if (projectMatch) {
            listArgs = `project:${projectMatch[1]}`;
          }
        } else {
          listArgs = projectFilter;
        }
        return { action: 'list', args: listArgs };
      case 'complete':
        const taskIdMatch = args.match(/\d+/);
        if (taskIdMatch) {
          return { action: 'done', args: taskIdMatch[0] };
        }
        return { action: 'done', args: '1' }; // Default to first task
      case 'next':
        return { action: 'next', args: projectFilter };
      case 'context':
        if (args) {
          return { action: 'context', args };
        }
        return { action: 'context', args: 'list' };
      default:
        return { action, args };
    }
  }

  formatOutput(output: string, action: string): string {
    // Clean up Taskwarrior output for better AI consumption
    const lines = output.split('\n').filter(line => line.trim());

    if (action === 'list' || action === 'next') {
      // Extract task information more clearly
      const tasks = [];
      let inTaskList = false;

      for (const line of lines) {
        if (line.match(/^\s*ID\s+/)) {
          inTaskList = true;
          continue;
        }
        if (inTaskList && line.match(/^\s*\d+\s+/)) {
          tasks.push(line.trim());
        }
        if (line.includes('tasks') && !inTaskList) {
          break;
        }
      }

      if (tasks.length > 0) {
        return `Current tasks:\n${tasks.join('\n')}`;
      }
    }

    return output;
  }
}

// MCP Server Implementation
class TaskwarriorMCPServer {
  private server: Server;
  private bridge: TaskwarriorBridge;
  private contextManager: ContextManager;

  constructor() {
    this.contextManager = new ContextManager();

    this.server = new Server(
      {
        name: 'mcp-taskwarrior-ai',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    this.bridge = new TaskwarriorBridge(this.contextManager);
    this.setupHandlers();

    // Initialize context detection
    this.contextManager.detectContext().catch(console.error);
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'task_natural',
          description: 'Execute Taskwarrior commands using natural language. Examples: "add fix the login bug", "show tasks for today", "what should I work on next", "mark task 5 as done", "list urgent tasks"',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language task query or command',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'task_raw',
          description: 'Execute raw Taskwarrior commands for advanced users',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Raw Taskwarrior command (without "task" prefix)',
              },
            },
            required: ['command'],
          },
        },
        {
          name: 'task_context_set',
          description: 'Set the current project/context for task operations',
          inputSchema: {
            type: 'object',
            properties: {
              context: {
                type: 'string',
                description: 'Project or context name (e.g., "myheb-android", "pharmacy", "DRX-12345")',
              },
            },
            required: ['context'],
          },
        },
        {
          name: 'task_smart_add',
          description: 'Add a task with intelligent parsing of priority, due dates, projects, and tags',
          inputSchema: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Task description',
              },
              project: {
                type: 'string',
                description: 'Project name (optional)',
              },
              priority: {
                type: 'string',
                enum: ['H', 'M', 'L'],
                description: 'Priority: H(igh), M(edium), L(ow)',
              },
              due: {
                type: 'string',
                description: 'Due date (e.g., "today", "tomorrow", "2024-01-15")',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for the task',
              },
            },
            required: ['description'],
          },
        },
        {
          name: 'task_eisenhower',
          description: 'Get tasks organized by Eisenhower Matrix (Urgent/Important quadrants)',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'task_ticket_sync',
          description: 'Sync tasks from a ticket checklist to Taskwarrior',
          inputSchema: {
            type: 'object',
            properties: {
              ticket: {
                type: 'string',
                description: 'Ticket ID (e.g., "DRX-12345")',
              },
            },
            required: ['ticket'],
          },
        },
        {
          name: 'task_where_am_i',
          description: 'Get current context and suggested next actions based on project state',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ] as Tool[],
    }));

    // List available prompts
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'daily_review',
          description: 'Get a daily review of tasks and priorities',
          arguments: [],
        },
        {
          name: 'weekly_planning',
          description: 'Plan tasks for the upcoming week',
          arguments: [],
        },
      ],
    }));

    // Get prompt content
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name } = request.params;

      let messages: PromptMessage[] = [];

      switch (name) {
        case 'daily_review':
          const todayTasks = await this.bridge.execute('due:today list');
          const urgentTasks = await this.bridge.execute('priority:H list');
          const nextTask = await this.bridge.execute('next limit:1');

          messages = [{
            role: 'user',
            content: {
              type: 'text',
              text: `Daily Task Review:\n\nToday's Tasks:\n${todayTasks}\n\nUrgent Tasks:\n${urgentTasks}\n\nRecommended Next Task:\n${nextTask}\n\nPlease provide a prioritized plan for the day.`,
            } as TextContent,
          }];
          break;

        case 'weekly_planning':
          const weekTasks = await this.bridge.execute('due.before:eow list');
          const projects = await this.bridge.execute('projects');

          messages = [{
            role: 'user',
            content: {
              type: 'text',
              text: `Weekly Planning:\n\nThis Week's Tasks:\n${weekTasks}\n\nActive Projects:\n${projects}\n\nPlease help organize these tasks for the week ahead.`,
            } as TextContent,
          }];
          break;

        default:
          throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
      }

      return { messages };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'task_natural': {
            const { query } = args as { query: string };
            const { action, args: taskArgs } = await this.bridge.parseNaturalLanguage(query);
            const result = await this.bridge.execute(`${action} ${taskArgs}`);
            return {
              content: [
                {
                  type: 'text',
                  text: this.bridge.formatOutput(result, action),
                },
              ],
            };
          }

          case 'task_raw': {
            const { command } = args as { command: string };
            const result = await this.bridge.execute(command);
            return {
              content: [
                {
                  type: 'text',
                  text: result,
                },
              ],
            };
          }

          case 'task_context_set': {
            const { context } = args as { context: string };
            // Set context as a tag or project filter
            const result = await this.bridge.execute(`context define ${context} project:${context} or +${context}`);
            await this.bridge.execute(`context ${context}`);
            return {
              content: [
                {
                  type: 'text',
                  text: `Context set to: ${context}\n${result}`,
                },
              ],
            };
          }

          case 'task_smart_add': {
            const params = args as {
              description: string;
              project?: string;
              priority?: string;
              due?: string;
              tags?: string[];
            };

            let command = `add "${params.description}"`;
            if (params.project) command += ` project:${params.project}`;
            if (params.priority) command += ` priority:${params.priority}`;
            if (params.due) command += ` due:${params.due}`;
            if (params.tags) {
              params.tags.forEach(tag => {
                command += ` +${tag}`;
              });
            }

            const result = await this.bridge.execute(command);
            return {
              content: [
                {
                  type: 'text',
                  text: `Task added successfully:\n${result}`,
                },
              ],
            };
          }

          case 'task_eisenhower': {
            // Get tasks by urgency and importance
            const urgent_important = await this.bridge.execute('priority:H due.before:tomorrow list');
            const not_urgent_important = await this.bridge.execute('priority:H due.after:today list');
            const urgent_not_important = await this.bridge.execute('priority:M,L due.before:tomorrow list');
            const not_urgent_not_important = await this.bridge.execute('priority:L due.after:today list');

            return {
              content: [
                {
                  type: 'text',
                  text: `Eisenhower Matrix:\n\n` +
                    `🔴 URGENT & IMPORTANT (Do First):\n${urgent_important}\n\n` +
                    `🟡 NOT URGENT & IMPORTANT (Schedule):\n${not_urgent_important}\n\n` +
                    `🟠 URGENT & NOT IMPORTANT (Delegate):\n${urgent_not_important}\n\n` +
                    `⚪ NOT URGENT & NOT IMPORTANT (Eliminate):\n${not_urgent_not_important}`,
                },
              ],
            };
          }

          case 'task_ticket_sync': {
            const { ticket } = args as { ticket: string };
            this.contextManager.setCurrentTicket(ticket);

            const tasks = await this.contextManager.getTicketTasks(ticket);
            const results = [];

            for (const taskDescription of tasks) {
              const enhancedDesc = this.contextManager.enhanceTaskDescription(taskDescription);
              try {
                await this.bridge.execute(`add ${enhancedDesc}`);
                results.push(`✓ Added: ${taskDescription}`);
              } catch (e: any) {
                results.push(`✗ Failed: ${taskDescription} - ${e.message}`);
              }
            }

            if (results.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `No tasks found for ticket ${ticket}. Make sure .tickets/${ticket}/mr-checklist.md exists.`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Synced tasks for ${ticket}:\n${results.join('\n')}`,
                },
              ],
            };
          }

          case 'task_where_am_i': {
            const context = await this.contextManager.detectContext();
            const contextInfo = [];

            if (context.currentTicket) {
              contextInfo.push(`Current Ticket: ${context.currentTicket}`);
            }
            if (context.currentProject) {
              contextInfo.push(`Current Project: ${context.currentProject}`);
            }
            if (context.workspacePath) {
              contextInfo.push(`Workspace: ${context.workspacePath}`);
            }

            // Get current task list for context
            let taskList = '';
            if (context.currentTicket) {
              taskList = await this.bridge.execute(`+${context.currentTicket} list`);
            } else if (context.currentProject) {
              taskList = await this.bridge.execute(`project:${context.currentProject} list`);
            } else {
              taskList = await this.bridge.execute('next limit:5');
            }

            // Get available tickets
            const tickets = await this.contextManager.listTickets();
            const ticketInfo = tickets.length > 0
              ? `\nAvailable Tickets:\n${tickets.map(t => `  - ${t}`).join('\n')}`
              : '';

            return {
              content: [
                {
                  type: 'text',
                  text: `Current Context:\n${contextInfo.join('\n')}\n\n` +
                    `Tasks for current context:\n${taskList}` +
                    ticketInfo +
                    `\n\nSuggested actions:\n` +
                    `- Use "task_natural" with queries like "what should I work on next"\n` +
                    `- Use "task_ticket_sync" to import tasks from a ticket\n` +
                    `- Use "task_smart_add" to add context-aware tasks`,
                },
              ],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        throw new McpError(ErrorCode.InternalError, error.message);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Taskwarrior AI Bridge running on stdio');
  }
}

// Start the server
const server = new TaskwarriorMCPServer();
server.run().catch(console.error);