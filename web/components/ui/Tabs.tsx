import React from 'react';

interface TabItem {
  id: string;
  label: string;
  content?: React.ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab?: string;
  onChange?: (id: string) => void;
  className?: string;
}

const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className = '' }) => {
  // If controlled, use activeTab, otherwise maintain internal state
  const [internalActiveTab, setInternalActiveTab] = React.useState(tabs[0]?.id);
  const currentTab = activeTab || internalActiveTab;
  
  const handleTabClick = (id: string) => {
    if (onChange) {
      onChange(id);
    } else {
      setInternalActiveTab(id);
    }
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="border-b border-slate-800 mb-6">
         <nav className="-mb-px flex space-x-8 overflow-x-auto scrollbar-hide">
            {tabs.map(tab => (
               <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`
                     whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-all duration-200
                     ${currentTab === tab.id 
                        ? 'border-indigo-500 text-indigo-400' 
                        : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-700'}
                  `}
               >
                  {tab.label}
               </button>
            ))}
         </nav>
      </div>
      
      <div className="flex-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {tabs.find(t => t.id === currentTab)?.content}
      </div>
    </div>
  );
};

export default Tabs;