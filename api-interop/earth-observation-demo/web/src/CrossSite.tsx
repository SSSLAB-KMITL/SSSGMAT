import { useEffect, useState } from "react";
import { request, useStudio } from "./state";

export default function CrossSite() {
  const s = useStudio(),
    [data, setData] = useState<any>(null);
  useEffect(() => {
    request("/summary")
      .then(setData)
      .catch((e) => s.message(String(e)));
  }, [s.scenes]);
  if (!data) return <div className="empty-small">Loading site summary…</div>;
  return (
    <div className="crosssite">
      <h2>Three sites, one observation workspace</h2>
      <p>
        ภาพย้อนหลังจริง ·
        เปรียบเทียบความพร้อมของข้อมูลและผลทดลองที่ตรวจสอบย้อนกลับได้
      </p>
      <div className="crosssite-cards">
        {data.sites.map((site: any) => (
          <article key={site.id}>
            <div className="crosssite-title">
              <i style={{ background: site.color }} />
              <h3>{site.name}</h3>
              <b>
                {site.prepared}/{site.total}
              </b>
            </div>
            {site.samples.length ? (
              <img
                alt={site.name + " SAR scene"}
                src={site.samples[0].image_url}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="no-image">No prepared image yet</div>
            )}
            <small>{site.subtitle}</small>
            <dl>
              <dt>Acquisition period</dt>
              <dd>
                {site.first_utc.slice(0, 10)} → {site.last_utc.slice(0, 10)}
              </dd>
              <dt>Incidence range</dt>
              <dd>
                {site.incidence_range
                  .map((v: number) => v.toFixed(1))
                  .join("–")}
                °
              </dd>
              <dt>Prepared geometry</dt>
              <dd>
                {site.samples.filter((r: any) => r.geometry).length} collect
                trajectories
              </dd>
              <dt>Reviewed / accepted</dt>
              <dd>
                {site.samples.reduce((n: number, r: any) => n + r.accepted, 0)}{" "}
                candidates
              </dd>
            </dl>
            <button onClick={() => s.setSite(site.id)}>Open {site.name}</button>
          </article>
        ))}
      </div>
      <div className="summary-note">{data.note}</div>
      <h3>Prepared acquisition log</h3>
      <div
        className="summary-table"
        role="region"
        aria-label="Prepared acquisition log"
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">
            Prepared acquisitions by site, capture time and satellite
          </caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Acquired (UTC)</th>
              <th scope="col">Satellite</th>
              <th scope="col">Incidence</th>
              <th scope="col">ROI</th>
              <th scope="col">Candidates</th>
              <th scope="col">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {data.sites.flatMap((site: any) =>
              site.samples.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="table-scene-button"
                      aria-label={`Open acquisition ${site.name} ${r.time_utc}`}
                      onClick={() => {
                        s.setSite(site.id);
                        s.select(r.id);
                      }}
                    >
                      {site.name} ↗
                    </button>
                  </td>
                  <td>{r.time_utc.slice(0, 19).replace("T", " ")}</td>
                  <td>{r.platform}</td>
                  <td>{r.incidence_deg.toFixed(1)}°</td>
                  <td>{r.roi_width_m} m</td>
                  <td>{r.candidates ?? "—"}</td>
                  <td>{r.accepted}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
