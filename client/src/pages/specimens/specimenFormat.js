// Specimens and histopathology (Clinical Requirements Group A, item 3). Same roles as server/src/routes/specimens.js.
import { CircleCheck, CircleMinus, Clock, FileText, TriangleAlert } from 'lucide-react';

export const SPECIMEN_ROLES = ['doctor', 'rmo', 'nurse'];
export const SPECIMEN_KIND_LABELS = { histopathology: 'Histopathology', cytology: 'Cytology', other: 'Other' };

/** Status as colour, icon and word (BRAND: never colour alone). */
export function specimenLook(s) {
  if (s.status === 'cancelled') return { tone: 'inactive', icon: CircleMinus, word: 'Cancelled' };
  if (s.status === 'reviewed') return { tone: 'stable', icon: CircleCheck, word: 'Reviewed' };
  if (s.status === 'reported') return { tone: 'due', icon: FileText, word: 'Report to review' };
  if (s.overdue) return { tone: 'high', icon: TriangleAlert, word: `Overdue – ${s.days} days` };
  return { tone: 'watch', icon: Clock, word: `Waiting – ${s.days} days` };
}
