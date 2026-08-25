/**
 * Single source for every command the Cribble Agent surfaces show
 * (welcome flow and settings), so the two can never drift apart.
 */
export const AGENT_CLI_COMMANDS = {
  install: 'npm install -g cribble-agent',
  connect: 'cribble connect',
  sync: 'cribble sync',
  autoSync: 'cribble start'
} as const
