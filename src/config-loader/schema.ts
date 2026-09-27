/**
 * src/config-loader/schema.ts
 *
 * Zod schemas for every config file in /config/**
 * These are the SINGLE SOURCE OF TRUTH for:
 *   - CI validation (scripts/validate-config.ts)
 *   - Runtime type safety (config-loader/index.ts)
 *   - TypeScript types (exported at the bottom)
 */

import { z } from 'zod';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SecretKeyRef = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]+$/, 'Secret key must be UPPER_SNAKE_CASE (matches Forge Secret name)');

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color e.g. #0052CC');

// ─── Global config ────────────────────────────────────────────────────────────

export const GlobalConfigSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    logo: z.string().url().optional(),
  }),
  portal: z.object({
    title: z.string().min(1),
    welcomeMessage: z.string().optional(),
  }),
  notifications: z.object({
    defaultChannel: z.enum(['slack', 'email', 'teams']),
    slack: z
      .object({
        webhookSecretKey: SecretKeyRef,
      })
      .optional(),
    email: z
      .object({
        fromAddress: z.string().email(),
      })
      .optional(),
    teams: z
      .object({
        webhookSecretKey: SecretKeyRef,
      })
      .optional(),
  }),
});

// ─── API Source auth — discriminated union ────────────────────────────────────

const LoginBearerAuth = z.object({
  authType: z.literal('login-bearer'),
  auth: z.object({
    loginUrl: z.string().url(),
    usernameSecretKey: SecretKeyRef,
    passwordSecretKey: SecretKeyRef,
    /** JSONPath into the login response to extract the token, e.g. "data.accessToken" */
    tokenPath: z.string().default('access_token'),
    /** JSONPath for the token TTL in seconds. Defaults to 3600 if omitted. */
    expiresInPath: z.string().optional(),
    tokenPrefix: z.string().default('Bearer'),
  }),
});

const ApiKeyAuth = z.object({
  authType: z.literal('api-key'),
  auth: z.object({
    credentialSecretKey: SecretKeyRef,
    placement: z.enum(['header', 'query']),
    /** Name of the HTTP header when placement = "header" */
    headerName: z.string().optional(),
    /** Name of the query param when placement = "query" */
    queryParam: z.string().optional(),
  }),
});

const OAuth2ClientCredentials = z.object({
  authType: z.literal('oauth2-client-credentials'),
  auth: z.object({
    tokenUrl: z.string().url(),
    clientIdSecretKey: SecretKeyRef,
    clientSecretSecretKey: SecretKeyRef,
    scope: z.string().optional(),
    audience: z.string().optional(),
    tokenPrefix: z.string().default('Bearer'),
  }),
});

const AuthStrategy = z.discriminatedUnion('authType', [
  LoginBearerAuth,
  ApiKeyAuth,
  OAuth2ClientCredentials,
]);

export const ApiSourceSchema = z
  .object({
    id: z.string().regex(/^api-[a-z0-9-]+$/, 'id must be kebab-case, prefixed api-'),
    name: z.string().min(1),
    baseUrl: z.string().url(),
    headers: z.record(z.string()).optional(),
    /**
     * Glob-style path whitelist. The dynamic-field resolver WILL REFUSE
     * to proxy any path not matching at least one entry here.
     * Examples: "/hardware/*", "/employees/:id"
     */
    allowedPaths: z.array(z.string()).min(1),
    timeout: z.number().int().positive().default(5000),
    retries: z.number().int().min(0).max(5).default(2),
  })
  .and(AuthStrategy);

// ─── Form fields ──────────────────────────────────────────────────────────────

export const FieldTypeSchema = z.enum([
  'text',
  'textarea',
  'number',
  'date',
  'file',
  'select',
  'multi-select',
  'user-picker',
  'dynamic-select',
  'dynamic-multi-select',
  'cascading-select',
  'computed',
]);

