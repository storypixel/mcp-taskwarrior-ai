# MCP Taskwarrior AI Bridge

An AI-native Taskwarrior bridge that provides natural language task management for Claude Code and other AI systems. This MCP (Model Context Protocol) server extends Taskwarrior with context-aware, natural language capabilities while building on top of the existing Taskwarrior infrastructure.

## Features

- **Natural Language Processing**: Convert everyday language into Taskwarrior commands
- **Project Context Awareness**: Automatically detects current project/ticket context
- **Ticket Integration**: Sync tasks from ticket checklists (supports .tickets/ directory structure)
- **Eisenhower Matrix**: Organize tasks by urgency and importance
- **Smart Task Addition**: Intelligently parse priorities, due dates, projects, and tags
- **Shareable & Versioned**: Configuration can be tracked in Git

## Installation

### Prerequisites

1. Install Taskwarrior (if not already installed):
```bash
brew install task
```

2. Install Node.js (v20 or later):
```bash
brew install node
```

### Setup

1. Clone the repository:
```bash
git clone https://github.com/storypixel/mcp-taskwarrior-ai.git
cd mcp-taskwarrior-ai
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

### Integration with Claude Code

Add the server to your Claude Code MCP configuration:

1. Open your Claude Code settings
2. Add to MCP servers:

```json
{
  "mcpServers": {
    "taskwarrior": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/mcp-taskwarrior-ai/dist/index.js"],
      "env": {}
    }
  }
}
```

Or using the Claude CLI:
```bash
claude mcp add taskwarrior -s project -- node /path/to/mcp-taskwarrior-ai/dist/index.js
```

## Usage

### Natural Language Commands

The bridge understands natural language for task management:

- **Adding tasks**: "add fix the login bug", "create task for code review", "todo implement caching"
- **Listing tasks**: "show all tasks", "what should I work on next", "list urgent tasks", "show tasks for today"
- **Completing tasks**: "mark task 5 as done", "complete task 1", "finish the review task"
- **Context queries**: "where am I", "what's my current project", "show current context"

### Available Tools

#### `task_natural`
Execute Taskwarrior commands using natural language.

```typescript
{
  query: "add fix the authentication bug with high priority"
}
```

#### `task_smart_add`
Add tasks with structured metadata:

```typescript
{
  description: "Implement user authentication",
  project: "myheb-android",
  priority: "H",
  due: "tomorrow",
  tags: ["security", "auth"]
}
```

#### `task_ticket_sync`
Import tasks from a ticket's checklist:

```typescript
{
  ticket: "DRX-12345"
}
```

#### `task_eisenhower`
Get tasks organized by Eisenhower Matrix quadrants.

#### `task_where_am_i`
Get current context and suggested next actions based on project state.

#### `task_context_set`
Set the current project/context for all task operations:

```typescript
{
  context: "DRX-12345"
}
```

#### `task_raw`
Execute raw Taskwarrior commands for advanced users:

```typescript
{
  command: "modify 1 priority:H +urgent"
}
```

## Project Context Integration

The bridge automatically detects project context using:
1. **`.taskproject` file** - If present, defines the project name for Taskwarrior
2. **Git repository name** - Falls back to the repo name from git
3. **Directory name** - Uses current directory name if not in git

To override project detection, create a `.taskproject` file:
```bash
echo "my-project-name" > .taskproject
```

This is useful when one workspace manages tasks for another project.

The bridge also detects:
- Current Git branch (for ticket context)
- Task state from `.task-state.json`
- Ticket tasks from `.tickets/<ticket>/mr-checklist.md`

## Architecture

```
┌─────────────────┐
│  Claude Code    │
│   or AI Agent   │
└────────┬────────┘
         │ Natural Language
         ▼
┌─────────────────┐
│  MCP Server     │
│  - NLP Parser   │
│  - Context Mgr  │
└────────┬────────┘
         │ Taskwarrior Commands
         ▼
┌─────────────────┐
│   Taskwarrior   │
│   (task CLI)    │
└─────────────────┘
```

## Development

### Running in Development Mode

```bash
npm run dev
```

### Testing

Run the test script to verify the server is working:

```bash
node test.js
```

### Building

```bash
npm run build
```

## Configuration

The server uses your existing Taskwarrior configuration (`~/.taskrc`). You can customize Taskwarrior settings as usual.

### Context Detection

The bridge uses the current working directory and automatically detects project context.
No hardcoded paths or specific project names are used.

### Ticket Integration

Place ticket tasks in:
```
.tickets/
└── DRX-12345/
    ├── context.md       # Ticket context
    └── mr-checklist.md  # Tasks as checklist items
```

Format for `mr-checklist.md`:
```markdown
- [ ] Update unit tests
- [ ] Add documentation
- [ ] Run linting
```

## Prompts

The server includes built-in prompts:

### Daily Review
Get a prioritized plan for the day including today's tasks, urgent items, and recommended next actions.

### Weekly Planning
Organize tasks for the week ahead with active projects overview.

## Troubleshooting

### "Cannot proceed without rc file"

Initialize Taskwarrior:
```bash
task version
```

### Context not detected

Ensure you're in a project directory or have `.task-state.json` in your workspace.

### Ticket sync not finding tasks

Verify `.tickets/<ticket>/mr-checklist.md` exists and contains checkbox items.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Author

storypixel

## Acknowledgments

Built on top of [Taskwarrior](https://taskwarrior.org/) - the command-line task management tool.