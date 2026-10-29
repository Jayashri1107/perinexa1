// Long lists a page at a time (29 Oct 2026): every DataTable shows 25 rows with the page bar under it, unless the
// screen pages the list itself (its own footer) or turns it off. Fake data only.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable } from './DataTable.jsx';

const columns = [{ key: 'name', header: 'Name' }];
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `Sample item ${i + 1}` }));
const html = (props) => renderToStaticMarkup(<DataTable caption="Items" columns={columns} {...props} />);
const shownRows = (out) => (out.match(/Sample item \d+/g) ?? []).length;

describe('DataTable pages', () => {
  it('shows the first 25 of a long list, with the page bar naming what they are', () => {
    const out = html({ rows: rows(980), pageLabel: 'medicines' });
    expect(shownRows(out)).toBe(25);
    expect(out).toContain('Sample item 25<');
    expect(out).not.toContain('Sample item 26<');
    expect(out).toMatch(/Showing <strong>1<\/strong>–<strong>25<\/strong> of <strong>980<\/strong> medicines/);
    expect(out).toMatch(/of 40/); // pages
  });
  it('a list that fits on one page has no page bar', () => {
    const out = html({ rows: rows(25) });
    expect(shownRows(out)).toBe(25);
    expect(out).not.toContain('dt-footer');
  });
  it('a screen with its own footer (a list the server pages) is left as it is', () => {
    const out = html({ rows: rows(40), footer: <div className="own-footer">Own pages</div> });
    expect(shownRows(out)).toBe(40);
    expect(out).toContain('own-footer');
    expect(html({ rows: rows(40), footer: null })).not.toContain('dt-footer');
  });
  it('pageSize 0 shows everything; a different size pages by it', () => {
    expect(shownRows(html({ rows: rows(40), pageSize: 0 }))).toBe(40);
    expect(shownRows(html({ rows: rows(40), pageSize: 10 }))).toBe(10);
  });
});
