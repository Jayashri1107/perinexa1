// Toolbar + table + pagination: the standard list used by every module. `list` is the object from usePagedList().
import { Alert } from '../Alert.jsx';
import { DataTable } from './DataTable.jsx';
import { ListToolbar } from './ListToolbar.jsx';
import { Pagination } from './Pagination.jsx';

export function ListPanel({ list, columns, filters, searchPlaceholder, emptyText, onRowClick, toolbarExtra }) {
  return (
    <section className="card list-panel">
      <div className="list-top">
        <ListToolbar query={list.query} onFilter={list.setFilter} filters={filters} searchPlaceholder={searchPlaceholder} />
        {toolbarExtra}
      </div>
      <Alert type="error">{list.error}</Alert>
      <DataTable columns={columns} rows={list.items} loading={list.loading} emptyText={emptyText} onRowClick={onRowClick} />
      <Pagination pagination={list.pagination} onPage={list.setPage} onLimit={list.setLimit} />
    </section>
  );
}
