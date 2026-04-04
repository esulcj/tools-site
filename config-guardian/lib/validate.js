import { loadKnownModels, red, green, yellow, bold } from './utils.js';

/**
 * Deep-validate an OpenClaw config object.
 * Returns { ok: boolean, errors: string[], warnings: string[] }
 */
export function validateConfig(config, opts = {}) {
  const errors = [];
  const warnings = [];
  const known = loadKnownModels();
  const validModels = new Set([...known.valid, ...known.aliases]);

  // 1. Basic structure
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['Config is not a valid object'], warnings };
  }

  // 2. agents.defaults.model.primary
  const primary = config?.agents?.defaults?.model?.primary;
  if (!primary) {
    errors.push('Missing agents.defaults.model.primary');
  } else if (!validModels.has(primary)) {
    errors.push(`Primary model "${primary}" not in known-good list. Valid: ${known.valid.join(', ')}`);
  }
  if (primary && known.critical.includes(primary)) {
    // It's fine — using a known critical model
  }

  // 3. agents.list
  const agents = config?.agents?.list;
  if (!agents || !Array.isArray(agents)) {
    errors.push('Missing or invalid agents.list array');
  } else {
    if (agents.length === 0) {
      errors.push('agents.list is empty — all agents would be removed');
    }

    const ids = new Set();
    for (const agent of agents) {
      if (!agent.id) {
        errors.push('Agent missing required "id" field');
        continue;
      }
      if (ids.has(agent.id)) {
        errors.push(`Duplicate agent ID: "${agent.id}"`);
      }
      ids.add(agent.id);

      // Check agent-level model IDs
      const agentModel = agent?.model?.primary;
      if (agentModel && !validModels.has(agentModel)) {
        errors.push(`Agent "${agent.id}" has unknown model: "${agentModel}"`);
      }

      // Check heartbeat model
      const hbModel = agent?.heartbeat?.model;
      if (hbModel && !validModels.has(hbModel)) {
        errors.push(`Agent "${agent.id}" heartbeat has unknown model: "${hbModel}"`);
      }

      // Check subagent model
      const subModel = agent?.subagents?.model || config?.agents?.defaults?.subagents?.model;
      if (agent?.subagents?.model && !validModels.has(agent.subagents.model)) {
        errors.push(`Agent "${agent.id}" subagent model unknown: "${agent.subagents.model}"`);
      }
    }

    // Check for "main" agent
    if (!ids.has('main')) {
      warnings.push('No "main" agent found — is this intentional?');
    }
  }

  // 4. Check models in defaults.models map
  const defaultModels = config?.agents?.defaults?.models;
  if (defaultModels && typeof defaultModels === 'object') {
    for (const modelId of Object.keys(defaultModels)) {
      if (!validModels.has(modelId)) {
        warnings.push(`Model "${modelId}" in defaults.models not in known-good list`);
      }
    }
  }

  // 5. Compare agent count against current config if provided
  if (opts.currentConfig) {
    const currentAgents = opts.currentConfig?.agents?.list || [];
    const newAgents = config?.agents?.list || [];
    const currentIds = new Set(currentAgents.map(a => a.id));
    const newIds = new Set(newAgents.map(a => a.id));

    const dropped = [...currentIds].filter(id => !newIds.has(id));
    const added = [...newIds].filter(id => !currentIds.has(id));

    if (dropped.length > 0) {
      errors.push(`🚨 AGENTS DROPPED: ${dropped.join(', ')} — config.patch replaces arrays!`);
    }
    if (added.length > 0) {
      warnings.push(`New agents added: ${added.join(', ')}`);
    }

    // Check for silent property changes on existing agents
    for (const newAgent of newAgents) {
      const current = currentAgents.find(a => a.id === newAgent.id);
      if (!current) continue;
      const diff = findPropertyChanges(current, newAgent, `agents.list[${newAgent.id}]`);
      if (diff.length > 0) {
        warnings.push(`Agent "${newAgent.id}" has property changes: ${diff.join('; ')}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function findPropertyChanges(a, b, prefix = '') {
  const changes = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      if (typeof a[key] === 'object' && typeof b[key] === 'object' && !Array.isArray(a[key])) {
        changes.push(...findPropertyChanges(a[key] || {}, b[key] || {}, path));
      } else {
        changes.push(path);
      }
    }
  }
  return changes;
}

export function printValidation(result, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.errors.length) {
    console.log(bold(red('\n❌ Validation FAILED:\n')));
    for (const e of result.errors) console.log(red(`  ✗ ${e}`));
  }
  if (result.warnings.length) {
    console.log(bold(yellow('\n⚠️  Warnings:\n')));
    for (const w of result.warnings) console.log(yellow(`  ⚠ ${w}`));
  }
  if (result.ok && result.warnings.length === 0) {
    console.log(green('\n✅ Validation passed.\n'));
  } else if (result.ok) {
    console.log(green('\n✅ Validation passed (with warnings).\n'));
  }
}
