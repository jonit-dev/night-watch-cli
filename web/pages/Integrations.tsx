import { Bot, Check, ChevronRight, Eye, EyeOff, Shield, Slack } from 'lucide-react';
import React, { useState } from 'react';
import { fetchConfig, updateConfig, useApi } from '../api';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import { useStore } from '../store/useStore';

export default function Integrations() {
  const { data: config, refetch } = useApi(fetchConfig);
  const { addToast } = useStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Temporary state for the stepper forms
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');

  // When config loads, populate initial state if available
  React.useEffect(() => {
    if (config?.slack) {
      setBotToken(config.slack.botToken || '');
      setAppToken(config.slack.appToken || '');
    }
  }, [config]);

  const onDisconnect = async () => {
    try {
      setLoading(true);
      await updateConfig({
        slack: {
          enabled: false,
          botToken: '',
          appToken: '',
          autoCreateProjectChannels: false,
          discussionEnabled: true,
        },
      });
      setBotToken('');
      setAppToken('');
      setStep(1);
      refetch();
      addToast({ title: 'Disconnected', message: 'Slack integration removed.', type: 'success' });
    } catch (e: any) {
      addToast({ title: 'Error', message: e.message || 'Failed to disconnect', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const onSaveConfig = async (isFinalStep = false) => {
    try {
      setLoading(true);
      await updateConfig({
        slack: {
          enabled: true,
          botToken,
          appToken,
          autoCreateProjectChannels: true,
          discussionEnabled: true,
        },
      });
      addToast({
        title: 'Success',
        message: 'Slack configuration saved successfully.',
        type: 'success',
      });
      refetch();
      if (!isFinalStep) {
        setStep(step + 1);
      } else {
        setStep(1);
      }
    } catch (e: any) {
      addToast({
        title: 'Error',
        message: e.message || 'Failed to save configuration',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const slackManifestUrl = 'https://api.slack.com/apps?new_app=1';

  const manifestJson = `{
  "display_information": {
    "name": "Night Watch AI",
    "description": "AI-driven startup team",
    "background_color": "#0d1117"
  },
  "features": {
    "bot_user": {
      "display_name": "Night Watch AI",
      "always_online": true
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "chat:write",
        "chat:write.customize",
        "channels:manage",
        "channels:read",
        "channels:join",
        "reactions:write",
        "reactions:read",
        "app_mentions:read",
        "channels:history",
        "users:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": [
        "app_mention",
        "message.channels"
      ]
    },
    "socket_mode_enabled": true,
    "token_rotation_enabled": false,
    "org_deploy_enabled": false
  }
} `;

  if (!config) {
    return <div className="animate-pulse flex space-x-4">Loading...</div>;
  }

  const isSlackIntegrated = config.slack?.enabled && config.slack?.botToken;

  const renderConfiguredState = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-3">
            <Slack className="w-6 h-6 text-indigo-400" />
            Slack Bot Configuration
          </h2>
          <p className="text-slate-400 mt-1">Manage your connected Slack workspace.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-green-400 bg-green-400/10 px-3 py-1.5 rounded-full border border-green-500/20">
            <Check className="w-4 h-4" /> Connected
          </div>
          <Button variant="ghost" onClick={onDisconnect} loading={loading} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 text-sm px-3 py-1.5">
            Disconnect
          </Button>
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <h3 className="font-medium text-slate-200 border-b border-white/10 pb-2 mb-4">API Token</h3>
        <div className="flex gap-4">
          <Input
            label="Bot User OAuth Token"
            type={showToken ? 'text' : 'password'}
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            className="flex-1"
            rightIcon={
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="hover:text-slate-300 pointer-events-auto transition-colors"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />
        </div>

        <div className="mt-4">
          <Input
            label="App-Level Token (Socket Mode)"
            type={showToken ? 'text' : 'password'}
            value={appToken}
            onChange={(e) => setAppToken(e.target.value)}
            placeholder="xapp-..."
          />
          <p className="text-xs text-slate-500 mt-1">
            Required for real-time agent mentions like <code>@maya</code>.
          </p>
        </div>

        <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-4 mt-8">
          <h3 className="font-medium text-slate-200">Channels</h3>
        </div>
        <p className="text-xs text-slate-400">
          Channels are automatically created per project (e.g. <code>#proj-my-app</code>). All agent messages, deliberations, and notifications are posted to each project&apos;s own channel.
        </p>

        <div className="pt-6 border-t border-white/10 flex justify-end">
          <Button onClick={() => onSaveConfig(true)} loading={loading}>
            Save Changes
          </Button>
        </div>
      </Card>
    </div>
  );

  const steps = [
    { number: 1, title: 'Create App', icon: Bot },
    { number: 2, title: 'Tokens & Scopes', icon: Shield },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400 tracking-tight">
          Integrations
        </h1>
        <p className="text-slate-400">
          Connect Night Watch to your tools for a seamless agentic workflow.
        </p>
      </div>

      {isSlackIntegrated && step === 1 ? (
        renderConfiguredState()
      ) : (
        <Card className="p-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold flex items-center gap-3">
              <Slack className="w-7 h-7 text-indigo-400" />
              Connect Slack
            </h2>
            <p className="text-slate-400 mt-2">
              Night Watch operates natively in Slack, allowing agents to discuss PRs, triage errors, and collaborate.
            </p>
          </div>

          {/* Stepper Header */}
          <div className="flex items-center justify-between mb-8 relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-slate-800 z-0"></div>
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-indigo-500 z-0 transition-all duration-300"
              style={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }}
            ></div>

            {steps.map((s) => (
              <div
                key={s.number}
                className={`relative z-10 flex flex-col items-center gap-2 ${step >= s.number ? 'text-indigo-400' : 'text-slate-500'}`}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg border-2 transition-all duration-300 bg-[#0b101b]
                  ${step >= s.number ? 'border-indigo-500 glow-indigo' : 'border-slate-800'}
                  ${step === s.number ? 'ring-4 ring-indigo-500/20' : ''}
                `}>
                  {step > s.number ? <Check className="w-6 h-6" /> : <s.icon className="w-5 h-5" />}
                </div>
                <span className="text-xs font-medium tracking-wide">{s.title}</span>
              </div>
            ))}
          </div>

          {/* Stepper Content */}
          <div className="min-h-[300px]">
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-slate-200">1. Create a Slack App via Manifest</h3>
                  <p className="text-sm text-slate-400">
                    We've made it easy. Copy the JSON manifest below and paste it into the Slack API dashboard to create your app instantly with the correct scopes.
                  </p>

                  <div className="bg-[#1e293b] rounded-lg p-4 border border-white/5 relative group">
                    <pre className="text-xs text-slate-300 overflow-x-auto">
                      <code>{manifestJson}</code>
                    </pre>
                    <Button
                      size="sm"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        navigator.clipboard.writeText(manifestJson);
                        addToast({ title: 'Copied', message: 'Manifest copied to clipboard', type: 'info' });
                      }}
                    >
                      Copy JSON
                    </Button>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4">
                  <Button variant="outline" onClick={() => window.open(slackManifestUrl, '_blank')}>
                    Open Slack API Console
                  </Button>
                  <Button onClick={() => setStep(2)}>
                    Next Step <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-slate-200">2. Install App & Get Token</h3>
                  <p className="text-sm text-slate-400">
                    After creating the app, navigate to <strong>Features &gt; OAuth & Permissions</strong> in the left sidebar of the Slack API dashboard. Click <strong>Install to Workspace</strong>. Once installed, copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>) and paste it below. Then create an <strong>App-Level Token</strong> with <code>connections:write</code> (starts with <code>xapp-</code>) and paste it as well.
                  </p>
                  <p className="text-sm text-slate-400">
                    Project channels (e.g. <code>#proj-my-app</code>) will be auto-created when you register a project.
                  </p>

                  <div className="max-w-md mt-6">
                    <Input
                      label="Slack Bot Token"
                      placeholder="xoxb-..."
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      type={showToken ? 'text' : 'password'}
                      rightIcon={
                        <button
                          type="button"
                          onClick={() => setShowToken(!showToken)}
                          className="hover:text-slate-300 pointer-events-auto transition-colors"
                        >
                          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      }
                    />
                    <div className="mt-4">
                      <Input
                        label="Slack App Token (Socket Mode)"
                        placeholder="xapp-..."
                        value={appToken}
                        onChange={(e) => setAppToken(e.target.value)}
                        type={showToken ? 'text' : 'password'}
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Needed for real-time <code>@agent</code> replies (Socket Mode + <code>connections:write</code>).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-8">
                  <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                  <Button
                    onClick={() => onSaveConfig(true)}
                    loading={loading}
                    disabled={!botToken.startsWith('xoxb-')}
                  >
                    Complete Setup
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
