import { motion } from 'motion/react';

export function DashboardPreview() {
  return (
    <section className="py-24 px-4 overflow-hidden relative">
      <div className="container mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Full visibility into your night shift
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Web dashboard included. Real-time updates via SSE. No extra hosting required.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="relative mx-auto max-w-5xl group"
        >
          {/* Massive glow behind dashboard */}
          <div className="absolute -inset-4 bg-gradient-to-r from-indigo-500/30 via-purple-500/20 to-indigo-500/30 blur-2xl opacity-50 group-hover:opacity-70 transition duration-1000 rounded-[3rem] -z-10"></div>

          <div className="relative rounded-2xl border border-white/10 bg-gray-900/60 backdrop-blur-xl p-2 shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-t from-[#030712] via-transparent to-transparent z-10 pointer-events-none rounded-2xl"></div>

            <div className="rounded-xl border border-gray-800/80 bg-[#0a0a0a]/90 overflow-hidden flex flex-col h-[500px]">
              {/* Fake Browser Header */}
              <div className="h-12 border-b border-gray-800/80 flex items-center px-4 gap-4 bg-[#111]/80 backdrop-blur-md">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/40 border border-yellow-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/40 border border-green-500/50"></div>
                </div>
                <div className="bg-gray-800/50 rounded-md h-6 flex-1 max-w-md mx-auto flex items-center justify-center text-xs text-gray-500 font-mono border border-white/5">
                  localhost:3000
                </div>
              </div>

              {/* Fake Dashboard Content */}
              <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="hidden md:flex w-48 border-r border-gray-800/50 p-4 flex-col gap-2 bg-gray-900/20">
                  <div className="h-6 w-24 bg-gray-800/80 rounded mb-4"></div>
                  <div className="h-8 w-full bg-indigo-500/10 border border-indigo-500/20 rounded text-indigo-400 text-xs flex items-center px-2">
                    Board
                  </div>
                  <div className="h-8 w-full bg-transparent hover:bg-gray-800/50 rounded text-gray-400 text-xs flex items-center px-2 transition-colors">
                    Pull Requests
                  </div>
                  <div className="h-8 w-full bg-transparent hover:bg-gray-800/50 rounded text-gray-400 text-xs flex items-center px-2 transition-colors">
                    Agents
                  </div>
                  <div className="h-8 w-full bg-transparent hover:bg-gray-800/50 rounded text-gray-400 text-xs flex items-center px-2 transition-colors">
                    Settings
                  </div>
                </div>

                {/* Main Area */}
                <div className="flex-1 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto bg-gradient-to-br from-transparent to-gray-900/20">
                  {/* Agent Status Bar */}
                  <div className="flex flex-wrap md:flex-nowrap gap-4">
                    {['Executor', 'Reviewer', 'QA', 'Auditor', 'Slicer'].map((agent, i) => (
                      <div
                        key={i}
                        className="flex-1 min-w-[100px] bg-gray-800/40 border border-white/5 rounded-lg p-3 backdrop-blur-sm"
                      >
                        <div className="text-xs text-gray-400 mb-1">{agent}</div>
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]' : 'bg-gray-600'}`}
                          ></div>
                          <div className="text-xs font-mono text-gray-300">
                            {i === 0 ? 'Running...' : 'Idle'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Kanban Board Fake */}
                  <div className="flex-1 flex overflow-x-auto md:overflow-visible gap-4 pb-4 md:pb-0 snap-x snap-mandatory hide-scrollbar">
                    {['Ready', 'In Progress', 'Review', 'Done'].map((col, i) => (
                      <div
                        key={i}
                        className="flex-none w-[260px] md:w-auto md:flex-1 bg-gray-800/20 border border-white/5 rounded-lg p-3 flex flex-col gap-3 min-h-[200px] snap-start"
                      >
                        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          {col}
                        </div>
                        {i === 0 && (
                          <>
                            <div className="bg-gray-800/80 border border-gray-700/50 rounded p-3 shadow-sm hover:border-gray-600 transition-colors">
                              <div className="text-xs text-gray-300 mb-2">Add dark mode toggle</div>
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-gray-500">#45</span>
                                <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">
                                  P2
                                </span>
                              </div>
                            </div>
                          </>
                        )}
                        {i === 1 && (
                          <div className="bg-gray-800/90 border border-indigo-500/50 rounded p-3 shadow-[0_0_15px_-3px_rgba(99,102,241,0.2)] relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500/20">
                              <div className="h-full bg-indigo-500 w-1/3 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></div>
                            </div>
                            <div className="text-xs text-gray-200 mb-2 mt-1">
                              Implement user settings
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] text-gray-500">#42</span>
                              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                Executor
                              </span>
                            </div>
                          </div>
                        )}
                        {i === 2 && (
                          <div className="bg-gray-800/80 border border-gray-700/50 rounded p-3 shadow-sm hover:border-gray-600 transition-colors">
                            <div className="text-xs text-gray-300 mb-2">Fix navigation bug</div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] text-gray-500">PR #16</span>
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
                                Score: 92
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
