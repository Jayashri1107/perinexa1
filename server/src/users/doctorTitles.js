// "Dr." for the doctors made before 13 Nov 2026 (utils/doctorTitle.js). Run at every start (index.js); a second run finds
// nothing to do. Each renamed doctor is in the audit log. The doctor's name kept on a stay (the doctor in charge, the
// discharging doctor) changes with it, so the screens that match a stay's doctor to the doctor list still find them.
// Other names kept on records (who signed, who did what) stay as they were written.
import { Admission } from '../models/Admission.js';
import { AuditLog } from '../models/AuditLog.js';
import { Membership } from '../models/Membership.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { hasDoctorTitle, withDoctorTitle } from '../utils/doctorTitle.js';

/** Returns how many doctors' names were given "Dr.". */
export async function addDoctorTitles() {
  const ids = await Membership.distinct('userId', { roles: 'doctor' });
  const users = (await User.find({ _id: { $in: ids } }, { name: 1 }).lean()).filter((u) => !hasDoctorTitle(u.name));
  if (!users.length) return 0;
  const tenants = await Tenant.find({}, { _id: 1 }).lean();
  for (const u of users) {
    const name = withDoctorTitle(u.name);
    await User.updateOne({ _id: u._id }, { $set: { name } });
    for (const { _id: tenantId } of tenants) {
      await Admission.updateMany({ tenantId, doctorId: u._id, doctorName: u.name }, { $set: { doctorName: name } });
      await Admission.updateMany({ tenantId, 'dischargeInfo.doctorId': u._id, 'dischargeInfo.doctorName': u.name }, { $set: { 'dischargeInfo.doctorName': name } });
    }
  }
  await AuditLog.insertMany(
    users.map((u) => ({ action: 'USER_UPDATED', target: u._id, details: { changes: { name: { from: u.name, to: withDoctorTitle(u.name) } }, by: 'doctor-title' } })),
  );
  return users.length;
}
