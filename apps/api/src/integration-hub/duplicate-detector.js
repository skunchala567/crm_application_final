// =====================================================
// Duplicate Detector
// Detects duplicate leads based on phone, email, and name
// =====================================================

export const DUPLICATE_DETECTION_STRATEGIES = {
  skip: 'skip',
  update: 'update',
  create_new: 'create_new'
};

export class DuplicateDetector {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;
  }

  async findDuplicate(organizationId, leadData, strategy = 'all') {
    try {
      const { phone, email, student_name } = leadData;

      if (!phone && !email && !student_name) {
        return null;
      }

      let query = 'SELECT id FROM crm_leads WHERE (';
      const params = [];
      const conditions = [];

      if (phone) {
        conditions.push('phone = ?');
        params.push(this.normalizePhone(phone));
      }

      if (email) {
        conditions.push('LOWER(email) = ?');
        params.push(email.toLowerCase());
      }

      if (student_name && strategy !== 'phone_only' && strategy !== 'email_only') {
        conditions.push('student_name = ?');
        params.push(student_name);
      }

      if (conditions.length === 0) {
        return null;
      }

      query += conditions.join(' OR ') + ') LIMIT 1';

      const [rows] = await this.pool.execute(query, params);

      if (rows && rows.length > 0) {
        return {
          id: rows[0].id,
          matchType: strategy
        };
      }

      return null;
    } catch (error) {
      this.logger.error('Duplicate detection failed', error);
      return null;
    }
  }

  normalizePhone(phone) {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '');
  }
}