export const FieldSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/, 'Field id must be snake_case'),
    label: z.string().min(1),
    type: FieldTypeSchema,
    required: z.boolean().default(false),
    pii: z.boolean().default(false), // PII fields excluded from logs & cache
    readOnly: z.boolean().default(false),
    placeholder: z.string().optional(),

    // ── Static select options (used when type = select / multi-select)
    options: z
      .array(
        z.object({
          value: z.string(),
          label: z.string(),
        }),
      )
      .optional(),

    // ── Dynamic field config (type = dynamic-* or cascading-select)
    apiSourceId: z.string().optional(),
    apiPath: z
      .string()
      .optional()
      .describe('May contain {{fieldId}} placeholders for cascading fields'),
    dependsOn: z.string().optional(),
    valueKey: z.string().optional(),
    labelKey: z.string().optional(),
    cacheTtlSeconds: z.number().int().positive().default(300),

    // ── Computed field
    formula: z.string().optional(),

    // ── Validation rules
    validation: z
      .object({
        minLength: z.number().int().optional(),
        maxLength: z.number().int().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        pattern: z.string().optional(), // regex
        patternMessage: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((field, ctx) => {
    // Dynamic fields must have apiSourceId + apiPath
    if (['dynamic-select', 'dynamic-multi-select', 'cascading-select'].includes(field.type)) {
      if (!field.apiSourceId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field.id}: dynamic fields require apiSourceId` });
      }
      if (!field.apiPath) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field.id}: dynamic fields require apiPath` });
      }
    }
    // Cascading fields must declare what they depend on
    if (field.type === 'cascading-select' && !field.dependsOn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field.id}: cascading-select requires dependsOn` });
    }
    // Computed fields must have a formula
    if (field.type === 'computed' && !field.formula) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field.id}: computed fields require formula` });
    }
    // Static selects must have options
    if (['select', 'multi-select'].includes(field.type) && !field.apiSourceId && !field.options?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${field.id}: select fields require options or apiSourceId` });
    }
  });

// ─── Form definition ──────────────────────────────────────────────────────────

const ConditionSchema = z.object({
  when: z.object({
    fieldId: z.string(),
    operator: z.enum(['equals', 'not_equals', 'contains', 'gt', 'lt']).default('equals'),
    value: z.unknown(),
  }),
  show: z.array(z.string()).optional(),
  hide: z.array(z.string()).optional(),
});

const ApprovalStageSchema = z.object({
  name: z.string().min(1),
  approverType: z.enum(['reporter-manager', 'specific', 'group']).optional(),
  approverAccountId: z.string().optional(),
  approverGroupId: z.string().optional(),
  /** Optional JQL-style condition. Stage is skipped when condition is false. */
  condition: z.string().optional(),
});

export const FormSchema = z.object({
  version: z.number().int().min(1),
  fields: z.array(FieldSchema).min(1),
  conditions: z.array(ConditionSchema).optional(),
  approval: z
    .object({
      enabled: z.boolean(),
      stages: z.array(ApprovalStageSchema).min(1),
    })
    .optional(),
});

// ─── Request type ─────────────────────────────────────────────────────────────

export const RequestTypeSchema = z.object({
  id: z.string().regex(/^rt-[a-z0-9-]+$/, 'id must be kebab-case, prefixed rt-'),
  name: z.string().min(1),
  description: z.string(),
  icon: z.string().optional(),
  /**
   * Set to null for new request types — the sync engine will create them
   * in JSM and write back the assigned ID. Once set, this is the stable
   * JSM request type ID and should not be changed manually.
   */
  jsmRequestTypeId: z.string().nullable(),
  form: FormSchema,
});

// ─── Queue ────────────────────────────────────────────────────────────────────

const QueueColumnSchema = z.enum([
  'issueKey',
  'summary',
  'assignee',
  'reporter',
  'priority',
  'status',
  'created',
  'updated',
  'sla',
  'labels',
  'components',
]);

const HighlightRuleSchema = z.object({
  condition: z.string().describe('Simple expression e.g. "sla.breaching == true"'),
  color: HexColor,
});

export const QueueSchema = z.object({
  id: z.string().regex(/^queue-[a-z0-9-]+$/, 'id must be kebab-case, prefixed queue-'),
  name: z.string().min(1),
  /** Standard Jira JQL. Will be validated against JSM in dry-run mode. */
  jql: z.string().min(1),
  columns: z.array(QueueColumnSchema).min(1).max(10),
  highlightRules: z.array(HighlightRuleSchema).optional(),
  autoAssign: z.boolean().default(false),
  notifyOnNew: z
    .object({
      channel: z.enum(['slack', 'email', 'teams']),
      target: z.string().describe('Slack channel e.g. #it-critical, email address, or Teams webhook'),
    })
    .optional(),
});

// ─── Department ───────────────────────────────────────────────────────────────

export const DepartmentSchema = z.object({
  id: z.string().regex(/^dept-[a-z-]+$/, 'id must be kebab-case, prefixed dept-'),
  name: z.string().min(1),
  /**
   * Must match an existing JSM project key exactly.
   * The sync engine will verify this on startup and fail loudly if not found.
   */
  jsmProjectKey: z.string().regex(/^[A-Z]{1,10}$/, 'JSM project key must be 1–10 uppercase letters'),
  icon: z.string().optional(),
  color: HexColor,
  /** Jira SLA calendar name as configured in your Jira instance */
  slaCalendar: z.string(),
  sla: z.object({
    firstResponseHours: z.number().positive(),
    resolutionHours: z.number().positive(),
  }),
  agents: z.array(z.object({ accountId: z.string().min(1) })).min(1),
  escalation: z
    .object({
      afterBreachMinutes: z.number().int().positive(),
      notifyAccountId: z.string(),
    })
    .optional(),
});

// ─── Full loaded config (assembled by config-loader/index.ts) ─────────────────

export const LoadedConfigSchema = z.object({
  global: GlobalConfigSchema,
  apiSources: z.array(ApiSourceSchema),
  departments: z.array(
    DepartmentSchema.extend({
      requestTypes: z.array(RequestTypeSchema),
      queues: z.array(QueueSchema),
    }),
  ),
});

// ─── Exported TypeScript types ────────────────────────────────────────────────

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type ApiSource = z.infer<typeof ApiSourceSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type Form = z.infer<typeof FormSchema>;
export type RequestType = z.infer<typeof RequestTypeSchema>;
export type Queue = z.infer<typeof QueueSchema>;
export type Department = z.infer<typeof DepartmentSchema>;
export type LoadedConfig = z.infer<typeof LoadedConfigSchema>;
