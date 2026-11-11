// The hospital's service rates (from photos of its old billing software's IPD final bills, 11 Nov 2026 – only the
// service names and rates were taken, nothing about any patient), loaded into every hospital's price list by the
// person who runs the server: npm run load:service-rates. Prices are in rupees.
//
// Only a price still at ₹0 is filled in: a price the hospital admin has already set is left alone. Billing staff and the
// hospital admin may change the rate of a line on a bill (surgeon, anaesthesia and OT differ per case), so these are
// the usual rates, not fixed ones.
// - KEYED: the app's own items (builtInPrices.js). Once priced they go on bills by themselves: the registration of a
//   new patient, nursing per day of a stay, a doctor's signed ward round.
// - NAMED: built-in items without a key, found by name.
// - ROOMS: the room charge per day of a ward, matched against the ward written at admission (billingService.js
//   bedPriceFor). Ward names as in the hospital's bed list (server/scripts/hospital-beds.js).

export const SERVICE_RATE_LIST_NAME = 'Service rate list (Nov 2026)';

export const KEYED_SERVICE_RATES = {
  registration: 300,
  nursing: 500,
  ipd_round: 1000,
};

export const NAMED_SERVICE_RATES = [
  { name: 'Surgeon fee', rupees: 40000 },
  { name: 'Anaesthesia charges', rupees: 10000 },
  { name: 'Operation theatre charges', rupees: 12000 },
];

export const ROOM_RATES = [
  { ward: 'Deluxe AC', name: 'Room charge per day – Deluxe AC', rupees: 2000 },
  { ward: 'Super Deluxe AC', name: 'Room charge per day – Super Deluxe AC', rupees: 3000 },
];
