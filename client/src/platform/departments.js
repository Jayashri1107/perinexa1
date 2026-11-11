// A doctor's department in a hospital (owner, 27 Oct 2026): set by the hospital admin (Users), shown first on
// registration so only that department's doctors are offered. The same list as server/src/models/Membership.js.
// The owner's 9 departments (9 Nov 2026): a doctor sees only the patients of their departments.
export const DEPARTMENTS = ['Obgy', 'Pediatric', 'Radiology', 'Anesthesia', 'Diet and yoga', 'Surgery', 'Fetal medicine', 'Counselling', 'Cardiology'];

// A doctor may work in more than one department (29 Oct 2026): /tenant/doctors gives each doctor's departments.
/** A doctor's departments (also from a list that gives only one). */
export const departmentsOfDoctor = (d) => (d?.departments?.length ? d.departments : d?.department ? [d.department] : []);
/** Is this doctor in the department? ('' = any department) */
export const inDepartment = (d, department) => !department || departmentsOfDoctor(d).includes(department);
/**
 * The doctors offered as her doctor once a department is chosen: that department's doctors, and always the doctor
 * filling in the form (`me`) and the doctor already chosen (`current`) – a doctor the admin has not yet given this
 * department keeps their own name, so the patient they register stays theirs and opens for them.
 */
export const doctorsOffered = (doctors, department, { me = null, current = '' } = {}) =>
  doctors.filter((d) => inDepartment(d, department) || (me && d.id === me) || (current && d.id === current));
/** The departments that have a doctor, in the list's order. */
export const departmentsWithDoctors = (doctors) => DEPARTMENTS.filter((dep) => doctors.some((d) => departmentsOfDoctor(d).includes(dep)));
