import { useState } from 'react';
import { MoonStar, Github, Menu, X } from 'lucide-react';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-gray-950/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <a href="#" className="flex items-center gap-3 group">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-gray-900 to-black border border-gray-800 shadow-[0_0_20px_rgba(99,102,241,0.15)] group-hover:shadow-[0_0_25px_rgba(99,102,241,0.3)] group-hover:border-indigo-500/30 transition-all duration-300 overflow-hidden">
            <div className="absolute inset-0 bg-indigo-500/10 group-hover:bg-indigo-500/20 transition-colors"></div>
            <MoonStar className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300 transition-colors relative z-10" />
            <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-purple-500/30 blur-md rounded-full"></div>
            <div className="absolute -top-2 -left-2 w-6 h-6 bg-indigo-500/30 blur-md rounded-full"></div>
          </div>
          <span className="font-extrabold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 group-hover:to-gray-300 transition-colors">Night Watch</span>
        </a>
        
        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
          <a href="#agents" className="hover:text-white transition-colors">Agents</a>
          <a href="#docs" className="hover:text-white transition-colors">Docs</a>
        </nav>
        
        <div className="hidden md:flex items-center gap-4">
          <a href="https://github.com/jonit-dev/night-watch-cli" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
            <Github className="w-5 h-5" />
            <span>Star us</span>
          </a>
          <a href="#quick-start" className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
            Get Started
          </a>
        </div>

        {/* Mobile Menu Toggle */}
        <button 
          className="md:hidden text-gray-400 hover:text-white transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="md:hidden border-t border-white/5 bg-gray-950/95 backdrop-blur-xl absolute w-full">
          <nav className="flex flex-col p-4 gap-4 text-sm font-medium text-gray-400">
            <a href="#features" onClick={() => setIsOpen(false)} className="hover:text-white transition-colors px-2 py-1">Features</a>
            <a href="#how-it-works" onClick={() => setIsOpen(false)} className="hover:text-white transition-colors px-2 py-1">How It Works</a>
            <a href="#agents" onClick={() => setIsOpen(false)} className="hover:text-white transition-colors px-2 py-1">Agents</a>
            <a href="#docs" onClick={() => setIsOpen(false)} className="hover:text-white transition-colors px-2 py-1">Docs</a>
            <div className="h-px bg-white/10 my-2"></div>
            <a href="https://github.com/jonit-dev/night-watch-cli" target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-white transition-colors px-2 py-1">
              <Github className="w-5 h-5" /> GitHub
            </a>
            <a href="#quick-start" onClick={() => setIsOpen(false)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-3 rounded-md text-center mt-2 transition-colors">
              Get Started
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
