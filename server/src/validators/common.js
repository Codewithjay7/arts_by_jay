import { z } from 'zod';
import mongoose from 'mongoose';

export const objectId = z
  .string()
  .refine((value) => mongoose.Types.ObjectId.isValid(value), 'That identifier is not valid.');

export const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

export const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.')
  .refine((value) => /[a-z]/i.test(value), 'Include at least one letter.')
  .refine((value) => /\d/.test(value), 'Include at least one number.');

export const shortText = (max = 200) => z.string().trim().max(max);
export const longText = (max = 4000) => z.string().trim().max(max);

/** Prices arrive from forms as major units and are stored as minor units. */
export const priceMajor = z.coerce
  .number()
  .min(0, 'Price cannot be negative.')
  .max(100_000_000, 'That price is too large.');

export const boolish = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return value;
}, z.boolean());

/** Accepts a repeated query param, a JSON array, or a comma-separated list. */
export const listOfStrings = (max = 20) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          /* fall through to comma splitting */
        }
      }
      return trimmed.split(',').map((part) => part.trim()).filter(Boolean);
    }
    return [];
  }, z.array(z.string().trim().max(60)).max(max));

export const addressSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the recipient name.').max(120),
  phone: z.string().trim().min(6, 'Enter a contact number.').max(32),
  line1: z.string().trim().min(4, 'Enter the street address.').max(200),
  line2: shortText(200).optional().default(''),
  city: z.string().trim().min(2, 'Enter the city.').max(100),
  state: z.string().trim().min(2, 'Enter the state or region.').max(100),
  postalCode: z.string().trim().min(3, 'Enter the postal code.').max(20),
  country: z.string().trim().min(2, 'Enter the country.').max(60).default('India'),
});
