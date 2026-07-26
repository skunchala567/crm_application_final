# Google Sheets Import Format Guide

## Required Columns (in order)

Your Google Sheet **MUST** have these column headers in the first row:

| Column | Field Name | Type | Required | Format/Rules |
|--------|-----------|------|----------|-------------|
| A | student_name | Text | ✅ Yes | Full name (min 2 characters) |
| B | phone | Text | ✅ Yes* | 10 digits, starts with 6-9 (Indian format) |
| C | email | Email | ✅ Yes* | Valid email address |
| D | alternate_phone | Text | ❌ No | 10 digits (Indian format) |
| E | applying_class | Text | ❌ No | Class/Grade name |
| F | parent_name | Text | ❌ No | Parent or guardian name |
| G | city | Text | ❌ No | City name |
| H | remarks | Text | ❌ No | Additional notes |
| I | lead_score | Number | ❌ No | 0-100 |

> **Note:** At least ONE of phone OR email is required for each row

## Sample Data

```
student_name | phone | email | alternate_phone | applying_class | parent_name | city | remarks | lead_score
Raj Kumar | 9876543210 | raj@example.com | 9876543211 | Class 10 | Mr. Kumar | Mumbai | Interested | 85
Priya Singh | 8765432109 | priya@example.com | | Class 9 | Mrs. Singh | Delhi | Follow up | 75
Arjun Patel | 7654321098 | arjun@example.com | 7654321099 | Class 11 | Mr. Patel | Bangalore | Pending | 90
Neha Sharma | 6543210987 | neha@example.com | | Class 10 | Mrs. Sharma | Pune | Active | 80
```

## Steps to Create Your Sheet

1. **Open Google Sheets** → Create a new spreadsheet
2. **Row 1 (Headers):** Enter the column names exactly as shown above
3. **Row 2+ (Data):** Enter your student/lead data
4. **Save:** Give your sheet a name (e.g., "Students Import May 2026")
5. **In CRM:**
   - Go to Integration Hub → Google Sheets → Settings
   - Click "Select Spreadsheet" and choose your sheet
   - Click "Field Mapping" tab
   - Review/adjust field mappings (Auto Map can help)
   - Go to "Sync Data" → Click "Import from Google Sheets"

## Validation Rules

### Phone Number
- Must be exactly 10 digits
- Must start with 6, 7, 8, or 9
- Example: ✅ `9876543210` ❌ `1234567890`

### Email
- Must be a valid email format
- Example: ✅ `student@example.com` ❌ `invalid.email`

### Student Name
- Cannot be empty
- Minimum 2 characters
- Example: ✅ `Raj Kumar` ❌ `R`

### Lead Score
- Optional number field
- Valid range: 0-100
- Example: ✅ `85` ❌ `150`

## Duplicate Detection

During import, the system checks for duplicates:
- **Phone:** Exact match (normalized)
- **Email:** Case-insensitive match
- **Name:** Exact match

If a duplicate is found:
- ✅ **Default:** Record is skipped
- 🔄 **Optional:** Existing record is updated

## Common Issues

### ❌ "Import failed: No data in sheet"
- Ensure you have data starting from Row 2
- Headers must be in Row 1

### ❌ "Invalid phone number"
- Phone must be exactly 10 digits
- Must start with 6, 7, 8, or 9

### ❌ "Missing contact information"
- Each row needs at least phone OR email

### ❌ "Duplicate detected"
- This is normal! The system is preventing duplicates
- To update instead of skip, configure in sync settings

## Download Template

**Download this template file:** [Google_Sheets_Import_Template.csv](https://example.com/template.csv)

Then:
1. Upload to Google Drive
2. Open with Google Sheets
3. Fill in your data
4. Use in CRM import

---

**Questions?** Check the Field Mapping tab to verify which CRM fields are mapped to your sheet columns.
