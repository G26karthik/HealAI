import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

/**
 * Photo storage.
 *
 * Uploads go through the server rather than straight from the browser. An
 * unsigned browser preset would be one less hop, but it also means anyone can
 * push files into the account, and it requires a manual dashboard step that a
 * teammate cloning the repo would have to repeat. Server-side upload keeps the
 * credential where it belongs and works the moment .env is filled in.
 *
 * Only the URL and public_id are stored in MongoDB — never the image bytes.
 */

if (env.cloudinary.configured) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

export const cloudinaryReady = () => env.cloudinary.configured;

/**
 * @param {string} dataUri  a data: URI from the browser's FileReader
 * @returns {{url: string, publicId: string, bytes: number, stored: boolean}}
 */
export async function uploadPrescription(dataUri) {
  if (!env.cloudinary.configured) {
    // Not fatal. Vision can still read the bytes we already hold; we simply
    // have no durable copy, and the response says so.
    return { url: null, publicId: null, bytes: 0, stored: false, reason: 'Cloudinary not configured' };
  }

  const res = await cloudinary.uploader.upload(dataUri, {
    folder: 'healai/prescriptions',
    resource_type: 'image',
    // Downscale on the way in: a phone photo is far larger than vision needs,
    // and a smaller image is a faster upload on venue wifi.
    transformation: [{ width: 1600, height: 1600, crop: 'limit' }, { quality: 'auto:good' }],
  });

  return { url: res.secure_url, publicId: res.public_id, bytes: res.bytes, stored: true };
}
