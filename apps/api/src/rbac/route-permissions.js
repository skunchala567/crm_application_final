/**
 * Which permission each API route requires.
 *
 * Kept as one ordered table rather than a `requirePermission(...)` call bolted
 * onto each of the 262 endpoints, for two reasons. An endpoint cannot be
 * forgotten -- anything unmatched is denied by default, so a new route is
 * closed until someone maps it, which is the safe direction to fail. And the
 * whole access surface can be read, reviewed and tested in one place.
 *
 * First match wins, so put specific rules above general ones. `null` means the
 * route is deliberately open (it authenticates by other means, or must work
 * before permissions can be loaded).
 */

/** Routes that must never require a CRM permission, with the reason why. */
export const OPEN_ROUTES = [
  { test: /^\/api\/auth\//, why: 'authentication itself; a user has no permissions until logged in' },
  { test: /^\/api\/public\//, why: 'public enquiry and payment forms, used by prospects with no account' },
  { test: /^\/api\/health/, why: 'liveness probe' },
  { test: /webhook/, why: 'inbound platform callbacks, verified by signature not by session' },
  { test: /^\/api\/usage\/(heartbeat|today)/, why: 'own session timer; every signed-in user has it' },
  { test: /^\/api\/notifications/, why: 'each signed-in user may read and acknowledge only their own notifications' },
  { test: /^\/api\/rbac\/me$/, why: 'a user must be able to read their own permissions' },
  { test: /^\/api\/platform\/business-units$/, why: 'the shell cannot render before it knows the units' },
  { test: /^\/api\/oauth\//, why: 'OAuth redirect handling' },
  { test: /^\/api\/partner\//, why: 'partner write-back, authenticated by an API key rather than a user session' },
];

/**
 * method: HTTP verb or '*'
 * test:   path matcher
 * key:    permission required
 */
export const ROUTE_RULES = [
  // ---- Access control itself -------------------------------------------
  { method: 'GET', test: /^\/api\/rbac\/(registry|roles|audit|denials|settings)/, key: 'settings.access_control.view' },
  { method: 'POST', test: /^\/api\/rbac\/roles$/, key: 'settings.access_control.create' },
  { method: 'POST', test: /^\/api\/rbac\/roles\/[^/]+\/clone$/, key: 'settings.access_control.create' },
  { method: '*', test: /^\/api\/rbac\/roles\/[^/]+\/users/, key: 'settings.access_control.assign' },
  { method: 'DELETE', test: /^\/api\/rbac\/roles\//, key: 'settings.access_control.delete' },
  { method: '*', test: /^\/api\/rbac\//, key: 'settings.access_control.edit' },

  // ---- Leads ------------------------------------------------------------
  { method: 'GET', test: /^\/api\/leads\/[^/]+\/activities/, key: 'leads.detail.activities.view' },
  { method: 'POST', test: /^\/api\/leads\/[^/]+\/activities/, key: 'leads.detail.activities.create' },
  { method: 'GET', test: /^\/api\/leads\/[^/]+\/(history|stage-history|source-history)/, key: 'leads.detail.history.view' },
  { method: 'GET', test: /^\/api\/leads\/[^/]+\/documents/, key: 'leads.detail.documents.view' },
  { method: 'POST', test: /^\/api\/leads\/[^/]+\/documents/, key: 'leads.detail.documents.upload' },
  { method: '*', test: /^\/api\/leads\/[^/]+\/notes/, key: 'leads.detail.notes.view' },
  /*
   * Actions on many leads at once.
   *
   * These are the bulk toolbar's endpoints, so they answer to the Bulk
   * Actions permissions rather than to leads.list.*. Without these rules
   * `PUT /api/leads/actions/bulk-refer` fell through to the generic
   * `PUT /api/leads` rule and was allowed by leads.list.edit -- so revoking
   * Bulk Actions did not actually stop a bulk change.
   */
  { method: '*', test: /^\/api\/leads\/actions\/bulk-(refer|assign|reassign)/, key: 'bulk_actions.refer.assign' },
  { method: '*', test: /^\/api\/leads\/actions\/bulk-/, key: 'bulk_actions.change_stage.edit' },
  { method: 'POST', test: /^\/api\/leads\/(bulk|import)/, key: 'bulk_actions.upload.import' },
  { method: 'POST', test: /^\/api\/leads\/[^/]+\/(assign|refer|reassign)/, key: 'leads.list.assign' },
  { method: 'GET', test: /^\/api\/leads\/export/, key: 'bulk_actions.export.export' },
  { method: 'GET', test: /^\/api\/leads/, key: 'leads.list.view' },
  { method: 'POST', test: /^\/api\/leads/, key: 'leads.list.create' },
  { method: 'PUT', test: /^\/api\/leads/, key: 'leads.list.edit' },
  { method: 'PATCH', test: /^\/api\/leads/, key: 'leads.list.edit' },
  { method: 'DELETE', test: /^\/api\/leads/, key: 'leads.list.delete' },

  { method: '*', test: /^\/api\/search/, key: 'leads.search.view' },
  // Reading campaigns is reference data for the Leads filters, so it follows
  // the leads permission. Only creating and changing them is marketing work.
  { method: 'GET', test: /^\/api\/marketing/, key: 'leads.list.view' },
  { method: '*', test: /^\/api\/marketing/, key: 'leads.marketing.create' },
  { method: '*', test: /^\/api\/bulk/, key: 'bulk_actions.workspace.view' },

  /*
   * Business-unit sub-resources.
   *
   * These live under /api/platform/business-units/:id/ but are not settings.
   * They are the Tracker's own data and the reference lists the Leads screen
   * needs to render, so gating them behind settings.business_units.view
   * refused a counsellor the Tracker board and made the Leads screen raise
   * "You do not have permission" while it loaded. Ordered above the general
   * /api/platform rules, which still cover the real configuration screens.
   */
  { method: 'GET', test: /^\/api\/platform\/business-units\/[^/]+\/mom-sessions/, key: 'tracker.mom.view' },
  { method: '*', test: /^\/api\/platform\/business-units\/[^/]+\/mom-sessions/, key: 'tracker.mom.create' },
  { method: 'GET', test: /^\/api\/platform\/business-units\/[^/]+\/(operations|tracker-)/, key: 'tracker.board.view' },
  { method: '*', test: /^\/api\/platform\/business-units\/[^/]+\/(operations|tracker-)/, key: 'tracker.board.edit' },
  // The unit's CRM configuration: stages, sources, fields. Every screen that
  // shows a lead needs it, so it is bound to seeing leads, not to settings.
  { method: 'GET', test: /^\/api\/platform\/business-units\/[^/]+\/(config|metadata|fields|stages|sources)/, key: 'leads.list.view' },

  // ---- Tracker / operations --------------------------------------------
  { method: 'GET', test: /^\/api\/(tracker|mom)/, key: 'tracker.board.view' },
  { method: '*', test: /^\/api\/mom/, key: 'tracker.mom.create' },
  { method: '*', test: /^\/api\/tracker/, key: 'tracker.board.edit' },
  { method: 'GET', test: /^\/api\/operations/, key: 'operations.records.view' },
  { method: '*', test: /^\/api\/operations/, key: 'operations.records.edit' },

  // ---- Reports ----------------------------------------------------------
  { method: 'GET', test: /^\/api\/report-data-sources/, key: 'reports.list.view' },
  { method: '*', test: /^\/api\/report-data-sources/, key: 'reports.saved.edit' },
  { method: 'GET', test: /^\/api\/reports/, key: 'reports.list.view' },
  { method: '*', test: /^\/api\/(reports|saved-reports)/, key: 'reports.saved.edit' },

  // ---- Dashboard --------------------------------------------------------
  { method: 'GET', test: /^\/api\/dashboard/, key: 'dashboard.overview.view' },
  { method: '*', test: /^\/api\/dashboard/, key: 'dashboard.layout.edit' },

  // ---- Automations ------------------------------------------------------
  { method: 'GET', test: /^\/api\/automations/, key: 'automations.workflows.view' },
  { method: '*', test: /^\/api\/automations/, key: 'automations.workflows.edit' },

  // ---- WhatsApp ---------------------------------------------------------
  /*
   * Reading the accounts is part of sending: a counsellor needs to know which
   * number they may send from. Changing which branches an account serves is
   * administration, so it answers to the template permission rather than to
   * inbox.create -- which counsellors hold, and which would otherwise have let
   * them remap another branch's WhatsApp number.
   */
  { method: 'GET', test: /^\/api\/whatsapp\/accounts$/, key: 'whatsapp.inbox.view' },
  { method: 'GET', test: /^\/api\/whatsapp\/branch-accounts/, key: 'whatsapp.inbox.view' },
  { method: '*', test: /^\/api\/whatsapp\/branch-accounts/, key: 'whatsapp.templates.edit' },
  { method: '*', test: /^\/api\/whatsapp\/accounts\/[^/]+\/branches/, key: 'whatsapp.templates.edit' },
  { method: '*', test: /^\/api\/whatsapp\/templates\/[^/]+\/users/, key: 'whatsapp.templates.edit' },
  { method: 'GET', test: /^\/api\/whatsapp\/templates/, key: 'whatsapp.templates.view' },
  { method: '*', test: /^\/api\/whatsapp\/templates/, key: 'whatsapp.templates.edit' },
  { method: 'GET', test: /^\/api\/whatsapp/, key: 'whatsapp.inbox.view' },
  { method: '*', test: /^\/api\/whatsapp/, key: 'whatsapp.inbox.create' },

  // ---- Integrations -----------------------------------------------------
  { method: 'GET', test: /^\/api\/meta/, key: 'integrations.meta_lead_ads.view' },
  { method: '*', test: /^\/api\/meta/, key: 'integrations.meta_lead_ads.manage' },
  // Placing a call and reading its outcome is lead work done from the Leads
  // screen, not integration administration. Only the credentials and settings
  // below stay with the integration permission.
  { method: '*', test: /^\/api\/callerdesk\/(campaigns|calls|click-to-call|members|groups)/, key: 'leads.list.view' },
  { method: 'GET', test: /^\/api\/callerdesk/, key: 'integrations.callerdesk.view' },
  { method: '*', test: /^\/api\/callerdesk/, key: 'integrations.callerdesk.manage' },
  { method: 'GET', test: /^\/api\/smartflo/, key: 'integrations.smartflo.view' },
  { method: '*', test: /^\/api\/smartflo/, key: 'integrations.smartflo.manage' },
  { method: 'GET', test: /^\/api\/hub\/google/, key: 'integrations.google_sheets.view' },
  { method: '*', test: /^\/api\/hub\/google/, key: 'integrations.google_sheets.manage' },
  // Smartping under /hub is the WhatsApp conversation feed the Leads screen
  // polls for unread counts -- messaging, not integration administration.
  { method: 'GET', test: /^\/api\/hub\/smartping\/(conversations|messages)/, key: 'whatsapp.inbox.view' },
  { method: '*', test: /^\/api\/hub\/smartping\/(conversations|messages)/, key: 'whatsapp.inbox.create' },
  { method: 'GET', test: /^\/api\/hub/, key: 'integrations.hub.view' },
  { method: '*', test: /^\/api\/hub/, key: 'integrations.hub.manage' },

  // ---- Settings ---------------------------------------------------------
  { method: 'GET', test: /^\/api\/admin\/users/, key: 'settings.users.view' },
  { method: 'POST', test: /^\/api\/admin\/users/, key: 'settings.users.create' },
  { method: '*', test: /^\/api\/admin\/users/, key: 'settings.users.edit' },
  { method: 'GET', test: /^\/api\/branches/, key: 'settings.branches.view' },
  { method: '*', test: /^\/api\/branches/, key: 'settings.branches.edit' },
  { method: 'GET', test: /^\/api\/payment-forms/, key: 'settings.payment_forms.view' },
  { method: '*', test: /^\/api\/payment-forms/, key: 'settings.payment_forms.edit' },
  { method: 'GET', test: /^\/api\/jodo/, key: 'settings.payment_forms.view' },
  { method: '*', test: /^\/api\/jodo/, key: 'settings.payment_forms.edit' },
  { method: 'GET', test: /^\/api\/platform\/business-units/, key: 'settings.business_units.view' },
  { method: '*', test: /^\/api\/platform\/business-units/, key: 'settings.business_units.edit' },
  { method: 'GET', test: /^\/api\/platform\/(academic|classes|admission)/, key: 'settings.academic_config.view' },
  { method: '*', test: /^\/api\/platform\/(academic|classes|admission)/, key: 'settings.academic_config.edit' },
  { method: 'GET', test: /^\/api\/platform\/enquiry-forms/, key: 'settings.enquiry_forms.view' },
  { method: '*', test: /^\/api\/platform\/enquiry-forms/, key: 'settings.enquiry_forms.edit' },
  { method: 'GET', test: /^\/api\/platform/, key: 'settings.lead_config.view' },
  { method: '*', test: /^\/api\/platform/, key: 'settings.lead_config.edit' },

  // ---- Lead configuration ------------------------------------------------
  { method: 'GET', test: /^\/api\/admin\/lead-config/, key: 'settings.lead_config.view' },
  { method: '*', test: /^\/api\/admin\/lead-config/, key: 'settings.lead_config.edit' },

  // ---- Academic and admission master data --------------------------------
  // Reads are reference data: a counsellor cannot fill in a lead without the
  // class and academic-year lists, so these sit behind the leads permission
  // rather than the settings one. Writes are configuration and stay locked.
  {
    method: 'GET',
    test: /^\/api\/(academic-years|curricula|admission-types|admission-class-configurations|admission-class-master-data|available-classes|available-curricula|available-admission-types|classes)/,
    key: 'leads.list.view',
  },
  {
    method: '*',
    test: /^\/api\/(academic-years|curricula|admission-types|admission-class-configurations|admission-class-master-data|classes)/,
    key: 'settings.academic_config.edit',
  },

  // ---- Saved filters are per-user working state, not shared configuration.
  { method: '*', test: /^\/api\/saved-filters/, key: 'leads.list.view' },

  // ---- Reference data every signed-in user needs to render a form -------
  { method: 'GET', test: /^\/api\/(employees|meta-data|lookups|stages|sources|channels|campaigns)/, key: 'leads.list.view' },
  { method: 'GET', test: /^\/api\/usage\/report/, key: 'settings.users.view' },
];

/** Is this path deliberately open? Returns the reason, or null. */
export function openRouteReason(pathname) {
  const match = OPEN_ROUTES.find((r) => r.test.test(pathname));
  return match ? match.why : null;
}

/** The permission a request needs, or null when the route is open. */
export function permissionForRequest(method, pathname) {
  if (openRouteReason(pathname)) return null;
  const rule = ROUTE_RULES.find(
    (r) => (r.method === '*' || r.method === method) && r.test.test(pathname),
  );
  return rule ? rule.key : undefined; // undefined = unmapped, deny by default
}
