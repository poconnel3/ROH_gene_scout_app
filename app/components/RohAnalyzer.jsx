"use client";

import { useMemo, useState } from "react";
import { formatInterval, parseRohIntervals } from "../../lib/roh-parser";

const SAMPLE_TEXT = `119 KB INTERSTITIAL DELETION OF 7Q11.22->Q11.22;
LONG CONTIGUOUS REGIONS OF HOMOZYGOSITY IN MULTIPLE CHROMOSOMES
7Q: VARIANT OF UNCERTAIN SIGNIFICANCE;
APPARENT COMMON DESCENT
. arr[hg19] 7q11.22(69,478,506-69,597,073)x1

ROH Bp linear position:
  chr2:204991426-224932239
  chr3:127055920-131374290.
  chr4:132600769-145625951.
  chr5:28720094-42918025.
  chr5:57287088-68826246.
  chr7:106793175-127158405.
  chr10:11210860-25581379.
  chr11:22135371-40746664.
  chr11:60804710-69393671.
  chr11:12916233-18285205.
  chr12:37857751-50183996.
  chr12:23796727-34835837.
  chr16:46464489-62417538.
  chr16:26157995-35220544.
  chr20:61795-5353005.
  chr21:37131502-41351577
  chrX:52100000-62400000
Total: 188.22 Mb`;

