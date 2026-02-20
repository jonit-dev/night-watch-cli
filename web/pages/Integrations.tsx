import { Bot, Check, ChevronRight, ExternalLink, Eye, EyeOff, Hash, Shield, Slack } from 'lucide-react';
import React, { useState } from 'react';
import { createSlackChannel, fetchConfig, fetchSlackChannels, ISlackChannel, updateConfig, useApi } from '../api';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import { useStore } from '../store/useStore';

export default function Integrations() {
  const { data: config, refetch } = useApi(fetchConfig);
  const { addToast } = useStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [slackChannels, setSlackChannels] = useState<ISlackChannel[]>([]);
  const [fetchingChannels, setFetchingChannels] = useState(false);

  // Temporary state for the stepper forms
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [engChannel, setEngChannel] = useState('');
  const [prsChannel, setPrsChannel] = useState('');
  const [incidentsChannel, setIncidentsChannel] = useState('');
  const [releasesChannel, setReleasesChannel] = useState('');
  // When config loads, populate initial state if available
  React.useEffect(() => {
    if (config?.slack) {
      setBotToken(config.slack.botToken || '');
      setAppToken(config.slack.appToken || '');
      setEngChannel(config.slack.channels?.eng || '');
      setPrsChannel(config.slack.channels?.prs || '');
      setIncidentsChannel(config.slack.channels?.incidents || '');
      setReleasesChannel(config.slack.channels?.releases || '');
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
          channels: { eng: '', prs: '', incidents: '', releases: '' },
          autoCreateProjectChannels: false,
          discussionEnabled: true,
        },
      });
      setBotToken('');
      setAppToken('');
      setEngChannel('');
      setPrsChannel('');
      setIncidentsChannel('');
      setReleasesChannel('');
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
          channels: {
            eng: engChannel,
            prs: prsChannel,
            incidents: incidentsChannel,
            releases: releasesChannel,
          },
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

  const handleNextToStep3 = async () => {
    setStep(3);
    if (!botToken.startsWith('xoxb-')) return;
    try {
      setFetchingChannels(true);
      const channels = await fetchSlackChannels(botToken);
      setSlackChannels(channels);

      // Auto-map channels if their names exist
      const findChannel = (name: string) => channels.find(c => c.name.toLowerCase() === name)?.id;

      const _engChannel = engChannel || findChannel('eng');
      const _prsChannel = prsChannel || findChannel('prs');
      const _incidentsChannel = incidentsChannel || findChannel('incidents');
      const _releasesChannel = releasesChannel || findChannel('releases');

      // Auto-create missing channels
      const missingToCreate = [];
      if (!_engChannel) missingToCreate.push({ name: 'eng', setter: setEngChannel });
      if (!_prsChannel) missingToCreate.push({ name: 'prs', setter: setPrsChannel });
      if (!_incidentsChannel) missingToCreate.push({ name: 'incidents', setter: setIncidentsChannel });
      if (!_releasesChannel) missingToCreate.push({ name: 'releases', setter: setReleasesChannel });

      if (missingToCreate.length > 0) {
        addToast({
          title: 'Creating Channels',
          message: `Auto-creating missing channels: ${missingToCreate.map(m => '#' + m.name).join(', ')}`,
          type: 'info'
        });

        const newChannels = [...channels];
        for (const missing of missingToCreate) {
          try {
            const createResult = await createSlackChannel(botToken, missing.name);
            const newChannelId = createResult.channelId;
            missing.setter(newChannelId);
            newChannels.push({ id: newChannelId, name: missing.name });

            if (createResult.inviteWarning) {
              addToast({
                title: 'Channel Created with Warning',
                message: `#${missing.name}: ${createResult.inviteWarning}`,
                type: 'warning',
              });
            } else if (!createResult.welcomeMessagePosted) {
              addToast({
                title: 'Channel Created',
                message: `#${missing.name} was created, but welcome message failed to post.`,
                type: 'warning',
              });
            }
          } catch (createErr: any) {
            console.error('Failed to create channel:', missing.name, createErr);
            // It might fail if we lack scopes, keep going
          }
        }
        setSlackChannels(newChannels);
      } else {
        if (_engChannel) setEngChannel(_engChannel);
        if (_prsChannel) setPrsChannel(_prsChannel);
        if (_incidentsChannel) setIncidentsChannel(_incidentsChannel);
        if (_releasesChannel) setReleasesChannel(_releasesChannel);
      }

    } catch {
      addToast({
        title: 'Warning',
        message: 'Could not fetch channels automatically. Please verify your token.',
        type: 'warning'
      });
    } finally {
      setFetchingChannels(false);
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
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Public & Visible</span>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {[
            { label: 'eng', id: engChannel },
            { label: 'prs', id: prsChannel },
            { label: 'incidents', id: incidentsChannel },
            { label: 'releases', id: releasesChannel }
          ].map((ch) => (
            <div key={ch.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-400 capitalize">#{ch.label} Channel</label>
                {ch.id && (
                  <button
                    onClick={() => window.open(`https://slack.com/app_redirect?channel=${ch.id}`, '_blank')}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                  >
                    Open <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <Input
                value={ch.id}
                onChange={(e) => {
                  if (ch.label === 'eng') setEngChannel(e.target.value);
                  if (ch.label === 'prs') setPrsChannel(e.target.value);
                  if (ch.label === 'incidents') setIncidentsChannel(e.target.value);
                  if (ch.label === 'releases') setReleasesChannel(e.target.value);
                }}
                placeholder="C1234567890"
              />
            </div>
          ))}
        </div>

        <div className="mt-6 p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-lg">
          <p className="text-xs text-slate-400 leading-relaxed">
            <strong className="text-indigo-300">Pro Tip:</strong> Channels are created as <strong>Public</strong>.
            If you don't see them in your sidebar, click <b>"Add Channels" &gt; "Browse all channels"</b> in Slack to join them for the first time.
          </p>
        </div>

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
    { number: 3, title: 'Channels', icon: Hash }
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
            ))
            }
          </div >

          {/* Stepper Content */}
          < div className="min-h-[300px]" >
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

            {
              step === 2 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-200">2. Install App & Get Token</h3>
                    <p className="text-sm text-slate-400">
                      After creating the app, navigate to <strong>Features &gt; OAuth & Permissions</strong> in the left sidebar of the Slack API dashboard. Click <strong>Install to Workspace</strong>. Once installed, copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>) and paste it below. Then create an <strong>App-Level Token</strong> with <code>connections:write</code> (starts with <code>xapp-</code>) and paste it as well. Ignore the Client ID and secrets on the Basic Information page.
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
                    <Button onClick={handleNextToStep3} disabled={!botToken.startsWith('xoxb-') || fetchingChannels}>
                      Next Step <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )
            }

            {
              step === 3 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-200">3. Map Channels</h3>
                    <p className="text-sm text-slate-400">
                      Provide the Slack channel IDs where the agents should operate. You can find the Channel ID at the bottom of the channel's "About" modal in Slack.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                      {slackChannels.length > 0 ? (
                        <>
                          <Card className="p-4 border border-indigo-500/20 bg-indigo-500/5">
                            <div className="mb-3">
                              <h4 className="flex items-center gap-2 font-semibold text-indigo-300">
                                <Hash className="w-4 h-4" /> eng
                              </h4>
                              <p className="text-xs text-slate-400 mt-1">General engineering chat and agent banter.</p>
                            </div>
                            <Select
                              options={[{ label: 'Select a channel...', value: '' }, ...slackChannels.map(c => ({ label: '#' + c.name, value: c.id }))]}
                              value={engChannel}
                              onChange={setEngChannel}
                            />
                          </Card>
                          <Card className="p-4 border border-blue-500/20 bg-blue-500/5">
                            <div className="mb-3">
                              <h4 className="flex items-center gap-2 font-semibold text-blue-300">
                                <Hash className="w-4 h-4" /> prs
                              </h4>
                              <p className="text-xs text-slate-400 mt-1">Pull Request reviews and agent deliberation.</p>
                            </div>
                            <Select
                              options={[{ label: 'Select a channel...', value: '' }, ...slackChannels.map(c => ({ label: '#' + c.name, value: c.id }))]}
                              value={prsChannel}
                              onChange={setPrsChannel}
                            />
                          </Card>
                          <Card className="p-4 border border-red-500/20 bg-red-500/5">
                            <div className="mb-3">
                              <h4 className="flex items-center gap-2 font-semibold text-red-300">
                                <Hash className="w-4 h-4" /> incidents
                              </h4>
                              <p className="text-xs text-slate-400 mt-1">CI/CD failures and production alerts.</p>
                            </div>
                            <Select
                              options={[{ label: 'Select a channel...', value: '' }, ...slackChannels.map(c => ({ label: '#' + c.name, value: c.id }))]}
                              value={incidentsChannel}
                              onChange={setIncidentsChannel}
                            />
                          </Card>
                          <Card className="p-4 border border-emerald-500/20 bg-emerald-500/5">
                            <div className="mb-3">
                              <h4 className="flex items-center gap-2 font-semibold text-emerald-300">
                                <Hash className="w-4 h-4" /> releases
                              </h4>
                              <p className="text-xs text-slate-400 mt-1">Ship announcements and merged PRs.</p>
                            </div>
                            <Select
                              options={[{ label: 'Select a channel...', value: '' }, ...slackChannels.map(c => ({ label: '#' + c.name, value: c.id }))]}
                              value={releasesChannel}
                              onChange={setReleasesChannel}
                            />
                          </Card>
                        </>
                      ) : (
                        <>
                          <Card className="p-4 border border-indigo-500/20 bg-indigo-500/5">
                            <h4 className="flex items-center gap-2 font-semibold text-indigo-300 mb-2">
                              <Hash className="w-4 h-4" /> eng
                            </h4>
                            <Input
                              placeholder="C1234567890"
                              value={engChannel}
                              onChange={(e) => setEngChannel(e.target.value)}
                            />
                          </Card>
                          <Card className="p-4 border border-blue-500/20 bg-blue-500/5">
                            <h4 className="flex items-center gap-2 font-semibold text-blue-300 mb-2">
                              <Hash className="w-4 h-4" /> prs
                            </h4>
                            <Input
                              placeholder="C1234567890"
                              value={prsChannel}
                              onChange={(e) => setPrsChannel(e.target.value)}
                            />
                          </Card>
                          <Card className="p-4 border border-red-500/20 bg-red-500/5">
                            <h4 className="flex items-center gap-2 font-semibold text-red-300 mb-2">
                              <Hash className="w-4 h-4" /> incidents
                            </h4>
                            <Input
                              placeholder="C1234567890"
                              value={incidentsChannel}
                              onChange={(e) => setIncidentsChannel(e.target.value)}
                            />
                          </Card>
                          <Card className="p-4 border border-emerald-500/20 bg-emerald-500/5">
                            <h4 className="flex items-center gap-2 font-semibold text-emerald-300 mb-2">
                              <Hash className="w-4 h-4" /> releases
                            </h4>
                            <Input
                              placeholder="C1234567890"
                              value={releasesChannel}
                              onChange={(e) => setReleasesChannel(e.target.value)}
                            />
                          </Card>
                        </>
                      )}
                    </div>

                  </div>

                  <div className="flex justify-between pt-8">
                    <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
                    <Button
                      onClick={() => onSaveConfig(true)}
                      loading={loading}
                      disabled={!engChannel || !prsChannel || !incidentsChannel}
                    >
                      Complete Setup
                    </Button>
                  </div>
                </div>
              )
            }
          </div >
        </Card >
      )}
    </div >
  );
}
