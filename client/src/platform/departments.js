// A doctor's department in a hospital (owner, 27 Oct 2026): set by the hospital admin (Users), shown first on
// registration so only that department's doctors are offered. The same list as server/src/models/Membership.js.
export const DEPARTMENTS = [
  'Obstetrics & Gynaecology', 'Paediatrics', 'Neonatology', 'General', 'General Medicine', 'General Surgery', 'Anaesthesia', 'Cardiology', 'Dietetics',
  'Gastroenterology', 'Genetic Counselling', 'Lactation', 'Neurology', 'Medical Oncology', 'Surgical Oncology', 'Orthopaedics', 'Pathology', 'Physiotherapy',
  'Plastic & Reconstructive Surgery', 'Radiology', 'Interventional Radiology', 'Urology', 'Yoga',
];

// A doctor may work in more than one department (29 Oct 2026): /tenant/doctors gives each doctor's departments.
/** A doctor's departments (also from a list that gives only one). */
export const departmentsOfDoctor = (d) => (d?.departments?.length ? d.departments : d?.department ? [d.department] : []);
/** Is this doctor in the department? ('' = any department) */
export const inDepartment = (d, department) => !department || departmentsOfDoctor(d).includes(department);
/** The departments that have a doctor, in the list's order. */
export const departmentsWithDoctors = (doctors) => DEPARTMENTS.filter((dep) => doctors.some((d) => departmentsOfDoctor(d).includes(dep)));
