import { MoonStar, Github } from 'lucide-react';

export function Footer() {
  return (
    <footer className="py-12 px-4 border-t border-white/5 bg-gray-950">
      <div className="container mx-auto max-w-6xl flex flex-col md:flex-row items-center justify-between gap-6">
        <a href="#" className="flex items-center gap-3 group">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-gray-900 to-black border border-gray-800 shadow-[0_0_15px_rgba(99,102,241,0.1)] group-hover:shadow-[0_0_20px_rgba(99,102,241,0.2)] group-hover:border-indigo-500/30 transition-all duration-300 overflow-hidden">
            <div className="absolute inset-0 bg-indigo-500/10 group-hover:bg-indigo-500/20 transition-colors"></div>
            <MoonStar className="w-4 h-4 text-indigo-400 group-hover:text-indigo-300 transition-colors relative z-10" />
            <div className="absolute -bottom-2 -right-2 w-5 h-5 bg-purple-500/30 blur-md rounded-full"></div>
            <div className="absolute -top-2 -left-2 w-5 h-5 bg-indigo-500/30 blur-md rounded-full"></div>
          </div>
          <span className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-200 to-gray-500 group-hover:to-gray-300 transition-colors">Night Watch</span>
        </a>
        
        <div className="flex items-center gap-6 text-sm text-gray-400">
          <a href="https://github.com/jonit-dev/night-watch-cli" className="hover:text-white transition-colors flex items-center gap-1">
            <Github className="w-4 h-4" /> GitHub
          </a>
          <a href="https://npmjs.com/package/@jonit-dev/night-watch-cli" className="hover:text-white transition-colors">npm</a>
          <a href="#docs" className="hover:text-white transition-colors">Docs</a>
          <a href="#license" className="hover:text-white transition-colors">License (MIT)</a>
        </div>
        
        <div className="text-sm text-gray-500 text-center md:text-right">
          <p>Built by <a href="https://github.com/jonit-dev" className="text-gray-400 hover:text-white transition-colors">jonit-dev</a></p>
          <p className="text-xs mt-1">Night Watch is open source. MIT licensed.</p>
        </div>
      </div>
    </footer>
  );
}
