# WhatsApp Templates Module

Production-ready WhatsApp template management system for the CRM application integrated with Smartping/AiSensy.

## Features

### Template Management
- ✅ Create, read, update, delete templates
- ✅ Save as draft and submit for approval
- ✅ Clone existing templates
- ✅ Archive templates
- ✅ Status tracking (Draft, Pending, Approved, Rejected, Archived)

### Template Creation Form
- ✅ Template name validation (lowercase, numbers, underscores only)
- ✅ Category selection (Marketing, Utility, Authentication)
- ✅ Language support (45+ languages)
- ✅ Template type (Text, Image, Video, Document)
- ✅ Optional header (Text, Image, Video, Document)
- ✅ Message body with formatting support (Bold, Italic, Strikethrough, Monospace)
- ✅ Optional footer
- ✅ Dynamic variables support ({{1}}, {{2}}, etc.)
- ✅ Sample values for variables
- ✅ Call-to-Action buttons (Visit Website, Call Phone)
- ✅ Quick Reply buttons
- ✅ Tab-based form navigation

### Live Mobile Preview
- ✅ Real WhatsApp styling
- ✅ Real-time preview updates
- ✅ Variable highlighting
- ✅ Button preview
- ✅ Message statistics (character count, button count)
- ✅ Sample value preview

### Template Listing
- ✅ Tab navigation (All, Drafts, Pending, Approved, Rejected, Archived)
- ✅ Search by template name
- ✅ Filter by category, language, type
- ✅ Sortable columns
- ✅ Status-based color coding
- ✅ Bulk actions (Delete, Archive, Clone)

### Validation
- ✅ Client-side validation (real-time)
- ✅ Server-side validation
- ✅ Sequential variable validation
- ✅ Required sample values
- ✅ Phone number format validation
- ✅ URL validation (https only)
- ✅ Character count limits
- ✅ Duplicate template name prevention

## File Structure

```
WhatsAppTemplates/
├── WhatsAppTemplatesPage.jsx       # Main container component
├── WhatsAppTemplateForm.jsx        # Template creation/edit form
├── WhatsAppTemplateList.jsx        # Template listing with filters
├── WhatsAppMobilePreview.jsx       # Live WhatsApp preview
├── validation.js                   # Client-side validation utilities
├── index.js                        # Module exports
└── README.md                       # This file
```

## Backend Files

```
apps/api/src/whatsapp/
├── whatsapp-template.service.js   # Business logic & database operations
├── whatsapp-template.routes.js    # API endpoints
└── index.js                       # Module exports
```

```
apps/api/src/migrations/
└── create_whatsapp_templates_table.sql  # Database schema
```

## API Endpoints

### Templates CRUD
- `POST /api/whatsapp/integrations/:integrationId/templates` - Create template
- `GET /api/whatsapp/integrations/:integrationId/templates` - List templates
- `GET /api/whatsapp/integrations/:integrationId/templates/:templateId` - Get template
- `PUT /api/whatsapp/integrations/:integrationId/templates/:templateId` - Update template
- `DELETE /api/whatsapp/integrations/:integrationId/templates/:templateId` - Delete template

### Template Actions
- `POST /api/whatsapp/integrations/:integrationId/templates/:templateId/submit` - Submit for approval
- `POST /api/whatsapp/integrations/:integrationId/templates/:templateId/clone` - Clone template
- `POST /api/whatsapp/integrations/:integrationId/templates/:templateId/archive` - Archive template
- `POST /api/whatsapp/integrations/:integrationId/templates/validate` - Validate template
- `GET /api/whatsapp/integrations/:integrationId/templates/:templateId/sync-logs` - Get sync logs

## Database Schema

### whatsapp_templates
Main template storage table with fields for name, content, buttons, sample values, and status.

### whatsapp_template_buttons
Child table for button configuration (Call-to-Action and Quick Reply).

### whatsapp_template_media
Media file storage for header/body images, videos, documents.

### whatsapp_template_sync_logs
Audit trail for template creation, updates, submissions.

## Usage

### Integration into CRM
```jsx
import { WhatsAppTemplatesPage } from './pages/WhatsAppTemplates';

<WhatsAppTemplatesPage integrationId={integrationId} />
```

### Form Validation
```jsx
import { validateCompleteTemplate, validateRealtime } from './pages/WhatsAppTemplates/validation';

// Complete validation
const validation = validateCompleteTemplate(template);

// Real-time field validation
const result = validateRealtime(template, 'template_name');
```

## Validation Rules

### Template Name
- Lowercase letters, numbers, underscores only
- No spaces
- Max 255 characters
- Must be unique per integration

### Message Body
- Required
- Max 1024 characters
- Supports formatting: **bold**, __underline__, ~~strike~~, ```code```
- Variables must be sequential: {{1}}, {{2}}, {{3}}, ...

### Variables
- Format: {{number}}
- Sequential (no gaps)
- Sample values required for submission
- Auto-detected from body

### Footer
- Optional
- Max 60 characters

### Buttons
- Max 3 total buttons
- Max 3 quick replies
- CTA button text: max 25 characters
- CTA types: Visit Website (HTTPS URLs) or Call Phone (valid format)
- Quick reply text: max 20 characters

### Sample Values
- Required for each variable
- Cannot be empty

## Status Workflow

1. **DRAFT** - Initial template state, fully editable
2. **PENDING** - Submitted to Smartping for approval
3. **APPROVED** - Template approved by Smartping, ready to use
4. **REJECTED** - Template rejected with reason, can edit and resubmit
5. **ARCHIVED** - Template archived, no longer active

## Testing

### Unit Tests
- Template name validation
- Variable extraction and validation
- Phone number and URL validation
- Character count validation

### Integration Tests
- Template CRUD operations
- Template submission workflow
- Clone and archive operations
- Database constraints

### UI Tests
- Form field validation
- Tab navigation
- Live preview updates
- Filter and search functionality

### Edge Cases
- Empty templates
- Maximum length texts
- Invalid phone numbers
- Invalid URLs
- Duplicate names
- Missing sample values
- Out-of-sequence variables

## Performance Considerations

- Lazy loading for template list
- Pagination support (default 20 per page)
- Debounced search (300ms)
- Optimized re-renders using React hooks
- Database indexes on frequently queried fields
- Connection pooling for database

## Security

- Input sanitization on all form fields
- Server-side validation of all inputs
- Prevention of XSS attacks (React escaping)
- Prevention of SQL injection (parameterized queries)
- Authentication required for all endpoints
- Authorization checks for integrations
- Audit logging for all operations
- Template uniqueness enforced per integration/organization

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Responsive Design

- Desktop: 70% form, 30% preview side-by-side
- Tablet: Full-width form with preview below
- Mobile: Form-only view, preview on-demand

## Future Enhancements

- [ ] Template preview in Smartping before submission
- [ ] Bulk template operations
- [ ] Template versioning
- [ ] Template collaboration/comments
- [ ] Export templates to CSV/JSON
- [ ] Template scheduling
- [ ] Analytics/usage tracking
- [ ] Multi-language template variants
- [ ] A/B testing support
