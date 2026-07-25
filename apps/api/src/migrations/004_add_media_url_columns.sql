-- Add media URL columns to whatsapp_templates table
-- Supports Image, Video, and Document storage

ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS media_url LONGTEXT COMMENT 'URL for image media (IMAGE type)';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS video_url LONGTEXT COMMENT 'URL for video media (VIDEO type)';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS document_url LONGTEXT COMMENT 'URL for document/file (FILE/DOCUMENT type)';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS file_name VARCHAR(255) COMMENT 'Original file name for documents';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS file_size INT COMMENT 'File size in bytes';
ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) COMMENT 'File MIME type (e.g., application/pdf)';

-- Create index for quick lookup
ALTER TABLE whatsapp_templates ADD INDEX idx_template_type (template_type);

-- Log
SELECT 'Migration 004: Added media URL columns to whatsapp_templates' as status;
