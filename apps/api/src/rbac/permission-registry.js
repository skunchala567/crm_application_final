/**
 * The permission registry: every module, screen, tab and feature the CRM
 * actually has, and the actions available on each.
 *
 * Built from a scan of the running application (262 API endpoints, 32 routes,
 * the sidebar and the settings menu) rather than invented, so a screen cannot
 * exist without a permission covering it. When a screen is added, its entry
 * belongs here and the seeder picks it up on the next migration run.
 *
 * Key format:  <module>.<screen>[.<tab>].<action>
 *   leads.list.view          - see the Leads screen
 *   leads.detail.notes.create - add a note on a lead
 *
 * Data scopes apply only where a key is marked `scoped`. Everything else is a
 * plain allow/deny, because "export, but only my own" is meaningful whereas
 * "open the settings screen, but only my own" is not.
 */

/** Every action the system understands. Order is the display order. */
export const ACTIONS = [
  'view', 'create', 'edit', 'delete', 'import', 'export',
  'assign', 'reassign', 'approve', 'download', 'upload', 'manage',
];

/**
 * Data scopes, widest last. The order matters: a scope check passes when the
 * granted scope is at or above the required one.
 */
export const DATA_SCOPES = ['none', 'own', 'team', 'department', 'all'];

export const SCOPE_RANK = Object.fromEntries(DATA_SCOPES.map((s, i) => [s, i]));

/** Quick presets offered in the UI above the matrix. */
export const PRESETS = ['no_access', 'view_only', 'full_access', 'custom'];

/**
 * The tree. `scoped: true` means this action honours the record scope;
 * `actions` lists what the feature supports.
 */
