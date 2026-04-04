const RULES = [
  {
    id: 'feedback',
    name: 'Feedback Agent Gate',
    severity: 'P0',
    description: 'When Theo (754662205684973601) gives corrections/feedback, feedback-agent must be spawned within 3 turns.',
    detection: 'Match correction patterns in user messages from Theo\'s sender_id, check for feedback-agent spawn in next 3 assistant turns.',
  },
  {
    id: 'qa',
    name: 'QA Agent Gate',
    severity: 'P1',
    description: 'After writing/editing files (especially AGENTS.md, config, scripts), qa-agent must be spawned.',
    detection: 'Find write/edit tool calls targeting sensitive files, check for qa-agent spawn before next user message.',
  },
  {
    id: 'coaching',
    name: 'Coaching Agent Gate',
    severity: 'P1',
    description: 'Before presenting proposals/architecture to Theo, coaching-agent must run first.',
    detection: 'Find assistant messages matching proposal patterns, check if coaching-agent was spawned before that message.',
  },
  {
    id: 'delivery',
    name: 'Delivery Gate',
    severity: 'P0',
    description: 'Sub-agent completions must be followed by actual Discord delivery (message send), not just narration.',
    detection: 'Find sub-agent completion tool results, check if message send to Discord follows within 3 turns.',
  },
  {
    id: 'model-compliance',
    name: 'Model Compliance',
    severity: 'P2',
    description: 'Sub-agents spawned on Sonnet must be for mechanical tasks only. Judgment/research/security tasks require Opus.',
    detection: 'Find sessions_spawn with sonnet model, check task description against mechanical vs judgment patterns.',
  },
  {
    id: 'subagent-sandbox',
    name: 'Sub-Agent Sandbox Enforcement',
    severity: 'P1',
    description: 'All sessions_spawn calls from main agent MUST include sandbox: "require". Sub-agents must never inherit main\'s sandbox: "off" setting. RT-002 mitigation.',
    detection: 'Find sessions_spawn tool calls, check if sandbox parameter is "require". Flag any spawn with sandbox: "inherit" or missing sandbox parameter.',
  },
];

export function listRules({ json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(RULES, null, 2));
  } else {
    console.log('Enforced Process Gates\n' + '='.repeat(50));
    for (const rule of RULES) {
      console.log(`\n[${rule.severity}] ${rule.name} (${rule.id})`);
      console.log(`  ${rule.description}`);
      console.log(`  Detection: ${rule.detection}`);
    }
  }
}

export { RULES };
