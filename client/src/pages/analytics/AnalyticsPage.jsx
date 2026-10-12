// Analytics (Feature 11): OBGY and newborn numbers for the hospital, on six tabs (Deliveries added 5 Oct 2026).
//  - Doctors: exact numbers over the patients whose clinical details they may see, "Whole hospital" or
//    "My patients", and a click on a number opens the patients behind it (every opening is recorded).
//  - Hospital admins: whole-hospital numbers for whole finished months; small numbers in words; no lists.
//  - The super admin (platform=true): totals per hospital and for all active hospitals, numbers only.
// What each person may see is decided by the server; this page only shows what it is sent.
import { useAuth } from '../../auth/AuthContext.jsx';
import { FilterSelect, formatNumber } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Alert, formatDateTime, hasRole } from '../../components/ui.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { CARE_TYPE_SHORT } from '../patients/patientFormat.js';
import { AnalyticsFilters } from './AnalyticsFilters.jsx';
import { EXACT_ROLES } from './analyticsRoles.js';
import { FILTER_DEFAULTS, analyticsParams, analyticsQuery, analyticsSearch, analyticsTabs, cardWidths, listHref, notInThisVersion, perHospitalText, tileWords } from './analyticsFormat.js';
import { AnalyticsCard, TOO_FEW_TEXT, WIDE_CARDS } from './cards/AnalyticsCard.jsx';
import { StatTiles } from './cards/StatTiles.jsx';

const SUBTITLE = {
  hospital: 'Numbers for pregnancy, newborn and clinic work in this hospital.',
  platform: 'Totals for each hospital – numbers only, no patient details.',
};
const NO_PATIENTS = 'No patients have been registered in this hospital yet. Numbers appear here once records are added.';
const NO_PATIENTS_ALL = 'No patients have been registered in these hospitals yet. Numbers appear here once records are added.';
const CARE_TYPE_OPTIONS = Object.entries(CARE_TYPE_SHORT).map(([value, label]) => ({ value, label }));

