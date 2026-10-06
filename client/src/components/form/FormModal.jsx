// The one add/edit dialog used by every module: a Modal with a FormBuilder and Cancel / Save.
import { Modal } from '../Modal.jsx';
import { FormBuilder } from './FormBuilder.jsx';

export function FormModal({ title, fields, form, onSubmit, onClose, submitLabel = 'Save', size }) {
  return (
    <Modal title={title} onClose={onClose} size={size}>
      <form onSubmit={form.submit(onSubmit)} noValidate>
        <FormBuilder fields={fields} form={form} />
        <div className="modal-foot inline">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={form.submitting}>
            {form.submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
