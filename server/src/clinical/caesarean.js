// Caesarean urgency and times (PX-REQ-00: PX-OBG-14 part, PX-X-04). A standard definition, no manual page needed
// (owner's go-ahead 5 Nov 2026). DRAFT until the Lead Obstetrician confirms it against OBG-F-09.
// Source: NICE guideline NG192, Caesarean birth (2021), 1.5.2–1.5.7 – the four categories of urgency; category 1
// delivered within 30 minutes of the decision, category 2 within 75 minutes.
// The decision-to-delivery interval is worked out from the two stored times – never typed. Only category 1 over
// 30 minutes is shown in red (the owner's specification); category 2 over 75 minutes is listed, not coloured.

export const CS_SOURCE = 'NICE guideline NG192, Caesarean birth (2021), recommendations 1.5.2–1.5.7';
export const CS_CATEGORIES = ['1', '2', '3', '4'];
export const CS_CATEGORY_WORDS = {
  1: 'Category 1 – immediate threat to the life of the woman or the baby',
  2: 'Category 2 – compromise of the woman or the baby, not immediately life-threatening',
  3: 'Category 3 – no compromise, needs early delivery',
  4: 'Category 4 – at a time to suit the woman and the team',
};
export const CS_TARGET_MINUTES = { 1: 30, 2: 75 };

/** Minutes from the decision to the delivery (whole minutes), or null while either time is missing or wrong. PURE. */
export function decisionToDeliveryMinutes(c = {}) {
  if (!c.decisionAt || !c.deliveredAt) return null;
  const ms = new Date(c.deliveredAt).getTime() - new Date(c.decisionAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60000);
}

/** Over the category's target? true / false, or null when there is no target or no interval. PURE. */
export function overTarget(c = {}) {
  const target = CS_TARGET_MINUTES[c.csCategory];
  const minutes = decisionToDeliveryMinutes(c);
  if (!target || minutes == null) return null;
  return minutes > target;
}

/** Category 1 delivered more than 30 minutes after the decision: shown in red, and reported as an incident. PURE. */
export const category1Late = (c = {}) => c.mode === 'lscs' && String(c.csCategory) === '1' && overTarget(c) === true;

/** The interval as the screens show it. */
export function caesareanTimes(c = {}) {
  const minutes = decisionToDeliveryMinutes(c);
  return { category: c.csCategory || null, minutes, targetMinutes: CS_TARGET_MINUTES[c.csCategory] ?? null, overTarget: overTarget(c), red: category1Late(c) };
}
