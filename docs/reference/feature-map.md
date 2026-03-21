# Night Watch CLI - Comprehensive Feature Map

## Overview

Night Watch CLI is an AI-powered project management tool that automates software development workflows through AI agents. It operates across four main packages: `core`, `cli`, `server`, and a web interface.

## 1. Agent Personas & System Architecture

### Core Job Types (7 Jobs)

Night Watch follows a **Job Registry pattern** for scalable job architecture. Each job type has specific configurations and responsibilities:

#### 1.1 Executor (`executor`)

- **Purpose**: Creates implementation PRs from Product Requirements Documents (PRDs)
- **CLI Command**: `run`
- **Schedule**: Every 2 hours (default: `5 */2 * * *`)
- **Max Runtime**: 2 hours (7200s)
- **Priority**: 50 (highest priority)
- **Env Prefix**: `NW_EXECUTOR`

#### 1.2 Reviewer (`reviewer`)

- **Purpose**: Reviews and improves PRs on night-watch branches
- **CLI Command**: `review`
- **Schedule**: Every 3 hours (default: `25 */3 * * *`)
- **Max Runtime**: 1 hour (3600s)
- **Priority**: 40
- **Env Prefix**: `NW_REVIEWER`
- **Features**:
  - Minimum review score threshold (default: 80/100)
  - Retry mechanism for failed reviews (max 2 attempts)
  - Auto-merge on high score

#### 1.3 Slicer (`slicer`)

- **Purpose**: Generates PRDs from roadmap items
- **CLI Command**: `planner` (also `slice`)
- **Schedule**: Every 6 hours (default: `35 */6 * * *`)
- **Max Runtime**: 10 minutes (600s)
- **Priority**: 30
- **Env Prefix**: `NW_PLANNER`
- **Roadmap Integration**: Parses ROADMAP.md files

#### 1.4 QA (`qa`)

- **Purpose**: Automated UI testing and quality assurance
- **CLI Command**: `qa`
- **Schedule**: 3x daily (staggered: `45 2,10,18 * * *`)
- **Max Runtime**: 1 hour (3600s)
- **Priority**: 20
- **Env Prefix**: `NW_QA`
- **Features**:
  - Playwright integration for UI testing
  - Artifact capture (screenshots/videos)
  - Branch pattern filtering
  - Skip label support

#### 1.5 Audit (`audit`)

- **Purpose**: Code quality and security audits
- **CLI Command**: `audit`
- **Schedule**: Weekly on Monday 03:50 (default: `50 3 * * 1`)
- **Max Runtime**: 30 minutes (1800s)
- **Priority**: 15
- **Env Prefix**: `NW_AUDIT`
- **Output**: GitHub issues for findings

#### 1.6 Analytics (`analytics`)

- **Purpose**: Product analytics analysis and insight generation
- **CLI Command**: `analytics`
- **Schedule**: Weekly on Monday 06:00 (default: `0 6 * * 1`)
- **Max Runtime**: 15 minutes (900s)
- **Priority**: 10
- **Env Prefix**: `NW_ANALYTICS`
- **Integration**: Amplitude data analysis
- **Output**: Creates GitHub issues for actionable findings

### Dynamic Agent Roles

Night Watch compiles different persona layers (Soul/Style/Skill) into system prompts through the **Soul Compiler** (`packages/core/src/soul-compiler.ts`). Each persona has specific roles:

- **Maya**: Mayan translator persona
- **Carlos**: Code reviewer persona
- **Priya**: Project manager persona
- **Dev**: Developer persona

## 2. Provider Configuration & Fallback System

### Built-in Provider Presets

Night Watch supports multiple AI providers with built-in configurations:

#### Claude Native

- Models: Sonnet 4.6, Opus 4.6
- Command: `claude`
- Auto-approve: `--dangerously-skip-permissions`

#### Proxy Providers (via ANTHROPIC_BASE_URL)

- **GLM-4.7**: `glm-47` preset
- **GLM-5**: `glm-5` preset
  - Uses api.z.ai as proxy
  - Extended timeouts (3000000ms)

