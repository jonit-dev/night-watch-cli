import React from 'react';
import { Save, RotateCcw, Activity } from 'lucide-react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Tabs from '../components/ui/Tabs';
import Switch from '../components/ui/Switch';
import { useStore } from '../store/useStore';

const Settings: React.FC = () => {
  const { addToast } = useStore();
  const [loading, setLoading] = React.useState(false);

  const handleSave = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      addToast({
        title: 'Settings Saved',
        message: 'Your project configuration has been updated successfully.',
        type: 'success',
      });
    }, 1000);
  };

  const tabs = [
    {
      id: 'general',
      label: 'General',
      content: (
        <Card className="p-6 space-y-4">
           <h3 className="text-lg font-medium text-slate-200">Project Configuration</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input label="Project Name" defaultValue="Night Watch Core" disabled />
              <Select 
                label="Provider"
                options={[
                  { label: 'Anthropic (Claude)', value: 'claude' },
                  { label: 'OpenAI (GPT-4)', value: 'gpt4' },
                ]}
              />
              <Input label="Default Branch" placeholder="main" />
              <Input label="Branch Prefix" defaultValue="night-watch/" />
              <div className="md:col-span-2">
                 <Switch label="Enable Automated Reviews" defaultChecked />
              </div>
           </div>
        </Card>
      )
    },
    {
      id: 'runtime',
      label: 'Runtime',
      content: (
        <Card className="p-6 space-y-6">
           <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Min Review Score (0-100)</label>
              <div className="flex items-center space-x-4">
                 <input type="range" min="0" max="100" defaultValue="70" className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                 <span className="text-sm font-bold text-slate-200 w-10">70</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">PRs below this score will be marked as "Needs Work".</p>
           </div>
           <div className="grid grid-cols-2 gap-6">
              <Input label="Max Runtime (Executor)" type="number" defaultValue="300" rightIcon={<span className="text-xs">sec</span>} />
              <Input label="Max Log Size" type="number" defaultValue="10" rightIcon={<span className="text-xs">MB</span>} />
           </div>
        </Card>
      )
    },
    {
      id: 'schedules',
      label: 'Schedules',
      content: (
        <Card className="p-6">
           <p className="text-slate-400 text-sm">Schedule configuration not implemented yet.</p>
        </Card>
      )
    },
    {
      id: 'env',
      label: 'Provider Env',
      content: (
         <Card className="p-6">
           <p className="text-slate-400 text-sm">Environment variables configuration not implemented yet.</p>
         </Card>
      )
    }
  ];

  return (
    <div className="max-w-4xl mx-auto pb-10">
      <h2 className="text-2xl font-bold text-slate-100 mb-6">Settings</h2>
      
      <Tabs tabs={tabs} />
      
      {/* Footer Actions */}
      <div className="flex items-center justify-end space-x-4 pt-6 mt-6 border-t border-slate-800">
         <Button variant="ghost" className="text-slate-400 hover:text-slate-300">
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
         </Button>
         <Button onClick={handleSave} loading={loading}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
         </Button>
      </div>
      
      {/* Health Check Section */}
      <div className="mt-12">
         <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center">
            <Activity className="h-5 w-5 mr-2 text-indigo-500" />
            System Health
         </h3>
         <Card className="divide-y divide-slate-800">
            {[
               { name: 'Git Repository', status: 'Pass', detail: '/Users/dev/night-watch' },
               { name: 'Provider CLI', status: 'Pass', detail: 'v2.4.0' },
               { name: 'Cron Installation', status: 'Fail', detail: 'No crontab entry found' },
            ].map((check, idx) => (
               <div key={idx} className="p-4 flex items-center justify-between">
                  <div>
                     <p className="text-sm font-medium text-slate-200">{check.name}</p>
                     <p className="text-xs text-slate-500">{check.detail}</p>
                  </div>
                  <div className="flex items-center">
                     {check.status === 'Pass' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">Pass</span>
                     ) : (
                        <div className="flex items-center space-x-3">
                           <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">Fail</span>
                           <Button size="sm" variant="outline" className="h-7 text-xs">Fix</Button>
                        </div>
                     )}
                  </div>
               </div>
            ))}
         </Card>
      </div>
    </div>
  );
};

export default Settings;