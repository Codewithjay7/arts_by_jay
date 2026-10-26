import { z } from 'zod';
import { email, password, shortText } from './common.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  email,
  password,
  // A visitor may ask to register as an artist. Only `customer` and `artist`
  // are accepted here; `admin` is never self-assignable.
  intent: z.enum(['customer', 'artist']).default('customer'),
  artistName: shortText(120).optional().default(''),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: password,
});
