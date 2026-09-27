/**
 * src/services/notifications.ts
 *
 * Sends notifications to Slack, Teams, or Email based on configuration.
 */

import { fetch as forgeFetch } from '@forge/api';
import { getConfig } from '../config-loader';
import type { Department } from '../config-loader/schema';

// storage and secrets are Forge runtime globals — declared in src/types/forge.d.ts
declare const secrets: ForgeSecrets;

export async function sendNotification(params: {
  channel: 'slack' | 'email' | 'teams';
  target: string;
  message: string;
  dept?: Department;
}): Promise<void> {
  const config = getConfig();

  switch (params.channel) {
    case 'slack': {
      const slackConfig = config.global.notifications.slack;
      if (!slackConfig) {
        console.warn(`[notify] Slack notification requested but not configured globally.`);
        return;
      }
      
      const webhookUrl = await secrets.get(slackConfig.webhookSecretKey);
      if (!webhookUrl) {
        console.error(`[notify] Slack webhook URL missing for secret: ${slackConfig.webhookSecretKey}`);
        return;
      }

      await forgeFetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: params.target, // Note: standard slack webhooks ignore this, but some apps use it
          text: params.message,
        }),
      });
      console.info(`[notify] Slack message sent to ${params.target}`);
      break;
    }
    case 'teams': {
      const teamsConfig = config.global.notifications.teams;
      if (!teamsConfig) {
        console.warn(`[notify] Teams notification requested but not configured globally.`);
        return;
      }

      const webhookUrl = await secrets.get(teamsConfig.webhookSecretKey);
      if (!webhookUrl) {
        console.error(`[notify] Teams webhook URL missing for secret: ${teamsConfig.webhookSecretKey}`);
        return;
      }

      await forgeFetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: params.message,
        }),
      });
      console.info(`[notify] Teams message sent`);
      break;
    }
    case 'email': {
      console.info(`[notify] Email notification would be sent to ${params.target}: ${params.message}`);
      // In a real implementation, you would use a transactional email API (SendGrid, AWS SES)
      // or the Jira notification API to send this.
      break;
    }
  }
}