// Overview: what this version does not count, and why (the words are in analyticsFormat.js).
function NotInThisVersion({ audience }) {
  return (
    <section className="panel an-card an-wide an-not-yet" aria-labelledby="an-not-yet">
      <header className="an-card-head">
        <h2 id="an-not-yet">Not in this version</h2>
      </header>
      <div className="an-card-body">
        {notInThisVersion(audience).map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
    </section>
  );
}

/** The super admin's headline tiles per hospital (all hospitals only). */
function TilesByHospital({ tiles, hospitals }) {
  if (!tiles?.some((t) => Array.isArray(t.values)) || !hospitals?.length) return null;
  return (
    <details className="an-by-hospital an-tiles-by-hospital">
      <summary>Headline numbers by hospital</summary>
      <div className="an-table-wrap">
        <table className="dt an-table">
          <caption className="sr-only">Headline numbers by hospital</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              {hospitals.map((h) => (
                <th key={h.id} scope="col" className="num">
                  {h.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiles.map((t) => (
              <tr key={t.ref}>
                <th scope="row">{t.label}</th>
                {(t.values ?? []).map((v, i) => (
                  <td key={hospitals[i]?.id ?? i} className="num" data-label={hospitals[i]?.name}>
                    {perHospitalText(v, i, t.tooFew)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function HeadlineTiles({ data, ctx }) {
  const tiles = data.tiles.map((t) => {
    // The small-hospital switch (super admin): a hospital left out is named in the tile's note, after the window.
    const { sub, tooFew } = tileWords(t);
    return {
      key: t.ref,
      label: t.label,
      value: t.value,
      tone: t.tone === 'high' ? 'high' : 'neutral',
      href: ctx.audience === 'doctor' && t.list && t.cell ? listHref({ metric: t.metric, cell: t.cell, section: ctx.section, params: ctx.params }) : undefined,
      sub,
      ...(tooFew ? { text: TOO_FEW_TEXT, textValue: true } : {}),
    };
  });
  return (
    <>
      <StatTiles tiles={tiles} className="an-headline" />
      {ctx.audience === 'platform' && <TilesByHospital tiles={data.tiles} hospitals={ctx.hospitals} />}
    </>
  );
}

/** The cards of one grid, each full or half width so no row is left half empty (order unchanged). */
function CardGrid({ cards, ctx }) {
  const widths = cardWidths(cards, WIDE_CARDS);
  return cards.map((card, i) => <AnalyticsCard key={card.id} card={card} ctx={ctx} wide={widths[i]} />);
}

export function AnalyticsPage({ section, platform = false }) {
  const { activeMembership } = useAuth();
  const audience = platform ? 'platform' : hasRole(activeMembership, ...EXACT_ROLES) ? 'doctor' : 'admin';
  const [rawParams, setParams] = useListParams(FILTER_DEFAULTS[audience]);
  const params = analyticsParams(rawParams, audience); // a period from another kind of user falls back to the default
  const base = platform ? '/platform/analytics' : '/analytics';

  const query = analyticsQuery(params, audience);
  if (section !== 'overview') delete query.careType; // the type-of-care filter is on Overview only
  const { data, error, loading, reload } = useFetch(`${base}/sections/${section}`, query);
  const hospitalList = useFetch(platform ? '/platform/analytics/hospitals' : null);
  const hospitals = hospitalList.data?.hospitals ?? [];

  const all = platform && params.hospital === 'all';
  const ctx = { audience, section, params, hospitals: all ? (data?.hospitals ?? []) : [] };
  const cards = data?.cards ?? [];
  const grouped = [];
  for (const card of cards) {
    const last = grouped[grouped.length - 1];
    if (last && last.group === (card.group ?? null)) last.cards.push(card);
    else grouped.push({ group: card.group ?? null, cards: [card] });
  }
  const activeCount = hospitals.filter((h) => h.isActive).length;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Analytics' }]}
        title="Analytics"
        documentTitle="Analytics"
        subtitle={platform ? SUBTITLE.platform : SUBTITLE.hospital}
        tabs={analyticsTabs(base, analyticsSearch(params, audience), { ask: !platform && audience === 'doctor', report: !platform && audience === 'doctor' })}
      />
      <div className="pf-content an-page">
        <AnalyticsFilters
          audience={audience}
          params={params}
          setParams={setParams}
          period={data?.period}
          today={data?.today}
          hospitals={hospitals}
          leftOut={data?.leftOut ?? 0}
        />
        {data?.masking?.note && <Alert type="info">{data.masking.note}</Alert>}
        {error && (
          <Alert type="error">
            {`The numbers couldn't be loaded. ${error} `}
            <button type="button" className="btn btn-link plan-inline-link" onClick={reload}>
              Try again
            </button>
          </Alert>
        )}

        {!data && loading && (
          <section className="panel an-loading" role="status">
            <div className="spinner" aria-hidden="true" />
            <span>{all && activeCount > 1 ? `Calculating for ${formatNumber(activeCount)} hospitals…` : 'Calculating…'}</span>
          </section>
        )}

        {data && (
          <div className={`an-content ${loading ? 'an-stale' : ''}`.trim()} aria-busy={loading}>
            {data.noPatients ? (
              <section className="panel">
                <p className="panel-empty">{all ? NO_PATIENTS_ALL : NO_PATIENTS}</p>
              </section>
            ) : (
              <>
                {section === 'overview' && data.tiles?.length > 0 && <HeadlineTiles data={data} ctx={ctx} />}
                {grouped.map((g, gi) =>
                  g.group ? (
                    <section key={g.group} className="an-group-block" aria-labelledby={`an-group-${gi}`}>
                      <div className="an-group-head">
                        <div>
                          <h2 id={`an-group-${gi}`} className="an-group-title">
                            {g.group}
                          </h2>
                          {section === 'overview' && <p className="an-caption">The type-of-care filter changes only the cards in this group.</p>}
                        </div>
                        {section === 'overview' && (
                          <FilterSelect
                            label="Type of care"
                            value={params.careType === 'all' ? '' : params.careType}
                            onChange={(v) => setParams({ careType: v || 'all' })}
                            allLabel="All types of care"
                            options={CARE_TYPE_OPTIONS}
                          />
                        )}
                      </div>
                      <div className="an-grid">
                        <CardGrid cards={g.cards} ctx={ctx} />
                      </div>
                    </section>
                  ) : (
                    <div key={g.cards[0].id} className="an-grid">
                      <CardGrid cards={g.cards} ctx={ctx} />
                    </div>
                  ),
                )}
                {section === 'overview' && <NotInThisVersion audience={audience} />}
              </>
            )}
            {data.calculatedAt && <p className="an-caption an-calculated">{`Worked out ${formatDateTime(data.calculatedAt)}.`}</p>}
          </div>
        )}
      </div>
    </>
  );
}
