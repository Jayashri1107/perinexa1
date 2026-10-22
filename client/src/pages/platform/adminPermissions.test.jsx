// Admin permissions (22 Oct 2026): one card per hospital, each admin's permissions as tick chips (Add people first),
// "Also Doctor" on an admin who switches, no table to scroll sideways. Rendered to HTML from fake answers.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const admins = [
  { memberId: 'm2', tenantId: 't2', tenantName: 'Lotus Clinic (Demo)', roles: ['admin'], adminRights: [], user: { id: 'u2', name: 'Ravi Admin', email: 'ravi@example.com' } },
  { memberId: 'm1', tenantId: 't1', tenantName: 'Sunrise Hospital (Demo)', roles: ['admin', 'doctor'], adminRights: ['addPeople'], user: { id: 'u1', name: 'Dr Asha Sample', email: 'asha@example.com' } },
  { memberId: 'm3', tenantId: 't1', tenantName: 'Sunrise Hospital (Demo)', roles: ['admin'], adminRights: [], user: { id: 'u3', name: 'Bina Admin', email: 'bina@example.com' } },
];
vi.mock('../../auth/AuthContext.jsx', () => ({ useAuth: () => ({ platform: { role: 'superadmin', permissions: ['users', 'hospitalAdmins'] } }) }));
vi.mock('../../hooks/useFetch.js', () => ({ useFetch: () => ({ data: { admins }, loading: false, error: null, reload: () => {} }) }));

const { AdminPermissionsPage, groupByHospital } = await import('./UserPermissionsPage.jsx');
const text = (html) => html.replace(/&#x27;|&rsquo;/g, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Admin permissions', () => {
  it('groups the admins by hospital, A to Z', () => {
    expect(groupByHospital(admins).map((h) => [h.tenantName, h.admins.map((a) => a.user.name)])).toEqual([
      ['Lotus Clinic (Demo)', ['Ravi Admin']],
      ['Sunrise Hospital (Demo)', ['Bina Admin', 'Dr Asha Sample']],
    ]);
  });

  it('a card per hospital, a chip per permission, "Also Doctor", no table and no primary button', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AdminPermissionsPage />
      </MemoryRouter>,
    );
    const shown = text(html);
    expect(html.match(/class="card ap-hospital"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<table/);
    expect(html.match(/type="checkbox"/g)).toHaveLength(15); // 3 admins × 5 permissions
    expect(shown).toMatch(/Add people Reset password Remove \/ restore access Change roles Edit name and email/);
    expect(shown).toContain('Also Doctor');
    expect(shown).toMatch(/tick Admin as well as Doctor/);
    expect(html).not.toMatch(/btn-primary/);
    expect(shown).not.toMatch(/!/);
  });
});
