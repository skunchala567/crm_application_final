import { api } from './api';

/**
 * Record that somebody downloaded data.
 *
 * Every CSV in this app is built in the browser from rows already loaded, so
 * a download makes no server request and leaves no trace unless the screen
 * reports it. This is that report, and it is why the call sits beside each
 * download rather than inside a route somewhere.
 *
 * Deliberately quiet: a failure to record must never stop the person getting
 * their file. The audit trail is worth having, but not at the cost of
 * breaking the thing being audited -- so this resolves either way and only
 * logs when it could not write.
 *
 * @param {string} dataset  what was downloaded, as a person would name it
 * @param {number} rows     how many records the file contains
 * @param {string} fileName the file the browser saved
 * @param {Object} [extra]  columns chosen, filters in force, lead ids, and
 *                          `content` -- the file itself, kept so the same
 *                          bytes can be handed back later rather than
 *                          rebuilt from data that has since moved on
 */
export function recordDownload(dataset, rows, fileName, extra = {}) {
  return api('/bulk-operations/data-export', {
    method: 'POST',
    body: JSON.stringify({
      dataset,
      totalRecords: Number(rows) || 0,
      fileName,
      columns: extra.columns || [],
      context: extra.context || {},
      ...(extra.content ? { content: extra.content } : {}),
      ...(extra.leadIds ? { leadIds: extra.leadIds } : {}),
    }),
  }).catch((error) => {
    console.warn(`Download of "${dataset}" was not recorded: ${error.message}`);
  });
}
