import { describe, it, expect } from 'vitest';
import {
  MAINTENANCE_ADMIN_HANDLE, MaintenanceAdminError, isMaintenanceAdmin,
  isMaintenanceAdminId, assertNotMaintenanceAdmin, assertNoneAreMaintenanceAdmin,
} from '../src/household/maintenance-admin.js';
import { seedTestHousehold } from './helpers.js';

describe('maintenance-admin anchor', () => {
  it('anchors on the handle, not the email or the role', () => {
    expect(MAINTENANCE_ADMIN_HANDLE).toBe('admin');
    expect(isMaintenanceAdmin({ handle: 'admin' })).toBe(true);
    expect(isMaintenanceAdmin({ handle: 'adult' })).toBe(false);
    expect(isMaintenanceAdmin(null)).toBe(false);
  });

  it('resolves a member id against the anchor', async () => {
    const { admin, adult } = await seedTestHousehold();
    expect(await isMaintenanceAdminId(admin.user.id)).toBe(true);
    expect(await isMaintenanceAdminId(adult.user.id)).toBe(false);
    expect(await isMaintenanceAdminId('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('assertNotMaintenanceAdmin throws ADMIN_NOT_A_MEMBER for the admin only', async () => {
    const { admin, adult } = await seedTestHousehold();
    await expect(assertNotMaintenanceAdmin(admin.user.id)).rejects.toThrow(MaintenanceAdminError);
    await expect(assertNotMaintenanceAdmin(adult.user.id)).resolves.toBeUndefined();
    // null/undefined mean "no member assigned" — not a violation.
    await expect(assertNotMaintenanceAdmin(null)).resolves.toBeUndefined();
  });

  it('carries the ADMIN_NOT_A_MEMBER code', async () => {
    const { admin } = await seedTestHousehold();
    await expect(assertNotMaintenanceAdmin(admin.user.id)).rejects.toMatchObject({
      code: 'ADMIN_NOT_A_MEMBER',
    });
  });

  it('assertNoneAreMaintenanceAdmin rejects a list containing the admin', async () => {
    const { admin, adult, child } = await seedTestHousehold();
    await expect(assertNoneAreMaintenanceAdmin([adult.user.id, child.user.id])).resolves.toBeUndefined();
    await expect(assertNoneAreMaintenanceAdmin([adult.user.id, admin.user.id])).rejects.toThrow(MaintenanceAdminError);
    await expect(assertNoneAreMaintenanceAdmin([])).resolves.toBeUndefined();
  });
});
