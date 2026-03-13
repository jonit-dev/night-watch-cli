# Night Watch CLI - Configuration Documentation Gaps

**Date:** March 13, 2026
**Analysis:** Gap-analyzer agent preliminary findings

---

## Critical Configuration Gaps

### 🔴 **Missing from Configuration Documentation**

#### 1. **Provider Preset System**
**Status:** Implemented but undocumented
- **Issue:** `providerPresets` configuration exists but not documented
- **Features:**
  - Built-in presets: `claude`, `codex`, `glm-47`, `glm-5`, `claude-sonnet-4-6`, `claude-opus-4-6`
  - Custom presets with environment variables
  - Override flags for each provider

**Missing Documentation:**
- How to define custom presets
- Environment variable mapping
- Preset inheritance
- Validation rules

#### 2. **Queue Modes**
**Status:** Implemented but undocumented
- **Issue:** Queue configuration has `mode` field with options not documented
- **Available Modes:**
  - `conservative` (default)
  - `provider-aware`
  - `auto`

**Missing Documentation:**
- Mode differences and when to use each
- Provider-aware mode specifics
- Auto mode configuration
- Performance implications

#### 3. **Session-level Runtime Configuration**
**Status:** Implemented but undocumented
- **Issue:** `sessionMaxRuntime` field exists but not mentioned
- **Purpose:** Override maxRuntime for specific sessions

**Missing Documentation:**
- When to use sessionMaxRuntime
- Override mechanism
- Priority over regular maxRuntime

#### 4. **Advanced Fallback Configuration**
**Status:** Implemented but undocumented
- **Issue:** Fallback presets not documented
- **Fields:**
  - `primaryFallbackPreset`
  - `secondaryFallbackPreset`

**Missing Documentation:**
- Fallback chain mechanism
- How to configure fallback providers
- Troubleshooting fallback issues
- Fallback vs rate-limit fallback difference

#### 5. **Per-Job Provider Configuration**
**Status:** Partially documented
- **Issue:** `analytics` and `planner` jobs missing from jobProviders
- **Current Documentation:** Mentions executor, reviewer, qa, audit, slicer
- **Missing:**
  - `analytics` job provider
  - `planner` job provider

#### 6. **Queue Provider Buckets**
**Status:** Implemented but undocumented
- **Issue:** `providerBuckets` in queue configuration
- **Purpose:** Separate provider allocations per bucket
- **Missing Documentation:**
  - Bucket configuration syntax
  - Resource allocation strategies
  - Multi-provider scenarios

#### 7. **Scheduling Priority**
**Status:** Implemented but undocumented
- **Issue:** `schedulingPriority` field not in configuration.md
- **Purpose:** Priority for job scheduling
- **Missing Documentation:**
  - Priority levels and meanings
  - How priority affects execution order
  - Priority conflicts resolution

#### 8. **Reviewer Configuration**
**Status:** Partially documented
- **Issue:** Advanced reviewer options missing
- **Missing Fields:**
  - `reviewerMaxRetries` - Maximum retry attempts
  - `reviewerRetryDelay` - Delay between retries (seconds)
  - `reviewerMaxPrsPerRun` - Max PRs per reviewer run

**Missing Documentation:**
- Retry behavior configuration
- Performance tuning for reviewer
- Concurrent review limits

### 🟡 **User Interface Documentation Gaps**

#### 9. **Web UI Settings Tabs**
**Status:** Implemented but undocumented
- **Issue:** Settings page tabs not documented
- **Missing Tabs:**
  - `AdvancedTab` - Advanced configuration options
  - `AiRuntimeTab` - AI provider settings
  - `IntegrationsTab` - Third-party integrations
  - `JobsTab` - Job-specific configuration
  - `SchedulesTab` - Scheduling configuration

**Missing Documentation:**
- UI walkthrough for each tab
- Field explanations
- Configuration validation
- Save/restore procedures

### 🟠 **Deprecated Configuration**

#### 10. **Deprecated Fields**
**Status:** Implemented but not marked as deprecated
- **Issue:** `providerLabel` is deprecated but not documented as such
- **Missing Documentation:**
  - Deprecation notice
  - Replacement field
  - Migration guide

### 🔵 **Environment Variables**

#### 11. **Night Watch Home Directory Override**
**Status:** Implemented but undocumented
- **Issue:** `NIGHT_WATCH_HOME` environment variable for testing
- **Purpose:** Override default home directory (~/.night-watch)
- **Missing Documentation:**
  - When to use this variable
- How to configure it
- Testing scenarios

---

## Recommendations

### Immediate (1 week)
1. **Update configuration.md** to include all missing configuration options
2. **Add providerPresets section** with examples
3. **Document queue modes** with use cases
4. **Add reviewer configuration** section with all options
5. **Mark deprecated fields** with deprecation notices

### Next Steps (2 weeks)
1. **Create settings UI documentation** with screenshots
2. **Add environment variables reference**
3. **Create configuration migration guide**
4. **Add troubleshooting section for configuration**

### Ongoing
1. **Configuration validation examples**
2. **Performance tuning guides**
3. **Multi-environment setup examples**

---

## Related Documents

- [Configuration Guide](./configuration.md)
- [WEB-UI Documentation](./WEB-UI.md)
- [Default Configuration Template](../templates/night-watch.config.json)
- [Documentation Gap Analysis](./Documentation-Gap-Analysis.md)