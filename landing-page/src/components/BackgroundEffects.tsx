import { useEffect, useState } from 'react';

function StarLayer({ count, size, className }: { count: number; size: number; className: string }) {
  const [stars, setStars] = useState<{ x: number; y: number; opacity: number }[]>([]);

  useEffect(() => {
    const newStars = Array.from({ length: count }).map(() => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      opacity: Math.random() * 0.8 + 0.2,
    }));
    setStars(newStars);
  }, [count]);

  return (
    <div className={`absolute inset-0 ${className}`}>
      {stars.map((star, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: `${size}px`,
            height: `${size}px`,
            opacity: star.opacity,
          }}
        />
      ))}
    </div>
  );
}

export function BackgroundEffects() {
  return (
    <div className="fixed inset-0 z-[-1] overflow-hidden bg-[#02040a]">
      {/* Star layers */}
      <StarLayer count={150} size={1} className="animate-twinkle opacity-40" />
      <StarLayer count={75} size={2} className="animate-twinkle-delayed opacity-60" />
      <StarLayer count={25} size={3} className="animate-twinkle opacity-80" />

      {/* The Moon */}
      <div className="absolute top-[5%] right-[-20%] md:right-[10%] w-64 h-64 md:w-96 md:h-96 rounded-full bg-gradient-to-br from-slate-200 via-slate-400 to-slate-900 shadow-[0_0_120px_30px_rgba(99,102,241,0.15),inset_-16px_-16px_40px_rgba(0,0,0,0.9)] opacity-90 mix-blend-screen animate-float-rotate">
        {/* Moon craters */}
        <div className="absolute top-[20%] left-[25%] w-16 h-16 bg-slate-900/30 rounded-full blur-[2px] shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5)]"></div>
        <div className="absolute top-[45%] left-[60%] w-24 h-24 bg-slate-900/30 rounded-full blur-[3px] shadow-[inset_4px_4px_8px_rgba(0,0,0,0.5)]"></div>
        <div className="absolute bottom-[20%] left-[35%] w-12 h-12 bg-slate-900/30 rounded-full blur-[1px] shadow-[inset_2px_2px_4px_rgba(0,0,0,0.5)]"></div>
        <div className="absolute top-[60%] left-[15%] w-8 h-8 bg-slate-900/20 rounded-full blur-[1px]"></div>
        <div className="absolute top-[30%] right-[20%] w-10 h-10 bg-slate-900/20 rounded-full blur-[1px] shadow-[inset_2px_2px_4px_rgba(0,0,0,0.4)]"></div>
      </div>

      {/* Grid - faded at top to show sky */}
      <div
        className="absolute inset-0 bg-grid-pattern opacity-40"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 10%, black 50%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 10%, black 50%, transparent 100%)',
        }}
      ></div>

      {/* Glowing Orbs / Aurora */}
      <div className="absolute top-[10%] left-[-10%] w-[50%] h-[40%] bg-indigo-600/20 rounded-full mix-blend-screen filter blur-[120px] animate-blob"></div>
      <div className="absolute top-[30%] right-[-10%] w-[40%] h-[50%] bg-purple-600/15 rounded-full mix-blend-screen filter blur-[120px] animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-10%] left-[20%] w-[50%] h-[40%] bg-blue-600/15 rounded-full mix-blend-screen filter blur-[120px] animate-blob animation-delay-4000"></div>

      {/* Low Fog */}
      <div className="absolute bottom-0 left-0 w-full h-[40%] bg-gradient-to-t from-[#02040a] via-[#02040a]/80 to-transparent z-10 pointer-events-none"></div>

      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#02040a_120%)] opacity-80 z-20 pointer-events-none"></div>
    </div>
  );
}
