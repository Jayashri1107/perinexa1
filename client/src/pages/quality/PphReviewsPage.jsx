import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import {
  Alert,
  StatusPill,
  formatDate,
  formatDateTime,
  hasRole,
} from "../../components/ui.jsx";
import { useFetch } from "../../hooks/useFetch.js";
import { NEAR_MISS } from "../inpatient/pphRules.js";
import { SimpleTable } from "./SimpleTable.jsx";
import { CASE_REVIEW_ROLES, useQualityTabs } from "./qualityFormat.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { reviewNumber } from "./CaseReviewsPage.jsx";

// Clinical audit → PPH M&M list (Build 15, A1): each PPH episode that met the OBG-F-19 near-miss criteria, with its
// near-miss review, to be discussed within 7 days. And who the PPH chart tells – the Lead Obstetrician(s) (A1) and the
// Director(s) (A4, massive haemorrhage), named by the hospital admin; until named, the quality lead and the admin.

function WhoIsTold() {
  const { data, error, reload } = useFetch("/pph-reviews/settings");
  const [f, setF] = useState(null);
  const [problem, setProblem] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data)
      setF({
        leadObstetricianIds: data.leadObstetricians.map((p) => p.id),
        directorIds: data.directors.map((p) => p.id),
      });
  }, [data]);
  const save = async () => {
    try {
      await api("/pph-reviews/settings", { method: "PUT", body: f });
      setProblem(null);
      setSaved(true);
      reload();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const names = (list, fallback) =>
    list?.length ? list.map((p) => p.name).join(", ") : fallback;
  const pick = (key, label) => (
    <fieldset className="fieldset">
      <legend>{label}</legend>
      <div className="check-grid">
        {data.people.map((p) => (
          <label key={p.id} className="check">
            <input
              type="checkbox"
              checked={f[key].includes(p.id)}
              onChange={(e) =>
                setF({
                  ...f,
                  [key]: e.target.checked
                    ? [...f[key], p.id]
                    : f[key].filter((x) => x !== p.id),
                })
              }
            />{" "}
            {p.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <section className="card stack" aria-labelledby="pph-told">
      <h2 id="pph-told">Who the PPH chart tells</h2>
      <Alert type="error">{error ?? problem}</Alert>
      {data && (
        <>
          <p>{`Lead Obstetrician (near-miss criteria met): ${names(data.leadObstetricians, "not named – the quality lead is told")}.`}</p>
          <p>{`Director (massive haemorrhage declared): ${names(data.directors, "not named – the hospital admin is told")}.`}</p>
          <p className="hint">
            By the notification bell, with the ward and bed only – never her
            name or values.
          </p>
          {data.canEdit && f && (
            <>
              {pick("leadObstetricianIds", "Lead Obstetrician")}
              {pick("directorIds", "Director")}
              {saved && <Alert type="success">Saved.</Alert>}
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={save}
                >
                  Save who is told
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function MmList() {
  const { data, error, reload } = useFetch("/pph-reviews");
  const [problem, setProblem] = useState(null);
  const discussed = async (id) => {
    try {
      await api(`/pph-reviews/${id}/discussed`, { method: "POST", body: {} });
      setProblem(null);
      reload();
    } catch (err) {
      setProblem(err.message);
    }
  };
  const columns = [
    {
      key: "who",
      header: "Patient",
      main: true,
      render: (r) =>
        r.patient ? (
          <Link
            to={`/patients/${r.patient.id}/stays/${r.admissionId}`}
          >{`${r.patient.fullName} · ${r.patient.mrn}`}</Link>
        ) : (
          "–"
        ),
    },
    {
      key: "when",
      header: "PPH declared",
      render: (r) => (r.declared_at ? formatDateTime(r.declared_at) : "–"),
    },
    {
      key: "criteria",
      header: "Near-miss criteria (OBG-F-19)",
      render: (r) => r.criteria.map((k) => NEAR_MISS[k] ?? k).join("; "),
    },
    {
      key: "review",
      header: "Near-miss review",
      render: (r) =>
        r.review ? (
          <Link to={`/clinical-audit/reviews/${r.review.id}`}>
            {reviewNumber(r.review.serial)}
          </Link>
        ) : (
          "–"
        ),
    },
    {
      key: "status",
      header: "M&M",
      render: (r) =>
        r.discussedAt ? (
          <StatusPill
            tone="stable"
            icon={CircleCheck}
          >{`Discussed ${formatDate(r.discussedAt)}`}</StatusPill>
        ) : r.overdue ? (
          <StatusPill
            tone="high"
            icon={CircleAlert}
          >{`Overdue – review by ${formatDate(r.reviewBy)}`}</StatusPill>
        ) : (
          <StatusPill
            tone="due"
            icon={Clock}
          >{`Review by ${formatDate(r.reviewBy)}`}</StatusPill>
        ),
    },
    {
      key: "act",
      header: "",
      render: (r) =>
        data?.canDiscuss && !r.discussedAt ? (
          <button
            type="button"
            className="btn btn-link"
            onClick={() => discussed(r.id)}
          >
            Mark discussed
          </button>
        ) : null,
    },
  ];
  return (
    <section className="card stack" aria-labelledby="pph-mm">
      <h2 id="pph-mm">M&amp;M list</h2>
      <Alert type="error">{error ?? problem}</Alert>
      <SimpleTable
        columns={columns}
        rows={data?.episodes ?? []}
        loading={!data && !error}
        emptyText="No PPH episode has met the near-miss criteria."
      />
    </section>
  );
}

export function PphReviewsPage() {
  const tabs = useQualityTabs();
  const membership = useAuth()?.activeMembership;
  const canSeeList = Boolean(
    membership && hasRole(membership, ...CASE_REVIEW_ROLES),
  ); // not the hospital admin
  return (
    <>
      <PageHeader
        title="Clinical audit"
        documentTitle="PPH M&M list"
        subtitle="PPH episodes that met the near-miss criteria (OBG-F-19), each to be discussed at M&M within 7 days, and who the PPH chart tells."
        tabs={tabs}
      />
      <div className="pf-content stack">
        {canSeeList && <MmList />}
        <WhoIsTold />
      </div>
    </>
  );
}
