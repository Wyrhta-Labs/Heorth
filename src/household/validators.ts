import { z } from 'zod';

export const AVATAR_COLORS = ['ember', 'taupe', 'sage', 'sky'] as const;

export const createMemberSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  avatarColor: z.enum(AVATAR_COLORS),
  role: z.enum(['adult', 'child']).default('adult'),
  handle: z.string().min(1).optional(),
});

export const updateMemberSchema = z.object({
  displayName: z.string().min(1).optional(),
  avatarColor: z.enum(AVATAR_COLORS).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});

export const setRoleSchema = z.object({
  role: z.enum(['admin', 'adult', 'child']),
});

export const updateHouseholdSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createKeySchema = z.object({
  name: z.string().min(1),
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type SetRoleInput = z.infer<typeof setRoleSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateKeyInput = z.infer<typeof createKeySchema>;
