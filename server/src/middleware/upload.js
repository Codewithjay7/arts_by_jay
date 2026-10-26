import multer from 'multer';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { ALLOWED_MIME } from '../services/storage.js';

/**
 * Files are buffered in memory so the storage service can sniff their magic
 * bytes before anything is written anywhere. The size limit is enforced by
 * multer, and the real format check happens in storage.assertIsImage.
 */
const limits = {
  fileSize: env.storage.maxUploadMb * 1024 * 1024,
  files: 8,
  fields: 40,
};

const fileFilter = (_req, file, cb) => {
  // A cheap first pass. The authoritative check is the byte sniff later.
  if (!ALLOWED_MIME.has(file.mimetype)) {
    cb(ApiError.badRequest('Only JPEG, PNG, WebP and AVIF images can be uploaded.'));
    return;
  }
  cb(null, true);
};

const uploader = multer({ storage: multer.memoryStorage(), limits, fileFilter });

/** Wraps multer so its own errors become our standard API errors. */
const run = (handler) => (req, res, next) =>
  handler(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest(`Each image must be ${env.storage.maxUploadMb} MB or smaller.`));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(ApiError.badRequest('Too many files, or an unexpected file field was sent.'));
      }
      return next(ApiError.badRequest(`Upload failed: ${err.message}`));
    }
    return next(err);
  });

export const uploadSingle = (field) => run(uploader.single(field));
export const uploadMany = (field, max = 8) => run(uploader.array(field, max));
