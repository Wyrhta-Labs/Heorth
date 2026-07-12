import { describe, it, expect } from 'vitest';
import { seedTestHousehold } from './helpers.js';
import * as service from '../src/household/service.js';

describe('household service', () => {
  it('seeds a household and lists three members', async () => {
    await seedTestHousehold();
    const members = await service.listMembers();
    expect(members.length).toBe(3);
    expect(members.filter((m) => m.role === 'admin').length).toBe(1);
  });

  it('creates a member and rejects a duplicate email', async () => {
    await seedTestHousehold();
    const created = await service.createMember({
      email: 'new@test.local', password: 'pw-new-12', displayName: 'New',
      avatarColor: 'ember', role: 'adult',
    });
    expect(created.email).toBe('new@test.local');
    await expect(
      service.createMember({
        email: 'new@test.local', password: 'pw-new-12', displayName: 'Dup',
        avatarColor: 'taupe', role: 'child',
      }),
    ).rejects.toThrow('EMAIL_TAKEN');
  });

  it('promotes a member role', async () => {
    const { adult } = await seedTestHousehold();
    const updated = await service.setMemberRole(adult.user.id, 'admin');
    expect(updated?.role).toBe('admin');
  });

  it('refuses to delete the last admin and refuses self-deletion', async () => {
    const { admin, adult } = await seedTestHousehold();
    await expect(service.deleteMember(admin.user.id, adult.user.id)).rejects.toThrow('LAST_ADMIN');
    await expect(service.deleteMember(adult.user.id, adult.user.id)).rejects.toThrow('CANNOT_DELETE_SELF');
  });

  it('logs in with correct credentials and returns a token', async () => {
    await seedTestHousehold();
    const result = await service.login('admin@test.local', 'test-admin-password');
    expect(result?.token).toBeTruthy();
    const bad = await service.login('admin@test.local', 'wrong');
    expect(bad).toBeNull();
  });
});