export default function RohAnalyzer() {
  const [reportText, setReportText] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle");
  const [apiError, setApiError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [expandedGenes, setExpandedGenes] = useState(() => new Set());

  const parsed = useMemo(() => parseRohIntervals(reportText), [reportText]);
  const uniqueGeneRows = useMemo(() => summarizeUniqueGenes(analysis?.results || []), [analysis]);
  const filteredRows = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return uniqueGeneRows;
    return uniqueGeneRows.filter((row) => {
      return (
        row.geneSymbol.toLowerCase().includes(value) ||
        row.geneName.toLowerCase().includes(value) ||
        row.phenotypes.some((phenotype) => phenotype.name.toLowerCase().includes(value))
      );
    });
  }, [query, uniqueGeneRows]);

  async function analyze() {
    setStatus("loading");
    setApiError("");
    setAnalysis(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ intervals: parsed.intervals })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Analysis failed.");
      }
      setAnalysis(payload);
      setExpandedGenes(new Set());
      setStatus("success");
    } catch (error) {
      setApiError(error.message);
      setStatus("error");
    }
  }

  function toggleGene(key) {
    setExpandedGenes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function copyIntervals() {
    const text = parsed.intervals.map(formatInterval).join("\n");
    navigator.clipboard?.writeText(text);
  }

  function downloadTsv() {
    const tsv = buildTsv(uniqueGeneRows);
    const blob = new Blob([tsv], { type: "text/tab-separated-values" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "roh-omim-recessive-genes.tsv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Icon name="fileSearch" size={24} strokeWidth={2.1} />
          </div>
          <div>
            <h1>ROH-to-OMIM Recessive Gene Finder</h1>
            <p>Extract hg19 ROH intervals from pasted CMA text and query public recessive disease-gene annotations.</p>
          </div>
        </div>
        <div className="privacy-pill">
          <Icon name="shieldCheck" size={17} />
          <span>Only normalized intervals are sent to the server</span>
        </div>
      </header>

      <section className="workspace-grid" aria-label="ROH analysis workspace">
        <section className="input-panel">
          <div className="panel-heading">
            <div>
              <h2>Report Text</h2>
              <p>Paste any CMA report excerpt containing ROH/AOH regions.</p>
            </div>
            <div className="button-row">
              <button className="icon-button" type="button" onClick={() => setReportText(SAMPLE_TEXT)} title="Load sample text">
                <Icon name="sparkles" size={17} />
                <span>Sample</span>
              </button>
              <button className="icon-button secondary" type="button" onClick={() => setReportText("")} title="Clear pasted text">
                <Icon name="trash" size={17} />
                <span>Clear</span>
              </button>
            </div>
          </div>

          <textarea
            className="report-input"
            value={reportText}
            onChange={(event) => setReportText(event.target.value)}
            spellCheck="false"
            placeholder="Paste report text here. Example: ROH Bp linear position: chr2:204991426-224932239 ..."
          />

          <div className="callout">
            <Icon name="alert" size={18} />
            <p>
              This tool is for clinical decision support. Verify coordinates, disease results, and inheritance clinically before
              using results in patient care.
            </p>
          </div>
        </section>

        <section className="review-panel">
          <div className="panel-heading">
            <div>
              <h2>Detected ROH Intervals</h2>
              <p>{parsed.intervals.length} hg19 chromosome 1-22/X interval{parsed.intervals.length === 1 ? "" : "s"} ready.</p>
            </div>
            <button className="icon-button secondary" type="button" onClick={copyIntervals} disabled={parsed.intervals.length === 0}>
              <Icon name="clipboard" size={17} />
              <span>Copy</span>
            </button>
          </div>

          <div className="interval-list">
            {parsed.intervals.length === 0 ? (
              <div className="empty-state">
                <Icon name="table" size={28} />
                <p>No ROH intervals detected yet.</p>
              </div>
            ) : (
              parsed.intervals.map((interval) => (
                <div className="interval-row" key={formatInterval(interval)}>
                  <span>{interval.chromosome}</span>
                  <strong>{interval.start.toLocaleString()} - {interval.end.toLocaleString()}</strong>
                  <small>{((interval.end - interval.start + 1) / 1_000_000).toFixed(2)} Mb</small>
                </div>
              ))
            )}
          </div>

          {parsed.warnings.length > 0 && (
            <div className="warning-list" role="status">
              {parsed.warnings.map((warning) => (
                <div className="warning-row" key={warning}>
                  <Icon name="alert" size={15} />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          <button className="primary-action" type="button" disabled={parsed.intervals.length === 0 || status === "loading"} onClick={analyze}>
            {status === "loading" ? <Icon name="loader" className="spin" size={18} /> : <Icon name="search" size={18} />}
            <span>{status === "loading" ? "Querying annotations" : "Find Recessive Disease Genes"}</span>
          </button>
        </section>
      </section>

      <section className="results-panel" aria-label="Recessive disease gene results">
        <div className="results-toolbar">
          <div>
            <h2>Recessive Disease Gene Results</h2>
            <p>
              {analysis
                ? `${uniqueGeneRows.length} unique gene${uniqueGeneRows.length === 1 ? "" : "s"} across ${analysis.intervals.length} interval${analysis.intervals.length === 1 ? "" : "s"}.`
                : "Run an analysis to populate the GeneScout-like result table."}
            </p>
          </div>
          <div className="toolbar-actions">
            <label className="search-field">
              <Icon name="search" size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter genes or phenotypes" />
            </label>
            <button className="icon-button secondary" type="button" onClick={downloadTsv} disabled={uniqueGeneRows.length === 0}>
              <Icon name="download" size={17} />
              <span>TSV</span>
            </button>
            <button className="icon-button secondary" type="button" onClick={analyze} disabled={parsed.intervals.length === 0 || status === "loading"}>
              <Icon name="refresh" size={17} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {apiError && (
          <div className="error-banner" role="alert">
            <Icon name="alert" size={18} />
            <span>{apiError}</span>
          </div>
        )}

        {analysis?.warnings?.length > 0 && (
          <div className="warning-list compact" role="status">
            {analysis.warnings.map((warning) => (
              <div className="warning-row" key={warning}>
                <Icon name="alert" size={15} />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table className="result-table">
            <thead>
              <tr>
                <th>Gene</th>
                <th>Region</th>
                <th>Overlap</th>
                <th>Recessive Phenotype</th>
                <th>HPO Phenotypes</th>
                <th>Recessive Phenotypes</th>
                <th>OMIM</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state table-empty">
                      <Icon name="table" size={28} />
                      <p>{analysis ? "No matching rows for the current filter." : "No results yet."}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const open = expandedGenes.has(row.key);
                  return (
                    <tr className={open ? "expanded" : ""} key={row.key}>
                      <td>
                        <button className="gene-button" type="button" onClick={() => toggleGene(row.key)}>
                          <strong>{row.geneSymbol}</strong>
                          <span>{row.geneName || "Disease gene"}</span>
                        </button>
                      </td>
                      <td>{row.regions.join(", ")}</td>
                      <td>{row.overlapStatuses.join(", ")}</td>
                      <td>
                        <ul className="phenotype-list">
                          {getUniquePhenotypes(row.phenotypes).map((phenotype) => (
                            <li key={`${row.key}-${phenotype.phenotypeMimNumber || phenotype.name}`}>
                              <span>{phenotype.name}</span>
                              <small>
                                {phenotype.inheritance}
                                {phenotype.phenotypeMimNumber ? ` · ${phenotype.phenotypeMimNumber}` : ""}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <div className="hpo-term-groups">
                          {getHpoTermGroups(row.phenotypes).length === 0 ? (
                            <span className="muted-cell">No HPO phenotype terms listed</span>
                          ) : (
                            getHpoTermGroups(row.phenotypes).map((group) => (
                              <div className="hpo-term-group" key={`${row.key}-${group.key}`}>
                                <strong>{group.conditionName}</strong>
                                <ul>
                                  {group.terms.slice(0, 8).map((term) => (
                                    <li key={`${group.key}-${term.hpoId || term.name}`}>{term.name}</li>
                                  ))}
                                  {group.terms.length > 8 && <li className="overflow-term">+{group.terms.length - 8} more</li>}
                                </ul>
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="phenotype-summary">
                          <span>{row.phenotypes.length} phenotype{row.phenotypes.length === 1 ? "" : "s"}</span>
                          {open && (
                            <ul>
                              {row.phenotypes.map((phenotype) => (
                                <li key={`${row.key}-${phenotype.phenotypeMimNumber}-${phenotype.name}`}>
                                  <span>{phenotype.name}</span>
                                  <small>{phenotype.inheritance}{phenotype.phenotypeMimNumber ? ` · ${phenotype.phenotypeMimNumber}` : ""}</small>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="link-stack">
                          {row.geneMimNumber && (
                            <a href={`https://omim.org/entry/${row.geneMimNumber}`} target="_blank" rel="noreferrer">
                              Gene
                            </a>
                          )}
                          {row.phenotypes.slice(0, 2).map((phenotype) =>
                            phenotype.phenotypeMimNumber ? (
                              <a
                                href={`https://omim.org/entry/${phenotype.phenotypeMimNumber}`}
                                target="_blank"
                                rel="noreferrer"
                                key={phenotype.phenotypeMimNumber}
                              >
                                {phenotype.phenotypeMimNumber}
                              </a>
                            ) : null
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="app-footer">
        <span>Created by Patrick O'Connell</span>
        <a href="https://github.com/poconnel3" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href="https://scholar.google.com/citations?user=fvE9aOQAAAAJ&hl=en&oi=ao" target="_blank" rel="noreferrer">
          Google Scholar
        </a>
      </footer>
    </main>
  );
}

function summarizeUniqueGenes(intervalResults) {
  const map = new Map();

  for (const intervalResult of intervalResults) {
    for (const gene of intervalResult.genes || []) {
      const key = gene.geneMimNumber || gene.geneSymbol;
      const existing =
        map.get(key) ||
        {
          key,
          geneSymbol: gene.geneSymbol,
          geneName: gene.geneName || "",
          geneMimNumber: gene.geneMimNumber || "",
          regions: [],
          overlapStatuses: [],
          phenotypes: []
        };

      if (!existing.regions.includes(gene.region)) existing.regions.push(gene.region);
      if (!existing.overlapStatuses.includes(gene.overlapStatus)) existing.overlapStatuses.push(gene.overlapStatus);
      for (const phenotype of gene.phenotypes || []) {
        const phenotypeKey = `${phenotype.phenotypeMimNumber || phenotype.name}-${gene.region}`;
        if (!existing.phenotypes.some((item) => item._key === phenotypeKey)) {
          existing.phenotypes.push({ ...phenotype, _key: phenotypeKey });
        }
      }
      map.set(key, existing);
    }
  }

  return [...map.values()].sort((a, b) => a.geneSymbol.localeCompare(b.geneSymbol));
}

function buildTsv(rows) {
  const header = [
    "Gene",
    "Gene OMIM",
    "Regions",
    "Overlap",
    "Recessive Phenotype List",
    "Phenotype",
    "Phenotype OMIM",
    "Inheritance",
    "HPO Phenotypes"
  ];
  const body = rows.flatMap((row) =>
    row.phenotypes.map((phenotype) => [
      row.geneSymbol,
      row.geneMimNumber,
      row.regions.join("; "),
      row.overlapStatuses.join("; "),
      getUniquePhenotypes(row.phenotypes).map(formatPhenotypeLabel).join("; "),
      phenotype.name,
      phenotype.phenotypeMimNumber,
      phenotype.inheritance,
      formatHpoTermList(phenotype.hpoTerms)
    ])
  );

  return [header, ...body].map((line) => line.map(escapeTsv).join("\t")).join("\n");
}

function getUniquePhenotypes(phenotypes) {
  const map = new Map();
  for (const phenotype of phenotypes || []) {
    const key = phenotype.phenotypeMimNumber || phenotype.name;
    if (!map.has(key)) map.set(key, phenotype);
  }
  return [...map.values()];
}

function getHpoTermGroups(phenotypes) {
  return getUniquePhenotypes(phenotypes)
    .map((phenotype) => ({
      key: phenotype.phenotypeMimNumber || phenotype.name,
      conditionName: phenotype.name,
      terms: getUniqueHpoTerms(phenotype.hpoTerms)
    }))
    .filter((group) => group.terms.length > 0);
}

function getUniqueHpoTerms(terms) {
  const map = new Map();
  for (const term of terms || []) {
    if (!term?.name) continue;
    const key = term.hpoId || term.name;
    if (!map.has(key)) map.set(key, term);
  }
  return [...map.values()];
}

function formatPhenotypeLabel(phenotype) {
  const suffix = phenotype.phenotypeMimNumber ? ` (${phenotype.phenotypeMimNumber})` : "";
  return `${phenotype.name}${suffix}`;
}

function formatHpoTermList(terms) {
  return getUniqueHpoTerms(terms).map((term) => term.name).join("; ");
}

function escapeTsv(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\n/g, " ");
}

function Icon({ name, size = 18, className = "", strokeWidth = 2 }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name] || iconPaths.alert}
    </svg>
  );
}

const iconPaths = {
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v6" />
      <path d="M12 17h.01" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  fileSearch: (
    <>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <circle cx="11" cy="14" r="3" />
      <path d="m13.2 16.2 2.3 2.3" />
    </>
  ),
  loader: (
    <>
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.6 9A7 7 0 0 0 6.3 6.3L4 8.5" />
      <path d="M5.4 15A7 7 0 0 0 17.7 17.7L20 15.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3 10.6 8.6 5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4z" />
      <path d="M19 15v4" />
      <path d="M21 17h-4" />
      <path d="M5 3v3" />
      <path d="M6.5 4.5h-3" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M9 4v16" />
      <path d="M15 4v16" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6 18 20H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </>
  )
};