export const REGISTRY = [
  {
    module: 'dashboard', label: 'Dashboard',
    screens: [
      { screen: 'overview', label: 'Dashboard', route: '/', actions: ['view'], scoped: true },
      { screen: 'widgets', label: 'Dashboard Widgets', actions: ['view', 'edit'] },
      { screen: 'layout', label: 'Dashboard Layout Editor', actions: ['view', 'edit'] },
    ],
  },
  {
    module: 'leads', label: 'Leads',
    screens: [
      {
        screen: 'list', label: 'Leads', route: '/leads', scoped: true,
        actions: ['view', 'create', 'edit', 'delete', 'import', 'export', 'assign', 'reassign', 'download'],
      },
      {
        screen: 'detail', label: 'Lead Details', scoped: true,
        tabs: [
          { tab: 'overview', label: 'Overview', actions: ['view', 'edit'] },
          { tab: 'activities', label: 'Activities', actions: ['view', 'create', 'edit', 'delete'] },
          { tab: 'notes', label: 'Notes', actions: ['view', 'create', 'edit', 'delete'] },
          { tab: 'documents', label: 'Documents', actions: ['view', 'upload', 'download', 'delete'] },
          { tab: 'history', label: 'History', actions: ['view'] },
          { tab: 'payments', label: 'Payments', actions: ['view', 'create'] },
        ],
      },
      { screen: 'marketing', label: 'Marketing Campaigns', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'search', label: 'Global Search', actions: ['view'], scoped: true },
    ],
  },
  {
    /*
     * Bulk Actions: everything that acts on many leads at once.
     *
     * Its own module rather than a screen under Leads, because these are the
     * controls an administrator most often wants to withhold -- one switch to
     * stop a counsellor mass-reassigning or exporting, without touching their
     * day-to-day work on individual leads.
     *
     * One row per tile in the lightning menu, so the matrix reads the same
     * way the toolbar does.
     */
    module: 'bulk_actions', label: 'Bulk Actions',
    screens: [
      { screen: 'workspace', label: 'Bulk Actions screen', route: '/bulk-actions', actions: ['view', 'import', 'export', 'upload', 'download'] },
      { screen: 'toolbar', label: 'Lead toolbar (lightning menu)', actions: ['view'] },
      { screen: 'upload', label: 'Bulk Upload', actions: ['import'] },
      { screen: 'change_stage', label: 'Change Stage', actions: ['edit'] },
      { screen: 'refer', label: 'Refer', actions: ['assign'] },
      { screen: 'campaign', label: 'Campaign', actions: ['create'] },
      { screen: 'whatsapp', label: 'WhatsApp', actions: ['create'] },
      { screen: 'sms', label: 'SMS', actions: ['create'] },
      { screen: 'email', label: 'Email', actions: ['create'] },
      { screen: 'export', label: 'Export', actions: ['export'] },
      { screen: 'delete', label: 'Delete leads', actions: ['delete'] },
    ],
  },
  {
    module: 'tracker', label: 'Tracker',
    screens: [
      { screen: 'board', label: 'Tracker', route: '/tracker', actions: ['view', 'create', 'edit', 'delete', 'export'], scoped: true },
      { screen: 'mom', label: 'Minutes of Meeting', actions: ['view', 'create', 'edit', 'delete'] },
    ],
  },
  {
    module: 'operations', label: 'Operations',
    screens: [
      { screen: 'records', label: 'Operations', route: '/operations', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'], scoped: true },
    ],
  },
  {
    module: 'reports', label: 'Reports',
    screens: [
      { screen: 'list', label: 'Reports', route: '/reports', actions: ['view', 'export', 'download'], scoped: true },
      { screen: 'builder', label: 'Report Builder', route: '/saved-reports/new', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'saved', label: 'Saved Reports', actions: ['view', 'create', 'edit', 'delete', 'export'] },
    ],
  },
  {
    module: 'automations', label: 'Automations',
    screens: [
      { screen: 'workflows', label: 'Automations', route: '/automations', actions: ['view', 'create', 'edit', 'delete'] },
    ],
  },
  {
    module: 'whatsapp', label: 'WhatsApp',
    screens: [
      { screen: 'inbox', label: 'WhatsApp Inbox', route: '/whatsapp-inbox', actions: ['view', 'create'], scoped: true },
      { screen: 'templates', label: 'WhatsApp Templates', route: '/settings/whatsapp-templates', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
    ],
  },
  {
    /*
     * SMS is its own module rather than a screen under Integrations: sending
     * is day-to-day work for a counsellor, while a template's DLT Content ID
     * is configuration only an administrator should touch. One module lets
     * those be granted separately.
     */
    module: 'sms', label: 'SMS',
    screens: [
      { screen: 'templates', label: 'SMS Templates', route: '/settings/sms-templates', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'messages', label: 'SMS Messages', actions: ['view', 'create'], scoped: true },
    ],
  },
  {
    module: 'email', label: 'Email',
    screens: [
      { screen: 'configuration', label: 'Email Configuration', route: '/settings/email-configuration', actions: ['view', 'edit'] },
      { screen: 'templates', label: 'Email Templates', route: '/settings/email-templates', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'messages', label: 'Email Messages', actions: ['view', 'create'], scoped: true },
    ],
  },
  {
    module: 'integrations', label: 'Integrations',
    screens: [
      { screen: 'hub', label: 'Integrations', route: '/settings/integrations', actions: ['view', 'edit', 'manage'] },
      { screen: 'google_sheets', label: 'Google Sheets', route: '/settings/google-sheets', actions: ['view', 'edit', 'manage', 'import'] },
      /*
       * One key, several screens. Granting this also controls the Meta tabs
       * on Automations -- Review Meta Leads, Meta Lead Forms, Remarketing
       * audiences and Sync history -- which is not obvious from the settings
       * route alone, so the label says so.
       */
      { screen: 'meta_lead_ads', label: 'Meta Lead Ads (settings, lead forms, review queue, remarketing)', route: '/settings/meta-lead-ads', actions: ['view', 'edit', 'manage', 'import'] },
      { screen: 'callerdesk', label: 'CallerDesk', route: '/settings/callerdesk', actions: ['view', 'edit', 'manage'] },
      { screen: 'smartflo', label: 'Smartflo', route: '/settings/smartflo', actions: ['view', 'edit', 'manage'] },
      { screen: 'bonvoice', label: 'BonVoice IVR', route: '/settings/bonvoice', actions: ['view', 'edit', 'manage'] },
    ],
  },
  {
    /*
     * Payments: the money screens, as one module rather than a single
     * `settings.payment_forms` key covering all three.
     *
     * They were all gated by that one key, which made the three tabs
     * inseparable -- you could not let a branch manager read what their branch
     * collected without also letting them build public payment forms and edit
     * enquiry forms. Splitting them is what makes "give this user the Payments
     * screen" a decision rather than an all-or-nothing switch.
     *
     * Scoped, because the answer to "which collections?" is "the ones for your
     * branches", and every query behind these keys is branch-scoped to match.
     */
    module: 'payments', label: 'Payments',
    screens: [
      { screen: 'collections', label: 'Payment Collections', route: '/settings/payments', actions: ['view', 'export'], scoped: true },
      { screen: 'forms', label: 'Payment Forms', route: '/settings/payments', actions: ['view', 'create', 'edit', 'delete'], scoped: true },
      { screen: 'enquiry_forms', label: 'Enquiry Forms', route: '/settings/payments', actions: ['view', 'create', 'edit', 'delete'], scoped: true },
      { screen: 'links', label: 'Payment Links', actions: ['view', 'create', 'delete'], scoped: true },
    ],
  },
  {
    module: 'settings', label: 'Settings',
    screens: [
      { screen: 'users', label: 'User Management', route: '/settings/users', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { screen: 'access_control', label: 'Access Control', route: '/settings/users', actions: ['view', 'create', 'edit', 'delete', 'assign'] },
      { screen: 'business_units', label: 'Business Units', route: '/settings/business-units', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'branches', label: 'Branch Settings', route: '/settings/branches', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'lead_config', label: 'Lead Configuration', route: '/settings/lead-config', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'academic_config', label: 'Academic Configuration', route: '/settings/academic-config', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'business_config', label: 'Business Configuration', route: '/settings/business-units', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'academic_years', label: 'Academic Years', route: '/settings/academic-years', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'admission_classes', label: 'Admission Classes', route: '/settings/admission-classes', actions: ['view', 'create', 'edit', 'delete'] },
      { screen: 'audit', label: 'Access Audit Log', actions: ['view', 'export'] },
    ],
  },
];

/** Flatten the tree into the permission rows the database stores. */
export function buildPermissionRows() {
  const rows = [];
  for (const mod of REGISTRY) {
    for (const screen of mod.screens) {
      const push = (key, label, action, scoped, tab) => {
        rows.push({
          permissionKey: key,
          module: mod.module,
          moduleLabel: mod.label,
          screen: screen.screen,
          screenLabel: screen.label,
          tab: tab || null,
          tabLabel: tab ? screen.tabs.find((t) => t.tab === tab)?.label || tab : null,
          action,
          label,
          route: screen.route || null,
          // Scope only ever attaches to reading and changing records.
          isScoped: Boolean(scoped) && ['view', 'edit', 'delete', 'export', 'assign', 'reassign', 'download'].includes(action),
        });
      };

      if (screen.tabs) {
        for (const tab of screen.tabs) {
          for (const action of tab.actions) {
            push(
              `${mod.module}.${screen.screen}.${tab.tab}.${action}`,
              `${action} ${tab.label}`,
              action, screen.scoped, tab.tab,
            );
          }
        }
      }
      for (const action of screen.actions || []) {
        push(
          `${mod.module}.${screen.screen}.${action}`,
          `${action} ${screen.label}`,
          action, screen.scoped, null,
        );
      }
    }
  }
  return rows;
}

/** Every valid permission key, for validation and for the "unknown key" guard. */
export function allPermissionKeys() {
  return buildPermissionRows().map((r) => r.permissionKey);
}
