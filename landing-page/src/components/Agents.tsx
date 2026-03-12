import { Terminal, CheckSquare, Activity, Search, Scissors } from 'lucide-react';
import { motion } from 'motion/react';

const agents = [
  {
    name: "Executor",
    role: "Implements specs as code, opens PRs",
    schedule: "Hourly",
    icon: Terminal,
    color: "bg-indigo-500",
    glow: "group-hover:shadow-[0_0_30px_-5px_rgba(99,102,241,0.3)]",
    hoverText: "Branch created: feat/auth-flow"
  },
  {
    name: "Reviewer",
    role: "Scores PRs, requests fixes, auto-merges",
    schedule: "Every 3 hours",
    icon: CheckSquare,
    color: "bg-emerald-500",
    glow: "group-hover:shadow-[0_0_30px_-5px_rgba(16,185,129,0.3)]",
    hoverText: "Score: 87/100 — ready to merge"
  },
  {
    name: "QA",
    role: "Generates and runs Playwright e2e tests",
    schedule: "4x daily",
    icon: Activity,
    color: "bg-amber-500",
    glow: "group-hover:shadow-[0_0_30px_-5px_rgba(245,158,11,0.3)]",
    hoverText: "3 tests passed, 0 failed"
  },
  {
    name: "Auditor",
    role: "Scans codebase for quality issues",
    schedule: "Weekly",
    icon: Search,
    color: "bg-purple-500",
    glow: "group-hover:shadow-[0_0_30px_-5px_rgba(168,85,247,0.3)]",
    hoverText: "Found 2 unused dependencies"
  },
  {
    name: "Slicer",
    role: "Breaks roadmap items into granular specs",
    schedule: "Every 6 hours",
    icon: Scissors,
    color: "bg-pink-500",
    glow: "group-hover:shadow-[0_0_30px_-5px_rgba(236,72,153,0.3)]",
    hoverText: "Split epic into 4 sub-tasks"
  }
];

export function Agents() {
  return (
    <section id="agents" className="py-24 px-4 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
      <div className="container mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Five agents. One closed loop.</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">Specialized agents working together to move tickets from backlog to production.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.05 }}
              className={`group relative bg-gray-900/40 backdrop-blur-sm rounded-xl border border-white/5 overflow-hidden transition-all duration-300 hover:-translate-y-1 ${agent.glow}`}
            >
              <div className={`h-1 w-full ${agent.color} opacity-80 group-hover:opacity-100 transition-opacity`}></div>
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-800/80 flex items-center justify-center border border-gray-700 group-hover:bg-gray-800 transition-colors">
                    <agent.icon className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                  </div>
                  <span className="text-xs font-mono text-gray-500 bg-gray-950/50 px-2 py-1 rounded border border-gray-800">
                    {agent.schedule}
                  </span>
                </div>
                <h3 className="text-xl font-semibold mb-2 text-gray-100">{agent.name}</h3>
                <p className="text-sm text-gray-400 mb-4">{agent.role}</p>
                
                <div className="h-0 opacity-0 group-hover:h-auto group-hover:opacity-100 transition-all duration-300 overflow-hidden">
                  <div className="pt-4 border-t border-gray-800/50 mt-4">
                    <p className="text-xs font-mono text-indigo-400">{'>'} {agent.hoverText}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