#### Codex

- Command: `codex exec`
- Auto-approve: `--yolo`

### Rate Limit Fallback System

- **Automatic Fallback**: When a proxy provider hits rate limits, automatically falls back to native Claude
- **Dual Fallback Model**: Primary and secondary fallback models configured
- **Fallback Presets**: Can configure different preset IDs for fallbacks
- **Telegram Notifications**: Sends immediate alert when fallback is triggered

### Per-Job Provider Configuration

Different jobs can use different providers:

```typescript
{
  executor: 'glm-5',
  reviewer: 'claude',
  qa: 'codex'
}
```

### Time-based Provider Schedule Overrides

Schedule-based provider switching:

```typescript
{
  label: "Night Surge - Claude",
  presetId: "claude-sonnet-4-6",
  days: [0, 1, 2, 3, 4], // Sunday-Thursday
  startTime: "23:00",
  endTime: "04:00", // Cross-midnight
  jobTypes: ["executor"]
}
```

## 3. Board Integration & Project Management

### Board Provider Types

#### GitHub Projects V2

- Creates and manages GitHub projects
- Automated column management: Draft → Ready → In Progress → Review → Done
- Issue tracking with PR integration
- Board setup via `night-watch board setup`

#### Local Kanban (SQLite)

- Local board implementation using SQLite
- Same interface as GitHub boards
- For local development/testing

### Board Operations

- **Setup Board**: Creates a new project board with lifecycle columns
- **Create Issue**: Adds new issues to specified columns
- **Move Issues**: Drag-and-drop between columns
- **Auto-Placement**: Issues automatically placed in appropriate columns based on workflow

## 4. PRD (Product Requirements Document) System

### PRD Structure

- **Location**: `docs/prds/` by default
- **Format**: Markdown with specific sections
- **Complexity Scoring**: Automatic complexity assessment (LOW/MEDIUM/HIGH)
- **Dependencies**: Automatic dependency tracking

### PRD States

- **ready**: Ready for execution
- **blocked**: Blocked on dependencies
- **in-progress**: Currently being implemented
- **pending-review**: Implementation done, awaiting review
- **done**: Completed and merged

### PRD Priority System

Explicit priority list determines execution order:

```typescript
prdPriority: ['auth-system', 'user-profile', 'dashboard'];
```

## 5. Roadmap Integration

### ROADMAP.md Format

Supports two formats:

1. **Checklist Format**:

   ```
   ## Section
   - [ ] Feature title
   - Description
   ```

2. **Heading Format**:
   ```
   ## Section
   ### Feature title
   Description body
   ```

### Roadmap Scanner Features

- **Auto-Scanning**: Scans ROADMAP.md every 5 minutes (default)
- **Slicer Integration**: Automatically converts roadmap items to PRDs
- **State Tracking**: Tracks processed vs pending items
- **Priority Modes**:
  - `roadmap-first`: Roadmap items take priority
  - `audit-first`: Audit findings take priority

### Roadmap Context Compiler

Generates context for AI agents by:

- Compiling roadmap data
- Generating summaries or full details
- Character-limited output for different use cases

## 6. Global Job Queue System

### Queue Modes

- **Conservative**: Strict serial dispatch (one job at a time)
- **Provider-Aware**: Allows cross-provider parallelism with capacity limits

### Provider Buckets

Capacity limits per provider:

```typescript
{
  'claude-native': { maxConcurrency: 1 },
  'codex': { maxConcurrency: 2 },
  'claude-proxy:api.z.ai': { maxConcurrency: 1 }
}
```

### Queue Features

- **Priority Dispatching**: Job type-based priority
- **Timeout Protection**: Jobs expire after 2 hours (default)
- **Provider-Aware Scheduling**: Respects provider capacity limits
- **Cross-Project Coordination**: Balances load across multiple projects

## 7. Quality Assurance (QA) System

### QA Process

- **Trigger**: On specific branch patterns
- **Artifacts**: Screenshots, videos, or both
- **Skip Option**: Label `skip-qa` to bypass QA
- **Auto-Install**: Automatically installs Playwright if missing

