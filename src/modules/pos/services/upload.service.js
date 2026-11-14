const crypto = require('crypto');
const config = require('../../../config');
const AppError = require('../../../shared/errors/AppError');

const CLOUDINARY_UPLOAD = (cloud) =>
  `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`;

/**
 * Upload a data-URL / base64 image to Cloudinary (signed, server-side only).
 * Returns { url, publicId }.
 */
async function uploadImageDataUrl(dataUrl, { folder = 'fatman/transfers' } = {}) {
  const cloud = config.cloudinaryCloudName;
  const apiKey = config.cloudinaryApiKey;
  const apiSecret = config.cloudinaryApiSecret;
  if (!cloud || !apiKey || !apiSecret) {
    throw new AppError('Cloudinary is not configured on the server', 503);
  }

  const raw = String(dataUrl || '');
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw);
  if (!m) throw new AppError('Send an image as a data URL', 400);
  const mime = m[1].toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(mime)) {
    throw new AppError('Only JPEG, PNG, WebP or GIF images are allowed', 400);
  }
  const b64 = m[2].replace(/\s+/g, '');
  if (b64.length > 10 * 1024 * 1024) {
    throw new AppError('Image is too large (max ~7MB)', 400);
  }

  const timestamp = Math.round(Date.now() / 1000);
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const body = new URLSearchParams();
  body.set('file', `data:${mime};base64,${b64}`);
  body.set('api_key', apiKey);
  body.set('timestamp', String(timestamp));
  body.set('signature', signature);
  body.set('folder', folder);

  const res = await fetch(CLOUDINARY_UPLOAD(cloud), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) {
    throw new AppError(json.error?.message || 'Cloudinary upload failed', 502);
  }
  return { url: json.secure_url, publicId: json.public_id };
}

/**
 * Destroy an uploaded image by public_id (or extract from a Cloudinary URL).
 */
async function deleteImage(publicIdOrUrl) {
  const cloud = config.cloudinaryCloudName;
  const apiKey = config.cloudinaryApiKey;
  const apiSecret = config.cloudinaryApiSecret;
  if (!cloud || !apiKey || !apiSecret) {
    throw new AppError('Cloudinary is not configured on the server', 503);
  }

  let publicId = String(publicIdOrUrl || '').trim();
  if (!publicId) throw new AppError('Missing image id', 400);

  if (/^https?:\/\//i.test(publicId)) {
    const m = /\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i.exec(publicId);
    if (!m) throw new AppError('Not a Cloudinary image URL', 400);
    publicId = decodeURIComponent(m[1]);
  }

  const timestamp = Math.round(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const body = new URLSearchParams();
  body.set('public_id', publicId);
  body.set('api_key', apiKey);
  body.set('timestamp', String(timestamp));
  body.set('signature', signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/destroy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.result !== 'ok' && json.result !== 'not found')) {
    throw new AppError(json.error?.message || 'Cloudinary delete failed', 502);
  }
  return { ok: true, result: json.result, publicId };
}

module.exports = { uploadImageDataUrl, deleteImage };
