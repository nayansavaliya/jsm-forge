/**
 * src/triggers/issue-events.ts
 *
 * Forge Product Event Trigger handler for JSM issue lifecycle events.
 * Handles: issue_created, issue_updated, issue_resolved
 */

import type { ForgeContext } from '../types';
import { getConfig } from '../config-loader';

interface JiraIssueEvent {
  issue: {
    id: string;
    key: string;
    fields: {
      project: { key: string };
      priority: { name: string };
      status: { name: string };
      assignee: { accountId: string } | null;
      summary: string;
    };
  };
  changelog?: {
    items: Array<{ field: string; fromString: string; toString: string }>;
  };
}

export async function handler(event: JiraIssueEvent, _context: ForgeContext): Promise<void> {
  const projectKey = event.issue.fields.project.key;
  const config = getConfig();

  // Find which department this issue belongs to
  const dept = config.departments.find((d) => d.jsmProjectKey === projectKey);
  if (!dept) {
    // Not a managed department — ignore
    return;
  }

  const eventType = detectEventType(event);
  console.info(`[issue-events] ${eventType} — ${event.issue.key} (${dept.name})`);

  switch (eventType) {
    case 'created':
      await handleIssueCreated(event, dept);
      break;
    case 'updated':
      await handleIssueUpdated(event, dept);
      break;
    case 'resolved':
      await handleIssueResolved(event, dept);
      break;
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleIssueCreated(
  event: JiraIssueEvent,
  dept: ReturnType<typeof getConfig>['departments'][0],
): Promise<void> {
  const { issue } = event;
  // Check escalation queues for notification routing
  for (const queue of dept.queues) {
    if (queue.notifyOnNew) {
      console.info(
        `[issue-events] Notify ${queue.notifyOnNew.channel}:${queue.notifyOnNew.target} — new issue ${issue.key}`,
      );
      // TODO Phase 5: dispatch actual notification
    }
  }
}

async function handleIssueUpdated(
  event: JiraIssueEvent,
  dept: ReturnType<typeof getConfig>['departments'][0],
): Promise<void> {
  // Check for SLA breach in changelog
  const slaChange = event.changelog?.items.find((i) => i.field === 'SLA');
  if (slaChange?.toString === 'Breached' && dept.escalation) {
    console.info(
      `[issue-events] SLA breached on ${event.issue.key} — escalating to ${dept.escalation.notifyAccountId}`,
    );
    // TODO Phase 5: send escalation notification
  }
}

async function handleIssueResolved(
  event: JiraIssueEvent,
  _dept: ReturnType<typeof getConfig>['departments'][0],
): Promise<void> {
  // Dispatch CSAT survey
  console.info(`[issue-events] Issue resolved: ${event.issue.key} — dispatching CSAT survey`);
  // TODO Phase 5: send CSAT survey to reporter
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectEventType(event: JiraIssueEvent): 'created' | 'updated' | 'resolved' {
  const status = event.issue.fields.status.name.toLowerCase();
  if (status === 'done' || status === 'resolved' || status === 'closed') {
    return 'resolved';
  }
  if (event.changelog?.items.length) {
    return 'updated';
  }
  return 'created';
}