### QA Scenarios

- **Visual Regression**: Compares screenshots
- **Functional Testing**: Automated user flows
- **Cross-Browser Testing**: Multi-browser support

## 8. Code Audit System

### Audit Process

- **Schedules**: Weekly automated audits
- **Categories**: Critical, High, Medium, Low severity findings
- **Output**: Creates GitHub issues for each finding
- **Location**: Specific file and line information

### Audit Findings Format

```
### Finding X
**Severity:** Critical
**Category:** Security
**Location:** src/auth/middleware.js
**Description:** SQL injection vulnerability
**Suggested Fix:** Use parameterized queries
```

## 9. Notification & Webhook System

### Supported Webhooks

- **Slack**: Incoming webhook support
- **Discord**: Webhook with embeds
- **Telegram**: Bot API with MarkdownV2

### Notification Events

- `run_started`: PRD execution started
- `run_succeeded`: PRD execution succeeded
- `run_failed`: PRD execution failed
- `run_timeout`: Execution timed out
- `review_completed`: PR review completed
- `review_ready_for_human`: PR ready for human review
- `pr_auto_merged`: PR auto-merged
- `rate_limit_fallback`: Fallback triggered
- `qa_completed`: QA testing completed

### Notification Context

Rich context including:

- Project name and PR details
- Branch and PR numbers
- Duration and exit codes
- File changes and stats
- QA screenshots
- Review retry information

## 10. Git & Branch Management

### Night-Watch Branches

- **Prefix**: `night-watch/` (default)
- **Patterns**: Matches `feat/` and `night-watch/` branches by default
- **Auto-Detection**: Detects default branch automatically

### Branch Operations

- **Auto-Merge**: Automatic merging of passing PRs
- **Merge Methods**: Squash, merge, or rebase
- **Worktree Management**: Isolated development environments

## 11. Configuration System

### Configuration Hierarchy

1. **Global Config**: `~/.night-watch/projects.json`
2. **Project Config**: `night-watch.config.json`
3. **Environment Variables**: NW\_\* overrides
4. **CLI Flags**: Runtime overrides

### Key Configuration Areas

- **Scheduling**: Cron schedules for all jobs
- **Providers**: AI provider configurations
- **Board Settings**: Board provider and project settings
- **Notification**: Webhook configurations
- **Runtime Limits**: Max runtime per job type
- **Auto-Merge**: Automatic merge settings

## 12. Web Server & API

### REST API Endpoints

- **Config**: `/api/config` - Project configuration
- **Status**: `/api/status` - Live status snapshot
- **Board**: `/api/board` - Board operations
- **Queue**: `/api/queue` - Job queue management
- **Logs**: `/api/logs` - Log file access
- **Roadmap**: `/api/roadmap` - Roadmap status

### Server Features

- **SSE (Server-Sent Events)**: Real-time updates
- **CORS Support**: Cross-origin requests
- **Error Handling**: Graceful error responses

## 13. CLI Commands

### Core Commands

- `init`: Initialize night-watch in a project
- `install`: Install crontab entries
- `uninstall`: Remove crontab entries
- `status`: Show project status
- `doctor`: Run diagnostic checks

### Job Commands

- `run`: Manual PRD execution
- `review`: Manual PR review
- `qa`: Manual QA testing
- `audit`: Manual code audit
- `analytics`: Run analytics job
- `slice`: Generate PRD from roadmap
- `planner`: Alias for slice

### Management Commands

- `board`: Board management (setup, list, etc.)
- `queue`: Queue management (status, clear)
- `logs`: View log files
- `cancel`: Cancel running jobs
- `retry`: Retry failed jobs

### Dashboard Commands

- `dashboard`: Web-based dashboard
  - **Status Tab**: Live status overview
  - **Schedules Tab**: Cron schedule management
  - **Actions Tab**: Manual job triggers
  - **Logs Tab**: Live log streaming

## 14. Storage & Persistence

### SQLite Database

- **Kanban Issues**: Local board storage
- **Execution History**: Job execution records
- **PRD States**: PRD execution state
- **Roadmap State**: Roadmap processing state

