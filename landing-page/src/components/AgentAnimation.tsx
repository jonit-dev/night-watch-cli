import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { Player } from '@remotion/player';
import { Terminal, CheckSquare, GitPullRequest, CheckCircle2, Code2 } from 'lucide-react';

const KanbanColumn = ({ title, x }: { title: string, x: number }) => (
  <div style={{ position: 'absolute', left: x, top: 20, width: 180, height: 360, backgroundColor: '#111827', borderRadius: 12, border: '1px solid #1f2937', padding: 16 }}>
    <div style={{ color: '#9ca3af', fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{title}</div>
  </div>
);

const Ticket = ({ frame }: { frame: number }) => {
  const x = interpolate(frame,
    [50, 80, 140, 170, 230, 260],
    [30, 230, 230, 430, 430, 630],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const isCoding = frame > 80 && frame < 140;
  const isReviewing = frame > 190 && frame < 230;
  const isDone = frame >= 260;
  
  const pulseOpacity = interpolate(Math.sin(frame / 3), [-1, 1], [0.3, 1]);

  return (
    <div style={{
      position: 'absolute', left: x, top: 70, width: 160, backgroundColor: '#1f2937',
      border: `1px solid ${isDone ? '#10b981' : '#374151'}`, borderRadius: 8, padding: 12,
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
    }}>
      <div style={{ fontSize: 14, color: '#f3f4f6', fontWeight: 600, marginBottom: 8 }}>Auth Flow</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, color: '#9ca3af', backgroundColor: '#374151', padding: '2px 6px', borderRadius: 4 }}>#42</div>
        {isCoding && <Code2 size={14} color="#6366f1" style={{ opacity: pulseOpacity }} />}
        {isReviewing && <CheckSquare size={14} color="#10b981" style={{ opacity: pulseOpacity }} />}
        {isDone && <CheckCircle2 size={14} color="#10b981" />}
      </div>
    </div>
  );
};

const ExecutorAgent = ({ frame }: { frame: number }) => {
  const opacity = interpolate(frame, [20, 30, 170, 180], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const x = interpolate(frame, [50, 80, 140, 170], [30, 230, 230, 430], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(frame, [20, 30], [150, 130], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ position: 'absolute', left: x + 80, top: y, opacity, display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#6366f1', padding: '6px 10px', borderRadius: 20, boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.4)' }}>
      <Terminal size={14} color="white" />
      <span style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>Executor</span>
    </div>
  );
}

const ReviewerAgent = ({ frame }: { frame: number }) => {
  const opacity = interpolate(frame, [170, 180, 270, 280], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const x = interpolate(frame, [230, 260], [430, 630], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const y = interpolate(frame, [170, 180], [150, 130], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ position: 'absolute', left: x + 80, top: y, opacity, display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#10b981', padding: '6px 10px', borderRadius: 20, boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.4)' }}>
      <CheckSquare size={14} color="white" />
      <span style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>Reviewer</span>
    </div>
  );
}

const PRBadge = ({ frame }: { frame: number }) => {
  const { fps } = useVideoConfig();
  const scale = spring({ frame: frame - 190, fps, config: { damping: 12 } });
  const opacity = interpolate(frame, [250, 260], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  if (frame < 190) return null;

  return (
    <div style={{
      position: 'absolute', left: 450, top: 180, transform: `scale(${scale})`, opacity,
      backgroundColor: '#059669', color: 'white', padding: '6px 12px', borderRadius: 20,
      display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
      boxShadow: '0 4px 6px -1px rgba(5, 150, 105, 0.4)'
    }}>
      <GitPullRequest size={14} />
      PR #43 Opened
    </div>
  );
}

const MergedBadge = ({ frame }: { frame: number }) => {
  const { fps } = useVideoConfig();
  const scale = spring({ frame: frame - 260, fps, config: { damping: 12 } });

  if (frame < 260) return null;

  return (
    <div style={{
      position: 'absolute', left: 650, top: 180, transform: `scale(${scale})`,
      backgroundColor: '#8b5cf6', color: 'white', padding: '6px 12px', borderRadius: 20,
      display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
      boxShadow: '0 4px 6px -1px rgba(139, 92, 246, 0.4)'
    }}>
      <GitPullRequest size={14} />
      Merged
    </div>
  );
}

export const AgentComposition = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: '#030712', fontFamily: 'Inter, sans-serif' }}>
      <KanbanColumn title="Ready" x={20} />
      <KanbanColumn title="In Progress" x={220} />
      <KanbanColumn title="Review" x={420} />
      <KanbanColumn title="Done" x={620} />

      <Ticket frame={frame} />
      <ExecutorAgent frame={frame} />
      <ReviewerAgent frame={frame} />
      <PRBadge frame={frame} />
      <MergedBadge frame={frame} />
    </AbsoluteFill>
  );
};

export function AgentAnimationPlayer() {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 shadow-2xl bg-[#030712]">
      <div className="flex items-center px-4 py-3 border-b border-gray-800 bg-[#111827]">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
        </div>
        <div className="mx-auto text-xs text-gray-500 font-mono flex items-center gap-2">
          night-watch-pipeline.mp4
        </div>
      </div>
      <Player
        component={AgentComposition}
        durationInFrames={320}
        compositionWidth={820}
        compositionHeight={400}
        fps={30}
        style={{ width: '100%', height: 'auto', aspectRatio: '820 / 400' }}
        autoPlay
        loop
      />
    </div>
  );
}
