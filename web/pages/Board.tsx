import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, X, ExternalLink } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import {
  useApi,
  fetchBoardStatus,
  createBoardIssue,
  moveBoardIssue,
  closeBoardIssue,
  BOARD_COLUMNS,
  IBoardIssue,
  BoardColumnName,
} from '../api';
import { useStore } from '../store/useStore';

const COLUMN_COLORS: Record<BoardColumnName, { dot: string; badge: 'neutral' | 'info' | 'warning' | 'success' | 'error' }> = {
  'Draft':      { dot: 'bg-slate-500',  badge: 'neutral'  },
  'Ready':      { dot: 'bg-green-500',  badge: 'success'  },
  'In Progress':{ dot: 'bg-blue-500',   badge: 'info'     },
  'Review':     { dot: 'bg-amber-500',  badge: 'warning'  },
  'Done':       { dot: 'bg-slate-600',  badge: 'neutral'  },
};

// ==================== Create Issue Modal ====================

interface CreateIssueModalProps {
  defaultColumn: BoardColumnName;
  onClose: () => void;
  onCreated: () => void;
}

const CreateIssueModal: React.FC<CreateIssueModalProps> = ({ defaultColumn, onClose, onCreated }) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [column, setColumn] = useState<BoardColumnName>(defaultColumn);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createBoardIssue({ title: title.trim(), body, column });
      addToast({ title: 'Issue created', message: `"${title.trim()}" added to ${column}`, type: 'success' });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create issue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <h2 className="text-lg font-semibold text-slate-100">New Board Issue</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Issue title..."
              required
              className="w-full bg-slate-950/50 border border-white/10 text-slate-200 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1.5">Column</label>
            <select
              value={column}
              onChange={e => setColumn(e.target.value as BoardColumnName)}
              className="w-full bg-slate-950/50 border border-white/10 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
            >
              {BOARD_COLUMNS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1.5">Body (optional)</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Issue description..."
              rows={5}
              className="w-full bg-slate-950/50 border border-white/10 text-slate-200 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 resize-none font-mono"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end space-x-3 pt-2">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? 'Creating...' : 'Create Issue'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Issue Detail Panel ====================

interface IssueDetailPanelProps {
  issue: IBoardIssue;
  onClose: () => void;
  onMoved: () => void;
  onClosed: () => void;
}

const IssueDetailPanel: React.FC<IssueDetailPanelProps> = ({ issue, onClose, onMoved, onClosed }) => {
  const [moving, setMoving] = useState(false);
  const [closing, setClosing] = useState(false);
  const { addToast } = useStore();

  const handleMove = async (column: BoardColumnName) => {
    if (column === issue.column) return;
    setMoving(true);
    try {
      await moveBoardIssue(issue.number, column);
      addToast({ title: 'Issue moved', message: `#${issue.number} moved to ${column}`, type: 'success' });
      onMoved();
      onClose();
    } catch (err) {
      addToast({ title: 'Move failed', message: err instanceof Error ? err.message : 'Failed to move issue', type: 'error' });
    } finally {
      setMoving(false);
    }
  };

  const handleClose = async () => {
    if (!confirm(`Close issue #${issue.number}: "${issue.title}"?`)) return;
    setClosing(true);
    try {
      await closeBoardIssue(issue.number);
      addToast({ title: 'Issue closed', message: `#${issue.number} closed on GitHub`, type: 'success' });
      onClosed();
      onClose();
    } catch (err) {
      addToast({ title: 'Close failed', message: err instanceof Error ? err.message : 'Failed to close issue', type: 'error' });
    } finally {
      setClosing(false);
    }
  };

  const col = issue.column ?? 'Draft';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0a0f1e] border-l border-white/10 w-full max-w-xl flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-white/5 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-slate-500 text-sm font-mono">#{issue.number}</span>
              <Badge variant={COLUMN_COLORS[col].badge}>{col}</Badge>
            </div>
            <h2 className="text-lg font-semibold text-slate-100 leading-snug">{issue.title}</h2>
            {issue.assignees.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">Assigned to: {issue.assignees.join(', ')}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-3 px-6 py-3 border-b border-white/5 flex-shrink-0 flex-wrap gap-y-2">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500">Move to:</span>
            {BOARD_COLUMNS.filter(c => c !== issue.column).map(c => (
              <button
                key={c}
                onClick={() => handleMove(c)}
                disabled={moving}
                className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100 border border-slate-700 transition-colors disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2 ml-auto">
            {issue.url && !issue.url.startsWith('local://') && (
              <a
                href={issue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>GitHub</span>
              </a>
            )}
            <button
              onClick={handleClose}
              disabled={closing}
              className="text-xs px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
            >
              {closing ? 'Closing...' : 'Close Issue'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {issue.body ? (
            <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono leading-relaxed break-words">
              {issue.body}
            </pre>
          ) : (
            <p className="text-slate-500 text-sm italic">No description provided.</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ==================== Issue Card ====================

interface IssueCardProps {
  issue: IBoardIssue;
  onClick: () => void;
  onDragStart: (issue: IBoardIssue) => void;
}

const IssueCard: React.FC<IssueCardProps> = ({ issue, onClick, onDragStart }) => {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      className="relative"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('issueNumber', String(issue.number));
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);
        onDragStart(issue);
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <Card
        className={`p-3 cursor-grab hover:border-indigo-500/30 transition-all select-none ${isDragging ? 'opacity-30' : ''}`}
        onClick={onClick}
      >
        <span className="text-[10px] font-mono text-slate-600">#{issue.number}</span>
        <p className="text-xs font-medium text-slate-200 line-clamp-2 mt-0.5 leading-snug">{issue.title}</p>
        {issue.assignees.length > 0 && (
          <p className="text-[10px] text-slate-500 mt-1.5 truncate">{issue.assignees.join(', ')}</p>
        )}
      </Card>
    </div>
  );
};

// ==================== Board Column ====================

interface BoardColumnProps {
  name: BoardColumnName;
  issues: IBoardIssue[];
  draggingIssue: IBoardIssue | null;
  onIssueClick: (issue: IBoardIssue) => void;
  onNewIssue: (column: BoardColumnName) => void;
  onMoveIssue: (issue: IBoardIssue, column: BoardColumnName) => void;
  onDragStart: (issue: IBoardIssue) => void;
}

const BoardColumn: React.FC<BoardColumnProps> = ({ name, issues, draggingIssue, onIssueClick, onNewIssue, onMoveIssue, onDragStart }) => {
  const colors = COLUMN_COLORS[name];
  const [isDragOver, setIsDragOver] = useState(false);
  const isValidTarget = draggingIssue !== null && draggingIssue.column !== name;

  return (
    <div
      className={`flex flex-col min-w-[220px] max-w-[220px] h-full rounded-xl transition-colors ${isDragOver && isValidTarget ? 'bg-indigo-500/5 ring-1 ring-indigo-500/30' : ''}`}
      onDragOver={e => {
        if (!isValidTarget) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setIsDragOver(false);
        if (draggingIssue && draggingIssue.column !== name) {
          onMoveIssue(draggingIssue, name);
        }
      }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center space-x-2">
          <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{name}</span>
          <span className="text-[10px] font-bold text-slate-600 bg-slate-800 rounded-full px-1.5 py-0.5">{issues.length}</span>
        </div>
        <button
          onClick={() => onNewIssue(name)}
          className="p-1 rounded-md hover:bg-white/5 text-slate-600 hover:text-slate-400 transition-colors"
          title={`Add issue to ${name}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Issues */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-hide min-h-0">
        {issues.length === 0 ? (
          <div className={`border-2 border-dashed rounded-xl h-24 flex items-center justify-center transition-colors ${isDragOver && isValidTarget ? 'border-indigo-500/40' : 'border-slate-800'}`}>
            <span className="text-xs text-slate-700">{isDragOver && isValidTarget ? 'Drop here' : 'No issues'}</span>
          </div>
        ) : (
          issues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onClick={() => onIssueClick(issue)}
              onDragStart={onDragStart}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ==================== Board Page ====================

type ColumnMap = Record<BoardColumnName, IBoardIssue[]>;

const Board: React.FC = () => {
  const [selectedIssue, setSelectedIssue] = useState<IBoardIssue | null>(null);
  const [createColumn, setCreateColumn] = useState<BoardColumnName | null>(null);
  const [draggingIssue, setDraggingIssue] = useState<IBoardIssue | null>(null);
  // Optimistic overlay: applied immediately on move, cleared after server confirms
  const [optimisticColumns, setOptimisticColumns] = useState<ColumnMap | null>(null);
  const pendingMove = useRef(false);
  const { addToast, selectedProjectId, globalModeLoading } = useStore();

  const { data: boardStatus, loading, error, refetch } = useApi(
    fetchBoardStatus,
    [selectedProjectId],
    { enabled: !globalModeLoading },
  );

  // 30s polling — skip while a move is in-flight to avoid clobbering optimistic state
  useEffect(() => {
    const interval = setInterval(() => {
      if (!pendingMove.current) refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  const handleMoveIssue = useCallback(async (issue: IBoardIssue, column: BoardColumnName) => {
    setDraggingIssue(null);

    // Build optimistic column map from current display state
    const base = optimisticColumns ?? boardStatus?.columns;
    if (!base) return;

    const snapshot = base;
    const next: ColumnMap = {} as ColumnMap;
    for (const col of BOARD_COLUMNS) {
      next[col] = (base[col] ?? []).filter(i => i.number !== issue.number);
    }
    const movedIssue: IBoardIssue = { ...issue, column };
    next[column] = [...(next[column] ?? []), movedIssue];
    setOptimisticColumns(next);

    // Also keep selectedIssue in sync if it's the one being moved
    setSelectedIssue(prev => (prev?.number === issue.number ? movedIssue : prev));

    pendingMove.current = true;
    try {
      await moveBoardIssue(issue.number, column);
      refetch();
      // Clear optimistic state after refetch completes (brief delay to avoid flash)
      setTimeout(() => {
        setOptimisticColumns(null);
        pendingMove.current = false;
      }, 800);
    } catch (err) {
      // Revert
      setOptimisticColumns(snapshot as ColumnMap);
      setSelectedIssue(prev => (prev?.number === issue.number ? issue : prev));
      pendingMove.current = false;
      addToast({ title: 'Move failed', message: err instanceof Error ? err.message : 'Failed to move issue', type: 'error' });
    }
  }, [addToast, refetch, optimisticColumns, boardStatus]);

  if (globalModeLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading board...</div>
      </div>
    );
  }

  // Board not configured
  if (error && error.message.includes('Board not configured')) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="text-4xl">📋</div>
        <h2 className="text-xl font-semibold text-slate-200">Board not configured</h2>
        <p className="text-slate-500 text-sm max-w-sm text-center">
          Run <code className="font-mono bg-slate-800 px-2 py-0.5 rounded text-indigo-300">night-watch board setup</code> in your project to create a GitHub Projects board.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="text-slate-300">Failed to load board</div>
        <div className="text-sm text-slate-500">{error.message}</div>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!boardStatus) return null;

  const columns = optimisticColumns ?? boardStatus.columns;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Board</h1>
          <p className="text-sm text-slate-500 mt-1">
            {BOARD_COLUMNS.reduce((sum, c) => sum + (columns[c]?.length ?? 0), 0)} issues across {BOARD_COLUMNS.length} columns
          </p>
        </div>
        <Button onClick={() => setCreateColumn('Ready')}>
          <Plus className="h-4 w-4 mr-2" />
          New Issue
        </Button>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden" onDragEnd={() => setDraggingIssue(null)}>
        <div className="flex space-x-4 h-full pb-4" style={{ minWidth: `${BOARD_COLUMNS.length * 236}px` }}>
          {BOARD_COLUMNS.map(colName => (
            <BoardColumn
              key={colName}
              name={colName}
              issues={columns[colName] ?? []}
              draggingIssue={draggingIssue}
              onIssueClick={setSelectedIssue}
              onNewIssue={setCreateColumn}
              onMoveIssue={handleMoveIssue}
              onDragStart={setDraggingIssue}
            />
          ))}
        </div>
      </div>

      {/* Issue detail panel */}
      {selectedIssue && (
        <IssueDetailPanel
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          onMoved={() => refetch()}
          onClosed={() => refetch()}
        />
      )}

      {/* Create issue modal */}
      {createColumn && (
        <CreateIssueModal
          defaultColumn={createColumn}
          onClose={() => setCreateColumn(null)}
          onCreated={() => refetch()}
        />
      )}
    </div>
  );
};

export default Board;
