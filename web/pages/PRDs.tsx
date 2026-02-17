import React, { useState } from 'react';
import { Plus, Filter, SortAsc, LayoutList, LayoutGrid, MoreVertical, Trash, Play, Check, GripVertical } from 'lucide-react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { MOCK_PRDS } from '../constants';
import { Status, PRD } from '../types';

const PRDs: React.FC = () => {
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [prds, setPrds] = useState<PRD[]>(MOCK_PRDS);
  const [selectedPRD, setSelectedPRD] = useState<PRD | null>(null);

  const statusColors = {
    [Status.Ready]: 'success',
    [Status.InProgress]: 'info',
    [Status.Blocked]: 'error',
    [Status.Done]: 'neutral',
    [Status.Failed]: 'error',
  } as const;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setIsModalOpen(false);
    // Add logic here
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('list')}>
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === 'card' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('card')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-slate-800 mx-2"></div>
          <div className="flex space-x-1">
             <span className="px-3 py-1 bg-slate-800 text-slate-200 rounded-full text-xs font-medium cursor-pointer border border-slate-700">All</span>
             <span className="px-3 py-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300 rounded-full text-xs font-medium cursor-pointer transition-colors">Ready</span>
             <span className="px-3 py-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300 rounded-full text-xs font-medium cursor-pointer transition-colors">In Progress</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
           <Button variant="outline" size="sm">
              <SortAsc className="h-4 w-4 mr-2" />
              Sort
           </Button>
           <Button onClick={() => setIsModalOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New PRD
           </Button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto pr-1 pb-10">
        {viewMode === 'list' ? (
          <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-800">
              <thead className="bg-slate-950/50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider w-10">#</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Name</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Complexity</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Created</th>
                  <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {prds.map((prd) => (
                  <tr key={prd.id} className="hover:bg-slate-800/50 group cursor-pointer transition-colors" onClick={() => setSelectedPRD(prd)}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono">{prd.priority || '-'}</td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-slate-200">{prd.name}</div>
                      {prd.dependencies.length > 0 && (
                        <div className="text-xs text-slate-500 mt-1">Depends on: {prd.dependencies.join(', ')}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={statusColors[prd.status]}>{prd.status}</Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                         prd.complexity === 'HIGH' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                         prd.complexity === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {prd.complexity}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{prd.created}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button className="text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {prds.map((prd) => (
              <Card key={prd.id} className="p-5 flex flex-col h-full hover:border-indigo-500/50 transition-colors" onClick={() => setSelectedPRD(prd)}>
                <div className="flex justify-between items-start mb-4">
                  <Badge variant={statusColors[prd.status]}>{prd.status}</Badge>
                  {prd.priority && <span className="text-xs font-mono text-slate-500">#{prd.priority}</span>}
                </div>
                <h3 className="text-lg font-semibold text-slate-200 mb-2">{prd.name}</h3>
                <p className="text-sm text-slate-400 flex-1 line-clamp-3">
                  {prd.content.replace(/^#.*\n/, '')}
                </p>
                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
                  <span>{prd.created}</span>
                  <div className="flex -space-x-2">
                     {/* Avatars placeholder */}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* New PRD Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New PRD">
         <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
              <input type="text" className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600" placeholder="e.g. User Authentication" />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Complexity</label>
              <div className="flex items-center space-x-4">
                 <input type="range" min="1" max="10" className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                 <span className="text-sm font-bold text-slate-300 w-16 text-center">MED</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div>
                 <label className="block text-sm font-medium text-slate-400 mb-1">Phases</label>
                 <input type="number" defaultValue={3} min={1} max={10} className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
               </div>
               <div>
                 <label className="block text-sm font-medium text-slate-400 mb-1">Template</label>
                 <select className="w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option>Default</option>
                    <option>Feature</option>
                    <option>Bugfix</option>
                 </select>
               </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Dependencies</label>
              <div className="bg-slate-950/30 p-3 rounded-md border border-slate-800 max-h-32 overflow-y-auto space-y-2">
                 {prds.map(p => (
                   <label key={p.id} className="flex items-center space-x-2 text-sm text-slate-300 cursor-pointer">
                      <input type="checkbox" className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500/50 focus:ring-offset-slate-900" />
                      <span>{p.name}</span>
                   </label>
                 ))}
              </div>
            </div>

            <div className="flex justify-end pt-4 space-x-3">
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button type="submit">Create PRD</Button>
            </div>
         </form>
      </Modal>

      {/* Detail Slide-over */}
      {selectedPRD && (
        <div className="fixed inset-0 z-50 flex justify-end">
           <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={() => setSelectedPRD(null)}></div>
           <div className="relative w-full max-w-xl bg-slate-900 h-full shadow-2xl flex flex-col transform transition-transform animate-in slide-in-from-right duration-300 border-l border-slate-800">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                 <h2 className="text-lg font-bold text-slate-100 line-clamp-1">{selectedPRD.name}</h2>
                 <button onClick={() => setSelectedPRD(null)} className="p-2 hover:bg-slate-800 rounded-full"><LayoutList className="h-5 w-5 text-slate-500" /></button>
              </div>
              
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                 <div className="flex items-center space-x-4">
                    <Badge variant={statusColors[selectedPRD.status]} className="text-sm px-3 py-1">{selectedPRD.status}</Badge>
                    <div className="text-sm text-slate-500">Priority: <span className="font-mono font-bold text-slate-300">#{selectedPRD.priority ?? '?'}</span></div>
                 </div>

                 <div className="prose prose-sm prose-invert max-w-none">
                    <h3 className="uppercase text-xs font-bold text-slate-500 tracking-wider mb-2">Description</h3>
                    <div className="whitespace-pre-wrap text-slate-300 bg-slate-950/50 p-4 rounded-lg border border-slate-800 font-mono text-sm">
                       {selectedPRD.content}
                    </div>
                 </div>

                 <div className="space-y-2">
                   <h3 className="uppercase text-xs font-bold text-slate-500 tracking-wider">Dependencies</h3>
                   {selectedPRD.dependencies.length ? (
                     <div className="flex flex-wrap gap-2">
                       {selectedPRD.dependencies.map(d => (
                         <span key={d} className="px-2 py-1 bg-slate-800 text-slate-300 text-xs rounded border border-slate-700">{d}</span>
                       ))}
                     </div>
                   ) : (
                     <p className="text-sm text-slate-500 italic">No dependencies.</p>
                   )}
                 </div>
              </div>

              <div className="p-4 border-t border-slate-800 bg-slate-900 flex space-x-3">
                 <Button className="flex-1">
                   <Play className="h-4 w-4 mr-2" />
                   Execute Now
                 </Button>
                 <Button variant="outline" className="flex-1">Move to Done</Button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default PRDs;