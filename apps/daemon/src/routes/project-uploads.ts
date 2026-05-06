// @ts-nocheck
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { decodeMultipartFilename, ensureProject, sanitizeName } from '../projects/index.js';
import { sendApiError } from './helpers.js';

const UPLOAD_DIR = path.join(os.tmpdir(), 'od-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function createTempUpload({ fileSize }) {
  return multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => {
        file.originalname = decodeMultipartFilename(file.originalname);
        const safe = sanitizeName(file.originalname);
        cb(
          null,
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`,
        );
      },
    }),
    limits: { fileSize },
  });
}

export const upload = createTempUpload({ fileSize: 20 * 1024 * 1024 });
export const importUpload = createTempUpload({ fileSize: 100 * 1024 * 1024 });

export function sendMulterError(res, err) {
  if (err instanceof multer.MulterError) {
    const code = err.code || 'UPLOAD_ERROR';
    const statusByCode = {
      LIMIT_FILE_SIZE: 413,
      LIMIT_FILE_COUNT: 400,
      LIMIT_UNEXPECTED_FILE: 400,
      LIMIT_PART_COUNT: 400,
      LIMIT_FIELD_KEY: 400,
      LIMIT_FIELD_VALUE: 400,
      LIMIT_FIELD_COUNT: 400,
    };
    const errorByCode = {
      LIMIT_FILE_SIZE: 'file too large',
      LIMIT_FILE_COUNT: 'too many files',
      LIMIT_UNEXPECTED_FILE: 'unexpected file field',
      LIMIT_PART_COUNT: 'too many form parts',
      LIMIT_FIELD_KEY: 'field name too long',
      LIMIT_FIELD_VALUE: 'field value too long',
      LIMIT_FIELD_COUNT: 'too many form fields',
    };
    const status = statusByCode[code] ?? 400;
    const message = errorByCode[code] ?? 'upload failed';
    return sendApiError(
      res,
      status,
      code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
      message,
      { details: { legacyCode: code } },
    );
  }

  return sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
}

export function createProjectUploadMiddleware(projectsDir) {
  const projectUpload = multer({
    storage: multer.diskStorage({
      destination: async (req, _file, cb) => {
        try {
          const dir = await ensureProject(projectsDir, req.params.id);
          cb(null, dir);
        } catch (err) {
          cb(err, '');
        }
      },
      filename: (_req, file, cb) => {
        file.originalname = decodeMultipartFilename(file.originalname);
        const safe = sanitizeName(file.originalname);
        cb(null, `${Date.now().toString(36)}-${safe}`);
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  return function handleProjectUpload(req, res, next) {
    projectUpload.array('files', 12)(req, res, (err) => {
      if (err) {
        return sendMulterError(res, err);
      }
      next();
    });
  };
}