### JSON State Files

- **Project Registry**: Global project list
- **Execution History**: Historical job data
- **PRD States**: Current PRD states
- **Global Notifications**: Shared webhook config

### Migration Support

- **State Migration**: JSON to SQLite migration
- **Version Compatibility**: Backward compatibility maintained

## 15. Templates & Customization

### Default Templates

- **Slicer Template**: PRD generation prompt
- **PRD Template**: Standard PRD structure
- **Review Template**: Code review prompts

### Custom Templates

- **Location**: `.night-watch/templates/`
- **Override**: Custom template files
- **Skins**: Custom persona configurations

## 16. Security & Safety Features

### Rate Limit Protection

- **Automatic Fallback**: Rate limit fallback to native Claude
- **Retry Logic**: Configurable retry attempts
- **Timeout Protection**: Job timeouts prevent runaway processes

### Isolation

- **Worktree Isolation**: Each job runs in isolated worktree
- **Process Locking**: Prevents concurrent job execution
- **Resource Limits**: Runtime and memory limits

### Validation

- **Input Validation**: Configuration and parameter validation
- **Error Handling**: Comprehensive error handling
- **Sanitization**: Input sanitization for security

## 17. Monitoring & Observability

### Logging

- **Structured Logging**: JSON-formatted logs
- **Log Rotation**: Automatic log file rotation
- **Log Levels**: Different verbosity levels
- **Context Tracking**: Operation context in logs

### Analytics Integration

- **Amplitude**: Product analytics integration
- **Custom Events**: Job execution tracking
- **Performance Metrics**: Duration and success rates

### Status Monitoring

- **Live Dashboard**: Web-based real-time monitoring
- **Status Snapshots**: Periodic status collection
- **Health Checks**: Service health monitoring

## 18. Development Workflow Integration

### CI/CD Integration

- **Branch Protection**: Protection for night-watch branches
- **Status Checks**: PR status updates
- **Auto-Merge**: Automatic merge on success

### Collaboration Features

- **PR Comments**: Automatic review comments
- **Issue Creation**: Automatic issue creation
- **Notifications**: Team notifications via webhooks

### Development Tools

- **Git Utilities**: Git operations helpers
- **Shell Integration**: Shell command execution
- **Script Result Processing**: Script output parsing

## 19. Performance & Scalability

### Concurrency Control

- **Job Queue**: Global job queue with priority
- **Provider Limits**: Per-provider concurrency limits
- **Resource Management**: Efficient resource usage

### Caching

- **Configuration Cache**: Runtime configuration caching
- **State Caching**: State data caching
- **Git Cache**: Git operation caching

### Optimization

- **Lazy Loading**: On-demand resource loading
- **Parallel Processing**: Parallel job execution where possible
- **Efficient Algorithms**: Optimized data processing

## 20. Extensibility & Customization

### Plugin System

- **Job Types**: Custom job type registration
- **Provider Presets**: Custom provider configurations
- **Board Providers**: Custom board integration

### API Extensions

- **Custom Endpoints**: Extendable REST API
- **Webhook Handlers**: Custom webhook processing
- **Template Extensions**: Custom template handlers

### Configuration Extensions

- **Custom Fields**: Extended configuration options
- **Environment Variables**: Environment-based configuration
- **Runtime Overrides**: Dynamic configuration changes

## Summary

Night Watch CLI is a comprehensive AI-powered development automation platform with:

- **7 Job Types**: Covering the full development lifecycle
- **Multiple Provider Support**: Claude, Codex, GLM with fallback system
- **Board Integration**: GitHub Projects and local Kanban support
- **Advanced Scheduling**: Cron-based with priority and override system
- **Quality Assurance**: Automated testing with artifact capture
- **Notification System**: Multi-platform webhook support
- **Git Integration**: Branch management and auto-merge
- **Web Interface**: Real-time dashboard and API
- **Extensible Architecture**: Plugin and customization support

The system follows SOLID principles with a clear separation of concerns, dependency injection, and a modular architecture that makes it easy to extend and maintain.
